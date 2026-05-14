"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                     Uni-Sign · Easy Inference Script                        ║
║                                                                              ║
║  INPUT  : a sign-language video (.mp4) + your trained .pth checkpoint       ║
║  OUTPUT : the translated sentence (Arabic / Chinese / English)               ║
╚══════════════════════════════════════════════════════════════════════════════╝

QUICK START
-----------
1.  Drop your .pth file into the  checkpoints/  folder.
2.  Run:

        python infer.py --video path/to/video.mp4 --checkpoint checkpoints/your_model.pth

    For OSL (Arabic) use the default  --dataset OSL-Words  flag.
    For Chinese sign language add    --dataset CSL_Daily
    For English sign language add    --dataset How2Sign

3.  The predicted sentence is printed to the terminal.

OPTIONAL FLAGS
--------------
  --dataset       Dataset name that controls the output language.
                    OSL-Words / OSL-Sentences  → Arabic
                    CSL_Daily / CSL_News       → Chinese
                    WLASL / How2Sign / OpenASL → English
                  (default: OSL-Words)

  --device        cuda | cpu  (default: cuda, falls back to cpu automatically)
  --rgb_support   Add this flag if your checkpoint was trained with RGB support.
  --max_length    Max number of pose frames to use (default: 256).
  --num_beams     Beam search width (default: 4; higher = slower but better).
  --max_new_tokens  Max tokens to generate (default: 100).

EXAMPLES
--------
  # OSL Arabic translation
  python infer.py --video demo.mp4 --checkpoint checkpoints/osl_best.pth

  # English ASL translation with RGB support
  python infer.py --video demo.mp4 --checkpoint checkpoints/wlasl.pth \\
                  --dataset WLASL --rgb_support

  # Force CPU (no GPU available)
  python infer.py --video demo.mp4 --checkpoint checkpoints/osl_best.pth --device cpu
"""

import os, sys, argparse, warnings
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import torch
import numpy as np
from tqdm import tqdm
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from torch.nn.utils.rnn import pad_sequence

# ── rtmlib is bundled in demo/rtmlib-main ────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent / "demo" / "rtmlib-main"))
from rtmlib import Wholebody

# ── local modules ─────────────────────────────────────────────────────────────
from models import Uni_Sign
from datasets import S2T_Dataset_online, load_part_kp


# ─────────────────────────────────────────────────────────────────────────────
#  Argument parsing
# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Uni-Sign inference — sign language video → text",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--video",       required=True,  help="Path to the input video (.mp4)")
    p.add_argument("--checkpoint",  required=True,  help="Path to the .pth model checkpoint")
    p.add_argument("--dataset",     default="OSL-Words",
                   choices=["OSL-Words", "OSL-Sentences", "OSL-Words-Webcam",
                             "CSL_News", "CSL_Daily", "WLASL", "How2Sign", "OpenASL"],
                   help="Dataset name — controls output language (default: OSL-Words → Arabic)")
    p.add_argument("--device",      default="cuda", choices=["cuda", "cpu"])
    p.add_argument("--rgb_support", action="store_true",
                   help="Enable RGB-pose fusion (only if checkpoint was trained with this)")
    p.add_argument("--max_length",  type=int, default=256,
                   help="Max pose frames to process (default: 256)")
    p.add_argument("--num_beams",   type=int, default=4,
                   help="Beam search width (default: 4)")
    p.add_argument("--max_new_tokens", type=int, default=100,
                   help="Max output tokens (default: 100)")
    # internal defaults required by model / dataset code
    p.add_argument("--hidden_dim",  type=int,   default=256)
    p.add_argument("--label_smoothing", type=float, default=0.2)
    p.add_argument("--seed",        type=int,   default=42)
    p.add_argument("--task",        default="SLT")
    p.add_argument("--output_dir",  default="")
    p.add_argument("--online_video", default="")
    p.add_argument("--finetune",    default="")
    return p.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
#  Step 1 · Extract pose keypoints from the video
# ─────────────────────────────────────────────────────────────────────────────

def extract_pose(video_path: str, device: str) -> dict:
    """Run RTMPose wholebody on every frame of the video."""
    import cv2

    print(f"\n[1/3] Extracting pose from: {video_path}")

    # RTMPose backend selection
    backend = "onnxruntime"
    pose_device = device if device == "cuda" else "cpu"

    wholebody = Wholebody(
        to_openpose=False,
        mode="lightweight",
        backend=backend,
        device=pose_device,
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"[ERROR] Cannot open video: {video_path}")

    frames = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()

    print(f"         {len(frames)} frames detected — running pose estimation …")

    def process_frame(frame):
        frame = np.uint8(frame)
        keypoints, scores = wholebody(frame)
        H, W, _ = frame.shape
        return keypoints, scores, [W, H]

    results = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(process_frame, f) for f in frames]
        for fut in tqdm(futures, desc="  Pose", unit="frame"):
            results.append(fut.result())

    pose_data = {"keypoints": [], "scores": []}
    for kps, scores, wh in results:
        pose_data["keypoints"].append(kps / np.array(wh)[None, None])
        pose_data["scores"].append(scores)

    print(f"         Pose extraction done ✓")
    return pose_data


# ─────────────────────────────────────────────────────────────────────────────
#  Step 2 · Load model + checkpoint
# ─────────────────────────────────────────────────────────────────────────────

def load_model(args, device: str) -> Uni_Sign:
    print(f"\n[2/3] Loading model from: {args.checkpoint}")

    model = Uni_Sign(args=args)

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    # checkpoints may store state_dict under 'model' key or at the top level
    state_dict = ckpt.get("model", ckpt)

    missing, unexpected = model.load_state_dict(state_dict, strict=False)
    if missing:
        print(f"  ⚠  Missing keys  ({len(missing)}): {missing[:5]} …")
    if unexpected:
        print(f"  ⚠  Unexpected keys ({len(unexpected)}): {unexpected[:5]} …")

    model.eval()
    model.to(torch.bfloat16)
    model.to(device)
    print(f"         Model loaded on [{device}] ✓")
    return model


# ─────────────────────────────────────────────────────────────────────────────
#  Step 3 · Run inference
# ─────────────────────────────────────────────────────────────────────────────

def run_inference(model: Uni_Sign, pose_data: dict, video_path: str, args) -> str:
    print(f"\n[3/3] Running inference …")

    from torch.utils.data import DataLoader

    # Build online dataset wrapper (handles frame sampling + keypoint splitting)
    dataset = S2T_Dataset_online(args=args)
    dataset.rgb_data  = video_path
    dataset.pose_data = pose_data

    loader = DataLoader(
        dataset,
        batch_size=1,
        collate_fn=dataset.collate_fn,
        sampler=torch.utils.data.SequentialSampler(dataset),
    )

    device = next(model.parameters()).device
    target_dtype = torch.bfloat16

    with torch.no_grad():
        for src_input, tgt_input in loader:
            # Move tensors to the right device / dtype
            for key in list(src_input.keys()):
                if isinstance(src_input[key], torch.Tensor):
                    src_input[key] = src_input[key].to(target_dtype).to(device)

            # Forward pass (produces encoder embeddings + attention mask)
            stack_out = model(src_input, tgt_input)

            # Auto-regressive generation
            output_ids = model.generate(
                stack_out,
                max_new_tokens=args.max_new_tokens,
                num_beams=args.num_beams,
            )

    # Decode token ids → string
    tokenizer = model.mt5_tokenizer
    prediction = tokenizer.decode(output_ids[0], skip_special_tokens=True)
    return prediction


# ─────────────────────────────────────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Sanity checks
    if not os.path.isfile(args.video):
        sys.exit(f"[ERROR] Video not found: {args.video}")
    if not os.path.isfile(args.checkpoint):
        sys.exit(f"[ERROR] Checkpoint not found: {args.checkpoint}")

    # Device selection
    if args.device == "cuda" and not torch.cuda.is_available():
        warnings.warn("CUDA not available — falling back to CPU. Inference will be slow.")
        args.device = "cpu"

    # Mirror finetune arg so model loading code works
    args.finetune = args.checkpoint

    print("=" * 60)
    print("  Uni-Sign Inference")
    print("=" * 60)
    print(f"  Video      : {args.video}")
    print(f"  Checkpoint : {args.checkpoint}")
    print(f"  Dataset    : {args.dataset}")
    print(f"  Device     : {args.device}")
    print(f"  RGB support: {args.rgb_support}")
    print("=" * 60)

    # ── Pipeline ──────────────────────────────────────────────────────────────
    pose_data  = extract_pose(args.video, args.device)
    model      = load_model(args, args.device)
    prediction = run_inference(model, pose_data, args.video, args)

    print("\n" + "=" * 60)
    print("  RESULT")
    print("=" * 60)
    print(f"  {prediction}")
    print("=" * 60 + "\n")
    return prediction


if __name__ == "__main__":
    main()
