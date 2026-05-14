# ─────────────────────────────────────────────
#  Uni-Sign · config.py
#  Edit paths here before running infer.py
# ─────────────────────────────────────────────

# mT5 base model — downloaded automatically from Hugging Face on first run
mt5_path = "google/mt5-base"

# ── Dataset label paths (only needed for training / evaluation) ──────────────
train_label_paths = {
    "OSL-Words":     "./data/OSL-Words/labels-osl.train",
    "OSL-Sentences": "./data/OSL-Sentences/labels-osl.train",
    "CSL_Daily":     "./data/CSL_Daily/labels.train",
    "WLASL":         "./data/WLASL/labels-100.train",
    "How2Sign":      "./data/How2Sign/labels.train",
}

dev_label_paths = {
    "OSL-Words":     "./data/OSL-Words/labels-osl.dev",
    "OSL-Sentences": "./data/OSL-Sentences/labels-osl.dev",
    "CSL_Daily":     "./data/CSL_Daily/labels.dev",
    "WLASL":         "./data/WLASL/labels-100.dev",
}

test_label_paths = {
    "OSL-Words":     "./data/OSL-Words/labels-osl.test",
    "OSL-Sentences": "./data/OSL-Sentences/labels-osl.test",
    "CSL_Daily":     "./data/CSL_Daily/labels.test",
    "WLASL":         "./data/WLASL/labels-100.test",
    "How2Sign":      "./data/How2Sign/labels.test",
}

# ── Dataset video / pose paths (only needed for training / evaluation) ────────
rgb_dirs = {
    "OSL-Words":     "./dataset/OSL-Words/rgb_format",
    "OSL-Sentences": "./dataset/OSL-Sentences/rgb_format",
    "CSL_Daily":     "./dataset/CSL_Daily/sentence-crop",
    "WLASL":         "./dataset/WLASL/rgb_format",
    "How2Sign":      "./dataset/How2Sign/rgb_format",
}

pose_dirs = {
    "OSL-Words":     "./dataset/OSL-Words/pose_format",
    "OSL-Sentences": "./dataset/OSL-Sentences/pose_format",
    "CSL_Daily":     "./dataset/CSL_Daily/pose_format",
    "WLASL":         "./dataset/WLASL/pose_format",
    "How2Sign":      "./dataset/How2Sign/pose_format",
}
