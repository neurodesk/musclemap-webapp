#!/bin/bash
# One-time setup: download ONNX Runtime Web WASM files and dcm2niix WASM
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$SCRIPT_DIR/wasm"

# ONNX Runtime Web
ORT_VERSION="1.17.0"
ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist"

echo "Downloading ONNX Runtime Web v${ORT_VERSION}..."

ORT_FILES=(
  ort.min.js
  ort-wasm.js
  ort-wasm.wasm
  ort-wasm-simd.js
  ort-wasm-simd.wasm
  ort-wasm-simd-threaded.js
  ort-wasm-simd-threaded.wasm
)

for f in "${ORT_FILES[@]}"; do
  echo "  $f"
  curl -sL -o "$SCRIPT_DIR/wasm/$f" "$ORT_BASE/$f"
done

echo "Done. Files saved to wasm/"
echo ""
echo "Note: Place your ONNX model file at: $SCRIPT_DIR/models/musclemap-wholebody.onnx"
