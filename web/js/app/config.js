export const VERSION = '0.2.1';

// Models - relative path (served from same origin)
export const MODEL_BASE_URL = './models';

export const MODELS = [
  { name: 'musclemap-wholebody.onnx', label: 'Whole Body', numClasses: 100, roiSize: [256, 256] },
  { name: 'musclemap-abdomen.onnx', label: 'Abdomen', numClasses: 9, roiSize: [128, 128] },
  { name: 'musclemap-forearm.onnx', label: 'Forearm', numClasses: 6, roiSize: [256, 256] },
  { name: 'musclemap-leg.onnx', label: 'Leg', numClasses: 15, roiSize: [128, 128] },
  { name: 'musclemap-pelvis.onnx', label: 'Pelvis', numClasses: 14, roiSize: [128, 128] },
  { name: 'musclemap-thigh.onnx', label: 'Thigh', numClasses: 29, roiSize: [128, 128] },
];

export const INFERENCE_DEFAULTS = {
  targetSpacing: [1.0, 1.0, -1], // -1 means keep original z spacing
  cropForegroundMargin: 20,
  overlap: 0.5, // 50% overlap for sliding window
  chunkSize: 'auto' // Number of tiles per inference call ('auto' or 1/2/4/8)
};

export const VIEWER_CONFIG = {
  loadingText: "",
  dragToMeasure: false,
  isColorbar: false,
  textHeight: 0.03,
  show3Dcrosshair: false,
  crosshairColor: [0.23, 0.51, 0.96, 1.0],
  crosshairWidth: 0.75
};

export const PROGRESS_CONFIG = {
  animationSpeed: 0.5
};

export const STAGE_NAMES = {
  'input': 'Input',
  'segmentation': 'Segmentation'
};

export const ONNX_CONFIG = {
  executionProviders: ['webgpu', 'wasm'],
  graphOptimizationLevel: 'all'
};

export const CACHE_CONFIG = {
  name: 'MuscleMapModelCache',
  storeName: 'models',
  maxSizeMB: 500
};

if (typeof self !== 'undefined') self.MuscleMapConfig = { VERSION, MODEL_BASE_URL, MODELS, INFERENCE_DEFAULTS, VIEWER_CONFIG, PROGRESS_CONFIG, STAGE_NAMES, ONNX_CONFIG, CACHE_CONFIG };
