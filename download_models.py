from rtmlib import Wholebody
import numpy as np
dummy = np.zeros((480, 640, 3), dtype=np.uint8)
wb = Wholebody(to_openpose=False, mode='lightweight', backend='onnxruntime', device='cpu')
wb(dummy)
print('RTMPose models downloaded successfully')
