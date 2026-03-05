# MuscleMap Web App

Browser-based whole-body muscle segmentation using a MONAI 2D UNet model running entirely client-side via ONNX Runtime Web. Segments 99 muscles from MRI — no server required.

## Quick Start

```bash
# 1. Download ONNX Runtime WASM files
cd web
bash setup.sh

# 2. Place your ONNX model
#    Convert from PyTorch (see Model Conversion below), or copy an existing one:
cp /path/to/musclemap-wholebody.onnx models/

# 3. Start the development server
bash run.sh
```

Open http://localhost:8080 in your browser.

## Usage

1. **Upload** a whole-body MRI as DICOM folder or NIfTI file
2. Optionally adjust the **sliding window overlap** in Inference Settings (50% is fast, 90% is highest quality)
3. Click **Run Segmentation**
4. View results as a colored overlay; the muscle legend shows all detected muscles
5. **Download** the segmentation as a NIfTI label map

All processing happens locally in your browser. No data is uploaded.

## Model Conversion

Convert a MuscleMap PyTorch checkpoint to ONNX:

```bash
pip install torch monai onnx onnxruntime

# FP32 (full precision, ~54 MB)
python scripts/convert_model.py --checkpoint /path/to/model.pth

# UINT8 quantized (~14 MB, faster download)
python scripts/convert_model.py --checkpoint /path/to/model.pth --quantize
```

Output is saved to `web/models/musclemap-wholebody.onnx`.

## Project Structure

```
musclemap-webapp/
├── scripts/
│   └── convert_model.py              # PyTorch → ONNX conversion
├── web/
│   ├── index.html                     # Main page
│   ├── setup.sh                       # Downloads ONNX Runtime WASM
│   ├── run.sh                         # Dev server (Python, COOP/COEP headers)
│   ├── css/styles.css
│   ├── js/
│   │   ├── musclemap-app.js           # Main orchestrator
│   │   ├── inference-worker.js        # Web Worker (full inference pipeline)
│   │   ├── app/
│   │   │   ├── config.js              # Model config, inference params
│   │   │   └── labels.js              # 99 muscle labels + colors
│   │   ├── controllers/
│   │   │   ├── FileIOController.js    # NIfTI upload
│   │   │   ├── DicomController.js     # DICOM folder upload + conversion
│   │   │   ├── ViewerController.js    # NiiVue viewer
│   │   │   └── InferenceExecutor.js   # Worker lifecycle
│   │   └── modules/
│   │       ├── inference/
│   │       │   ├── preprocessing.js   # Orient, resample, normalize, crop
│   │       │   ├── sliding-window.js  # 2D sliding window + Gaussian weighting
│   │       │   ├── postprocessing.js  # Label cleanup, inverse transforms
│   │       │   └── connected-components.js
│   │       ├── file-io/
│   │       │   └── NiftiUtils.js
│   │       └── ui/
│   │           ├── ConsoleOutput.js
│   │           ├── ProgressManager.js
│   │           ├── ModalManager.js
│   │           └── MuscleLegend.js    # Detected muscles panel
│   ├── dcm2niix/                      # DICOM→NIfTI WASM module
│   ├── nifti-js/                      # NIfTI parser library
│   ├── wasm/                          # ONNX Runtime WASM (via setup.sh)
│   └── models/                        # ONNX model (not in git)
```

## Inference Pipeline

1. **Parse** NIfTI (supports gzip, multiple datatypes)
2. **Orient** to RAS using the affine matrix
3. **Resample** to 1×1mm in-plane (keep original z spacing)
4. **Normalize** intensity (z-score over nonzero voxels)
5. **Crop** foreground bounding box + 20-voxel margin
6. **Slice-by-slice 2D inference** with sliding window and Gaussian weighting
7. **Per-label connected components** — keep largest component per muscle
8. **Inverse transform** — uncrop, resample back, reorient to original space

## Requirements

- A modern browser with WebAssembly support (Chrome, Firefox, Edge, Safari)
- Python 3 (for the development server only)
- For model conversion: `torch`, `monai`, `onnx`, `onnxruntime`

## Acknowledgements

Built on the [prostate-fiducial-seg](https://github.com/astewartau/prostate-fiducial-seg) web app template. Uses [NiiVue](https://github.com/niivue/niivue) for visualization, [ONNX Runtime Web](https://onnxruntime.ai) for inference, and [MONAI](https://monai.io) for the model architecture.
