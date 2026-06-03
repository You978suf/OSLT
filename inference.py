import io
import json
import tempfile
import os
import sys
import queue
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import cv2
from PIL import Image
import torch
from torch.utils.data import DataLoader

# ── Add UniSign paths ─────────────────────────────────────────────────────────
UNISIGN_PATH = Path(__file__).parent / "unisign"
sys.path.insert(0, str(UNISIGN_PATH / "demo" / "rtmlib-main"))

from rtmlib import Wholebody

# Import UniSign model
sys.path.insert(0, str(UNISIGN_PATH))
from models import Uni_Sign
from datasets import S2T_Dataset_online

# ── CONFIG & GLOBALS ──────────────────────────────────────────────────────────
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
CHECKPOINT_PATH = "models/sentences_best_11pct.pth"  # UniSign model checkpoint
WORDS_TXT = "data/Words.txt"
LABEL_MAP_PATH = "data/label_map.json"
LANDMARKS_DIR = "landmarks"


def ensure_checkpoint(path=CHECKPOINT_PATH):
    """Download the UniSign checkpoint from MODEL_BLOB_URL if missing locally.

    In Azure Container Apps the image ships without the 2 GB model file; the
    container fetches it from Blob Storage on cold start. Locally, if the file
    already exists this is a no-op.
    """
    target = Path(path)
    if target.exists() and target.stat().st_size > 0:
        return True
    url = os.environ.get("MODEL_BLOB_URL", "").strip()
    if not url:
        print(f"[checkpoint] Missing {target} and MODEL_BLOB_URL not set — skipping download")
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        if "blob.core.windows.net" in url:
            print(f"[checkpoint] Downloading model from Azure Blob (managed identity) -> {target}")
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobClient
            blob = BlobClient.from_blob_url(url, credential=DefaultAzureCredential())
            with open(tmp, "wb") as out:
                blob.download_blob(max_concurrency=4).readinto(out)
        else:
            print(f"[checkpoint] Downloading model from URL -> {target}")
            import urllib.request, shutil
            with urllib.request.urlopen(url, timeout=600) as resp, open(tmp, "wb") as out:
                shutil.copyfileobj(resp, out, length=1024 * 1024)
        tmp.replace(target)
        print(f"[checkpoint] Downloaded {target.stat().st_size / 1e9:.2f} GB")
        return True
    except Exception as e:
        print(f"[checkpoint] Download failed: {e}")
        if tmp.exists():
            tmp.unlink()
        return False

def ensure_landmarks():
    """Download + unzip avatar landmark frames from LANDMARKS_BLOB_URL if missing.

    Mirrors ensure_checkpoint: the image ships without the ~333 MB landmark set;
    the container fetches the zip from Blob Storage on cold start and extracts it
    to landmarks/words/. Locally, if the folder already has .npy files this is a
    no-op.
    """
    words_dir = Path(LANDMARKS_DIR) / "words"
    if words_dir.exists() and any(words_dir.glob("*.npy")):
        return True
    url = os.environ.get("LANDMARKS_BLOB_URL", "").strip()
    if not url:
        print(f"[landmarks] Missing {words_dir} and LANDMARKS_BLOB_URL not set — avatar disabled")
        return False
    base = Path(LANDMARKS_DIR)
    base.mkdir(parents=True, exist_ok=True)
    tmp_zip = base / "_landmarks.zip.part"
    try:
        if "blob.core.windows.net" in url:
            print(f"[landmarks] Downloading landmarks from Azure Blob (managed identity)")
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobClient
            blob = BlobClient.from_blob_url(url, credential=DefaultAzureCredential())
            with open(tmp_zip, "wb") as out:
                blob.download_blob(max_concurrency=4).readinto(out)
        else:
            print(f"[landmarks] Downloading landmarks from URL")
            import urllib.request, shutil
            with urllib.request.urlopen(url, timeout=600) as resp, open(tmp_zip, "wb") as out:
                shutil.copyfileobj(resp, out, length=1024 * 1024)
        print(f"[landmarks] Downloaded {tmp_zip.stat().st_size / 1e6:.0f} MB, extracting…")
        import zipfile
        with zipfile.ZipFile(tmp_zip, "r") as z:
            z.extractall(base)
        tmp_zip.unlink()
        n = len(list(words_dir.glob("*.npy")))
        print(f"[landmarks] Extracted {n} landmark files to {words_dir}")
        return True
    except Exception as e:
        print(f"[landmarks] Download/extract failed: {e}")
        if tmp_zip.exists():
            tmp_zip.unlink()
        return False

WINDOW_SIZE = 60  # Number of frames to process at once
STRIDE = 15       # How many frames to slide

_avatar_index = {}     # {sign_id: str path}
_vocab_map = {}        # {arabic_word: sign_id}

def _build_avatar_index():
    """Scan landmarks/words/ and pick one .npy per sign_id."""
    global _avatar_index, _vocab_map
    base = Path(LANDMARKS_DIR) / "words"
    if not base.exists():
        print(f"[avatar] Landmarks folder not found: {base}. Avatar features disabled.")
        return

    # Group files by sign_id, prefer T01 take
    by_id = {}
    for npy in sorted(base.glob("*.npy")):
        parts = npy.stem.split("_")
        sign_id = parts[0] if parts else None
        if not sign_id: continue
        if sign_id not in by_id:
            by_id[sign_id] = npy
        else:
            # Prefer T01 take
            if "_T01" in npy.stem and "_T01" not in by_id[sign_id].stem:
                by_id[sign_id] = npy

    _avatar_index = {sid: str(p) for sid, p in by_id.items()}

    # Build arabic → sign_id map from vocabulary
    vocab_path = Path(WORDS_TXT)
    if vocab_path.exists():
        for line in vocab_path.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split(maxsplit=1)
            if len(parts) == 2:
                sign_id, arabic = parts
                _vocab_map[arabic] = sign_id

    print(f"[avatar] Index built: {len(_avatar_index)} signs available for animation")

# ═════════════════════════════════════════════════════════════════════════════
#  UniSign Model Manager
# ═════════════════════════════════════════════════════════════════════════════

class UniSignManager:
    """Manages UniSign model loading and inference"""
    _model = None
    _vocab = {}
    _label_map = {}
    _loaded = False
    _args = None
    
    @classmethod
    def load(cls, checkpoint_path=CHECKPOINT_PATH, words_txt=WORDS_TXT, label_map_path=LABEL_MAP_PATH):
        """Load UniSign model and vocabulary"""
        print(f"[UniSign] Loading model from: {checkpoint_path}")
        
        # Load vocabulary
        cls._vocab = {}
        p = Path(words_txt)
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2:
                    cls._vocab[parts[0]] = parts[1]
        
        # Load label map
        if label_map_path and Path(label_map_path).exists():
            s2i = json.loads(Path(label_map_path).read_text(encoding='utf-8'))
            cls._label_map = {v: k for k, v in s2i.items()}
            print(f"[UniSign] Loaded label_map.json ({len(cls._label_map)} classes)")
        else:
            cls._label_map = {i: s for i, s in enumerate(sorted(cls._vocab.keys()))}
            print(f"[UniSign] No label_map.json — using sorted vocab ({len(cls._label_map)} entries)")
        
        # Check if checkpoint exists
        c = Path(checkpoint_path)
        if not c.exists():
            print(f"[UniSign] WARNING: checkpoint not found at {c}")
            cls._loaded = True
            return
        
        # Create model arguments
        class ModelArgs:
            def __init__(self):
                self.checkpoint = str(checkpoint_path)
                self.dataset = "OSL-Words"
                self.device = DEVICE
                self.rgb_support = False
                self.max_length = 256
                self.num_beams = 4
                self.max_new_tokens = 100
                self.hidden_dim = 256
                self.label_smoothing = 0.2
                self.seed = 42
                self.task = "SLT"
                self.output_dir = ""
                self.online_video = ""
                self.finetune = str(checkpoint_path)
        
        cls._args = ModelArgs()
        
        try:
            # Load UniSign model
            cls._model = Uni_Sign(args=cls._args)
            
            ckpt = torch.load(str(c), map_location="cpu")
            state_dict = ckpt.get("model", ckpt)
            
            missing, unexpected = cls._model.load_state_dict(state_dict, strict=False)
            if missing:
                print(f"  [Warning] Missing keys ({len(missing)})")
            if unexpected:
                print(f"  [Warning] Unexpected keys ({len(unexpected)})")
            
            cls._model.eval()
            cls._model.to(torch.bfloat16)
            cls._model.to(DEVICE)
            cls._loaded = True
            print(f"[UniSign] Model loaded on {DEVICE}")
            
        except Exception as e:
            print(f"[UniSign] Error loading model: {e}")
            cls._loaded = False
    
    @classmethod
    def predict_from_pose(cls, pose_data, video_path=None, top_k=5):
        """
        Run inference using pose data
        """
        if not cls._loaded or cls._model is None:
            return []
        
        try:
            # Create dataset
            dataset = S2T_Dataset_online(args=cls._args)
            dataset.rgb_data = video_path if video_path else ""
            dataset.pose_data = pose_data
            
            loader = DataLoader(
                dataset,
                batch_size=1,
                collate_fn=dataset.collate_fn,
                sampler=torch.utils.data.SequentialSampler(dataset),
            )
            
            device = next(cls._model.parameters()).device
            target_dtype = torch.bfloat16
            
            with torch.no_grad():
                for src_input, tgt_input in loader:
                    for key in list(src_input.keys()):
                        if isinstance(src_input[key], torch.Tensor):
                            src_input[key] = src_input[key].to(target_dtype).to(device)
                    
                    stack_out = cls._model(src_input, tgt_input)
                    
                    output_ids = cls._model.generate(
                        stack_out,
                        max_new_tokens=cls._args.max_new_tokens,
                        num_beams=cls._args.num_beams,
                    )
            
            tokenizer = cls._model.mt5_tokenizer
            prediction = tokenizer.decode(output_ids[0], skip_special_tokens=True)
            
            # Format output to match the original API
            result = [{
                "rank": 1,
                "sign_id": "predicted",
                "arabic": prediction,
                "english": "",  # Can be translated if needed
                "confidence": 95.0  # UniSign doesn't output confidence, using high value
            }]
            
            return result
            
        except Exception as e:
            print(f"[UniSign] Prediction error: {e}")
            return []

# ═════════════════════════════════════════════════════════════════════════════
#  RTMPose Extraction Functions
# ═════════════════════════════════════════════════════════════════════════════

def extract_pose_from_video(video_path):
    """Extract pose keypoints from video using RTMPose"""
    print(f"[RTMPose] Extracting pose from: {video_path}")
    
    backend = "onnxruntime"
    pose_device = DEVICE if DEVICE == "cuda" else "cpu"
    
    wholebody = Wholebody(
        to_openpose=False,
        mode="lightweight",
        backend=backend,
        device=pose_device,
    )
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    
    frames = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    
    print(f"  {len(frames)} frames detected — running pose estimation")
    
    def process_frame(frame):
        frame = np.uint8(frame)
        keypoints, scores = wholebody(frame)
        H, W = frame.shape[:2]
        return keypoints, scores, [W, H]
    
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(process_frame, f) for f in frames]
        for fut in futures:
            results.append(fut.result())
    
    pose_data = {"keypoints": [], "scores": []}
    for kps, scores, wh in results:
        pose_data["keypoints"].append(kps / np.array(wh)[None, None])
        pose_data["scores"].append(scores)
    
    print("  Pose extraction done")
    return pose_data

def extract_pose_from_frames(frames_data):
    """
    Extract pose from a list of frame arrays
    """
    backend = "onnxruntime"
    pose_device = DEVICE if DEVICE == "cuda" else "cpu"
    
    wholebody = Wholebody(
        to_openpose=False,
        mode="lightweight",
        backend=backend,
        device=pose_device,
    )
    
    pose_data = {"keypoints": [], "scores": []}
    
    for frame in frames_data:
        frame = np.uint8(frame)
        keypoints, scores = wholebody(frame)
        H, W = frame.shape[:2]
        # Normalize by image dimensions
        normalized_kp = keypoints / np.array([W, H])[None, None]
        pose_data["keypoints"].append(normalized_kp)
        pose_data["scores"].append(scores)
    
    return pose_data

# ═════════════════════════════════════════════════════════════════════════════
#  Real-time Processor (for webcam stream)
# ═════════════════════════════════════════════════════════════════════════════

class RealtimeProcessor:
    """Handles real-time webcam frame processing with sliding window"""
    
    def __init__(self, window_size=WINDOW_SIZE, stride=STRIDE):
        self.window_size = window_size
        self.stride = stride
        self.frame_buffer = []
        self.pose_buffer = []
        self.is_processing = False
        self.last_prediction = ""
        self.wholebody = None
        self.processing_thread = None
        self.frame_queue = queue.Queue(maxsize=100)
        self.result_queue = queue.Queue()
        self.stop_flag = threading.Event()
        
    def start(self):
        """Start the real-time processing thread"""
        backend = "onnxruntime"
        pose_device = DEVICE if DEVICE == "cuda" else "cpu"
        
        self.wholebody = Wholebody(
            to_openpose=False,
            mode="lightweight",
            backend=backend,
            device=pose_device,
        )
        
        self.stop_flag.clear()
        self.processing_thread = threading.Thread(target=self._process_loop, daemon=True)
        self.processing_thread.start()
        
    def stop(self):
        """Stop the processing thread"""
        self.stop_flag.set()
        if self.processing_thread:
            self.processing_thread.join(timeout=2)
        self.frame_buffer.clear()
        self.pose_buffer.clear()
        
    def add_frame(self, frame_data):
        """Add a new frame to the processing queue"""
        try:
            self.frame_queue.put(frame_data, timeout=0.1)
        except queue.Full:
            pass  # Skip frame if queue is full
            
    def _process_loop(self):
        """Main processing loop running in separate thread"""
        while not self.stop_flag.is_set():
            try:
                # Get frame from queue
                frame_data = self.frame_queue.get(timeout=0.5)
                
                # Decode frame
                frame = self._decode_frame(frame_data)
                if frame is None:
                    continue
                
                # Extract pose
                keypoints, scores = self.wholebody(frame)
                H, W = frame.shape[:2]
                
                # Normalize and add to buffer
                normalized_kp = keypoints / np.array([W, H])[None, None]
                self.frame_buffer.append(frame)
                self.pose_buffer.append({'keypoints': normalized_kp, 'scores': scores})
                
                # When buffer reaches window size, run inference
                if len(self.pose_buffer) >= self.window_size and not self.is_processing:
                    self._run_inference()
                    
                    # Slide the window
                    self.frame_buffer = self.frame_buffer[self.stride:]
                    self.pose_buffer = self.pose_buffer[self.stride:]
                    
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Processing error: {e}")
                
    def _decode_frame(self, frame_data):
        """Decode base64 frame data to numpy array"""
        try:
            # Remove data URL prefix if present
            if ',' in frame_data:
                frame_data = frame_data.split(',')[1]
            
            # Decode base64
            img_bytes = base64.b64decode(frame_data)
            img = Image.open(io.BytesIO(img_bytes))
            frame = np.array(img)
            
            # Convert RGB to BGR for OpenCV
            if len(frame.shape) == 3 and frame.shape[2] == 3:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                
            return frame
        except Exception as e:
            print(f"Frame decode error: {e}")
            return None
            
    def _run_inference(self):
        """Run inference on buffered frames"""
        self.is_processing = True
        
        try:
            # Create pose data structure
            pose_data = {
                'keypoints': [p['keypoints'] for p in self.pose_buffer],
                'scores': [p['scores'] for p in self.pose_buffer]
            }
            
            # Create temporary video for dataset processing (if needed)
            temp_video = self._create_temp_video()
            
            # Run inference using UniSign
            prediction = UniSignManager.predict_from_pose(pose_data, temp_video)
            
            # Clean up temp video
            if os.path.exists(temp_video):
                os.remove(temp_video)
            
            # Store and emit result
            if prediction:
                self.last_prediction = prediction[0]['arabic']
                self.result_queue.put(prediction)
            
        except Exception as e:
            print(f"Inference error: {e}")
        finally:
            self.is_processing = False
            
    def _create_temp_video(self):
        """Create temporary video from buffered frames"""
        temp_file = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False)
        temp_path = temp_file.name
        temp_file.close()
        
        if len(self.frame_buffer) > 0:
            H, W = self.frame_buffer[0].shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(temp_path, fourcc, 30.0, (W, H))
            
            for frame in self.frame_buffer:
                out.write(frame)
            out.release()
            
        return temp_path
        
    def get_latest_result(self):
        """Get the latest prediction if available"""
        try:
            return self.result_queue.get_nowait()
        except queue.Empty:
            return None
