export const VERSION = '0.1.0';

// Models - relative path (served from same origin)
export const MODEL_BASE_URL = './models';

export const MODELS = [
  { name: 'musclemap-wholebody.onnx', label: 'Whole Body' }
];

export const INFERENCE_DEFAULTS = {
  roiSize: [256, 256],
  numClasses: 100,
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
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all'
};

export const CACHE_CONFIG = {
  name: 'MuscleMapModelCache',
  storeName: 'models',
  maxSizeMB: 500
};

if (typeof self !== 'undefined') self.MuscleMapConfig = { VERSION, MODEL_BASE_URL, MODELS, INFERENCE_DEFAULTS, VIEWER_CONFIG, PROGRESS_CONFIG, STAGE_NAMES, ONNX_CONFIG, CACHE_CONFIG };
