"""
app.py  —  OSL Sign Language Translator (Modified with UniSign + RTMlib)
──────────────────────────────────────────────────────────────────
Modified to use RTMlib for pose estimation and UniSign model for inference
pip install flask flask-cors torch numpy opencv-python requests flask-socketio
python app.py  →  open http://localhost:5000
"""

import io, json, tempfile, os, re, glob, sys
from pathlib import Path
import numpy as np
from flask import Flask, render_template, request, jsonify, send_file, Response
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import torch
import cv2
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import base64
from PIL import Image
import threading
import queue
import time

# ── Add UniSign paths ─────────────────────────────────────────────────────────
UNISIGN_PATH = Path(__file__).parent / "unisign"
sys.path.insert(0, str(UNISIGN_PATH / "demo" / "rtmlib-main"))

from rtmlib import Wholebody

# Import UniSign model
sys.path.insert(0, str(UNISIGN_PATH))
from models import Uni_Sign
from datasets import S2T_Dataset_online
from torch.utils.data import DataLoader

# ── CONFIG ────────────────────────────────────────────────────────────────────
CHECKPOINT_PATH = "models/sentences_best_11pct.pth"  # UniSign model checkpoint
WORDS_TXT = "data/Words.txt"
LABEL_MAP_PATH = "data/label_map.json"
LANDMARKS_DIR = "landmarks"

# Real-time processing configuration
WINDOW_SIZE = 60  # Number of frames to process at once
STRIDE = 15  # How many frames to slide
# ──────────────────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ── Avatar landmark index ─────────────────────────────────────────────────────
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
    def load(cls, checkpoint_path, words_txt, label_map_path=None):
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
                print(f"  ⚠ Missing keys ({len(missing)})")
            if unexpected:
                print(f"  ⚠ Unexpected keys ({len(unexpected)})")
            
            cls._model.eval()
            cls._model.to(torch.bfloat16)
            cls._model.to(DEVICE)
            cls._loaded = True
            print(f"[UniSign] ✓ Model loaded on {DEVICE}")
            
        except Exception as e:
            print(f"[UniSign] Error loading model: {e}")
            cls._loaded = False
    
    @classmethod
    def predict_from_pose(cls, pose_data, video_path=None, top_k=5):
        """
        Run inference using pose data
        Args:
            pose_data: dict with 'keypoints' and 'scores'
            video_path: optional path to video file
            top_k: number of top predictions to return
        Returns:
            List of predictions with confidence scores
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
            # Since UniSign outputs text directly, we create a single prediction
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
    
    print("  Pose extraction done ✓")
    return pose_data

def extract_pose_from_frames(frames_data):
    """
    Extract pose from a list of frame arrays
    Args:
        frames_data: list of numpy arrays (frames)
    Returns:
        pose_data dict with 'keypoints' and 'scores'
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

# Global processor instances
ACTIVE_PROCESSORS = {}

# ═════════════════════════════════════════════════════════════════════════════
#  Flask Routes
# ═════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")

# ── Real-time predict (for webcam) ────────────────────────────────────────────
@app.route("/predict", methods=["POST"])
def predict():
    """
    Endpoint for real-time prediction
    Expects JSON with 'frames' field containing base64 encoded frames
    """
    try:
        data = request.get_json(force=True)
        frames_b64 = data.get("frames", [])
        
        if len(frames_b64) < 5:
            return jsonify({"success": False, "error": "too few frames"}), 400
        
        # Decode frames
        frames = []
        for frame_b64 in frames_b64:
            try:
                if ',' in frame_b64:
                    frame_b64 = frame_b64.split(',')[1]
                img_bytes = base64.b64decode(frame_b64)
                img = Image.open(io.BytesIO(img_bytes))
                frame = np.array(img)
                if len(frame.shape) == 3 and frame.shape[2] == 3:
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                frames.append(frame)
            except:
                continue
        
        if not frames:
            return jsonify({"success": False, "error": "No valid frames"}), 400
        
        # Extract pose using RTMPose
        pose_data = extract_pose_from_frames(frames)
        
        # Run inference
        preds = UniSignManager.predict_from_pose(pose_data, top_k=5)
        
        return jsonify({"success": True, "predictions": preds})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Video-file predict ────────────────────────────────────────────────────────
@app.route("/predict-video", methods=["POST"])
def predict_video():
    try:
        file = request.files.get("video")
        if not file:
            return jsonify({"success": False, "error": "No video"}), 400
        
        suffix = Path(file.filename).suffix or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        
        # Extract pose using RTMPose
        pose_data = extract_pose_from_video(tmp_path)
        
        if not pose_data or len(pose_data['keypoints']) == 0:
            os.unlink(tmp_path)
            return jsonify({"success": False, "error": "No pose detected"}), 400
        
        # Run inference
        preds = UniSignManager.predict_from_pose(pose_data, tmp_path, top_k=5)
        
        os.unlink(tmp_path)
        
        return jsonify({
            "success": True,
            "predictions": preds,
            "frames": len(pose_data['keypoints'])
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── ElevenLabs TTS ────────────────────────────────────────────────────────────
@app.route("/tts-elevenlabs", methods=["POST"])
def tts_elevenlabs():
    """Proxy text to ElevenLabs and stream back audio."""
    import requests as req
    try:
        data = request.get_json(force=True)
        text = data.get("text", "").strip()
        api_key = data.get("api_key", "")
        voice_id = data.get("voice_id", "21m00Tcm4TlvDq8ikWAM")
        model_id = data.get("model_id", "eleven_multilingual_v2")

        if not text:
            return jsonify({"success": False, "error": "Empty text"}), 400
        if not api_key:
            return jsonify({"success": False, "error": "No API key"}), 400

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        resp = req.post(url, headers=headers, json=body, timeout=30)
        if resp.status_code != 200:
            try:
                err = resp.json().get("detail", {}).get("message", resp.text[:200])
            except:
                err = resp.text[:200]
            return jsonify({"success": False, "error": err}), resp.status_code

        return send_file(io.BytesIO(resp.content), mimetype="audio/mpeg",
                         download_name="tts.mp3")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── ElevenLabs STT (Scribe) ───────────────────────────────────────────────────
@app.route("/stt-elevenlabs", methods=["POST"])
def stt_elevenlabs():
    """Send audio to ElevenLabs Scribe STT, return transcript."""
    import requests as req
    try:
        api_key = request.form.get("api_key", "")
        lang = request.form.get("lang", "ara")   # ISO-639-3
        audio = request.files.get("audio")

        if not api_key:
            return jsonify({"success": False, "error": "No API key"}), 400
        if not audio:
            return jsonify({"success": False, "error": "No audio file"}), 400

        url = "https://api.elevenlabs.io/v1/speech-to-text"
        headers = {"xi-api-key": api_key}
        files = {"file": (audio.filename or "audio.webm", audio.stream, audio.mimetype)}
        data = {"model_id": "scribe_v1", "language_code": lang}

        resp = req.post(url, headers=headers, files=files, data=data, timeout=60)
        if resp.status_code != 200:
            try:
                err = resp.json().get("detail", {}).get("message", resp.text[:200])
            except:
                err = resp.text[:200]
            return jsonify({"success": False, "error": err}), resp.status_code

        transcript = resp.json().get("text", "")
        return jsonify({"success": True, "transcript": transcript})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Avatar: word list ─────────────────────────────────────────────────────────
@app.route("/avatar/words")
def avatar_words():
    """Return list of words that have landmark animation available."""
    vocab_path = Path(WORDS_TXT)
    words = []
    if vocab_path.exists():
        for line in vocab_path.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split(maxsplit=1)
            if len(parts) == 2:
                sign_id, arabic = parts
                has_anim = sign_id in _avatar_index
                words.append({"sign_id": sign_id, "arabic": arabic, "has_anim": has_anim})
    return jsonify({"success": True, "words": words, "total": len(words)})

# ── Avatar: resolve text to sign sequence ─────────────────────────────────────
@app.route("/avatar/resolve", methods=["POST"])
def avatar_resolve():
    """
    Given a text string (Arabic words), return ordered list of sign_ids.
    Tries longest-match first so phrases/sentences are preferred over single words.
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    words = text.split()
    seq = []
    i = 0
    while i < len(words):
        # Try bigram then unigram
        matched = None
        if i + 1 < len(words):
            phrase = words[i] + " " + words[i + 1]
            if phrase in _vocab_map:
                sid = _vocab_map[phrase]
                matched = {"sign_id": sid, "word": phrase, "has_anim": sid in _avatar_index}
                i += 2
        if not matched:
            word = words[i]
            sid = _vocab_map.get(word)
            matched = {"sign_id": sid, "word": word, "has_anim": bool(sid and sid in _avatar_index)}
            if not sid:
                matched["sign_id"] = None
            i += 1
        seq.append(matched)
    return jsonify({"success": True, "sequence": seq})

# ── Avatar: serve landmark frames ─────────────────────────────────────────────
@app.route("/avatar/frames/<sign_id>")
def avatar_frames(sign_id):
    path = _avatar_index.get(sign_id)
    if not path:
        return jsonify({"success": False, "error": f"No animation for sign {sign_id}"}), 404
    arr = np.load(path).astype(np.float32)
    fmt = "543" if arr.shape[1] == 543 else "133"
    if arr.shape[2] == 3:
        frames = arr.tolist()
    else:
        z = np.zeros((*arr.shape[:2], 1), dtype=np.float32)
        frames = np.concatenate([arr, z], axis=2).tolist()
    return jsonify({"success": True, "sign_id": sign_id, "format": fmt,
                    "n_frames": len(frames), "frames": frames})

@app.route("/avatar")
def avatar_page():
    return render_template("avatar.html")

# ── Legacy gTTS fallback ──────────────────────────────────────────────────────
@app.route("/tts", methods=["POST"])
def tts_gtts():
    try:
        from gtts import gTTS
        d = request.get_json(force=True)
        text = d.get("text", "").strip()
        lang = d.get("lang", "ar")
        if not text:
            return jsonify({"success": False, "error": "empty"}), 400
        buf = io.BytesIO()
        gTTS(text=text, lang=lang, slow=False).write_to_fp(buf)
        buf.seek(0)
        return send_file(buf, mimetype="audio/mpeg", download_name="s.mp3")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Health ────────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({
        "ok": UniSignManager._loaded,
        "model": "UniSign",
        "pose_estimator": "RTMlib",
        "num_classes": len(UniSignManager._label_map),
        "avatar_signs": len(_avatar_index),
        "device": DEVICE,
    })

# ── SocketIO Events (for real-time streaming) ─────────────────────────────────
@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit('connected', {'status': 'ready'})

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    # Clean up processor if exists
    if request.sid in ACTIVE_PROCESSORS:
        ACTIVE_PROCESSORS[request.sid].stop()
        del ACTIVE_PROCESSORS[request.sid]

@socketio.on('start_realtime')
def handle_start_realtime():
    """Start real-time processing for this client"""
    if request.sid not in ACTIVE_PROCESSORS:
        processor = RealtimeProcessor()
        processor.start()
        ACTIVE_PROCESSORS[request.sid] = processor
        emit('realtime_started', {'status': 'processing'})

@socketio.on('stop_realtime')
def handle_stop_realtime():
    """Stop real-time processing for this client"""
    if request.sid in ACTIVE_PROCESSORS:
        ACTIVE_PROCESSORS[request.sid].stop()
        del ACTIVE_PROCESSORS[request.sid]
        emit('realtime_stopped', {'status': 'stopped'})

@socketio.on('frame')
def handle_frame(data):
    """Handle incoming frame from client"""
    if request.sid in ACTIVE_PROCESSORS:
        processor = ACTIVE_PROCESSORS[request.sid]
        processor.add_frame(data['frame'])
        
        # Check for results
        result = processor.get_latest_result()
        if result:
            emit('prediction', {'predictions': result})

# ══════════════════════════════════════════════════════════════════════════════
#  Initialization
# ══════════════════════════════════════════════════════════════════════════════

# Load UniSign model on startup
if Path(CHECKPOINT_PATH).exists():
    UniSignManager.load(CHECKPOINT_PATH, WORDS_TXT, LABEL_MAP_PATH)
else:
    print(f"[Warning] UniSign checkpoint not found at {CHECKPOINT_PATH}")
    print(f"[Warning] Please copy your UniSign model to {CHECKPOINT_PATH}")

# Build avatar index
_build_avatar_index()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
