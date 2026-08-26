from rtmlib import Wholebody
import numpy as np
dummy = np.zeros((480, 640, 3), dtype=np.uint8)
wb = Wholebody(to_openpose=False, mode='lightweight', backend='onnxruntime', device='cpu')
wb(dummy)
print('RTMPose models downloaded successfully')

# Arabic -> English translator used by the English output language.
# Pre-fetched here so the first user who switches to English doesn't pay the
# ~293 MB download mid-request. Non-fatal: the app falls back to Arabic text
# if this model is unavailable at runtime.
try:
    from transformers import MarianMTModel, MarianTokenizer
    MT_NAME = 'Helsinki-NLP/opus-mt-ar-en'
    MarianTokenizer.from_pretrained(MT_NAME)
    MarianMTModel.from_pretrained(MT_NAME)
    print('Arabic->English translation model downloaded successfully')
except Exception as e:
    print(f'WARNING: could not fetch the ar->en translation model: {e}')
    print('The app will still run; English output will fall back to Arabic.')
