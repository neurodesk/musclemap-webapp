/**
 * MuscleMap - Browser-based whole-body muscle segmentation
 *
 * Main application class. Orchestrates controllers, viewer, and inference.
 */

import { FileIOController } from './controllers/FileIOController.js';
import { DicomController } from './controllers/DicomController.js';
import { ViewerController } from './controllers/ViewerController.js';
import { InferenceExecutor } from './controllers/InferenceExecutor.js';
import { ConsoleOutput } from './modules/ui/ConsoleOutput.js';
import { ProgressManager } from './modules/ui/ProgressManager.js';
import { ModalManager } from './modules/ui/ModalManager.js';
import { MuscleLegend } from './modules/ui/MuscleLegend.js';
import * as Config from './app/config.js';
import { generateNiivueColormap, getLabelName, getLabelColor, getMuscleLabels, getLabelsForModel } from './app/labels.js';

class MuscleMapApp {
  constructor() {
    // NiiVue
    this.nv = new niivue.Niivue({
      ...Config.VIEWER_CONFIG,
      onLocationChange: (data) => {
        const el = document.getElementById('intensity');
        if (el) el.innerHTML = data.string;
      }
    });

    // UI modules
    this.console = new ConsoleOutput('consoleOutput');
    this.progress = new ProgressManager(Config.PROGRESS_CONFIG);
    this.muscleLegend = new MuscleLegend('muscleLegend');

    // State
    this.inputFile = null;
    this.currentResultTab = 'input';
    this.currentModelName = Config.MODELS[0].name;

    this.init();
  }

  async init() {
    // Version display
    const versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.textContent = `v${Config.VERSION}`;
    const footerVersionEl = document.getElementById('footerVersion');
    if (footerVersionEl) footerVersionEl.textContent = `v${Config.VERSION}`;
    const aboutVersionEl = document.getElementById('aboutAppVersion');
    if (aboutVersionEl) aboutVersionEl.textContent = `v${Config.VERSION}`;

    // Controllers
    this.fileIOController = new FileIOController({
      updateOutput: (msg) => this.updateOutput(msg),
      onFileLoaded: (file) => this.onFileLoaded(file)
    });

    this.dicomController = new DicomController({
      updateOutput: (msg) => this.updateOutput(msg),
      onConversionComplete: (file) => {
        this.fileIOController.setFileFromDicom(file);
      }
    });

    this.viewerController = new ViewerController({
      nv: this.nv,
      updateOutput: (msg) => this.updateOutput(msg)
    });

    this.inferenceExecutor = new InferenceExecutor({
      updateOutput: (msg) => this.updateOutput(msg),
      setProgress: (val, text) => this.setProgress(val, text),
      onStageData: (data) => this.handleStageData(data),
      onComplete: () => this.onInferenceComplete(),
      onError: (msg) => this.onInferenceError(msg),
      onInitialized: () => {},
      onDetectedLabels: (labels) => this.showDetectedMuscles(labels)
    });

    // Modals
    this.aboutModal = new ModalManager('aboutModal');
    this.citationsModal = new ModalManager('citationsModal');
    this.privacyModal = new ModalManager('privacyModal');

    // Register custom colormap
    const colormapData = generateNiivueColormap();

    // Setup
    await this.setupViewer();

    // Register colormap after viewer is ready
    this.viewerController.registerMuscleColormap(colormapData);

    this.setupEventListeners();
    this.setupInputModeTabs();
    this.setupInfoTooltips();

    // Start ONNX initialization in background
    this.inferenceExecutor.initialize();
  }

  async setupViewer() {
    await this.nv.attachTo('gl1');
    this.nv.setMultiplanarPadPixels(5);
    this.nv.setSliceType(this.nv.sliceTypeMultiplanar);
    this.nv.setInterpolation(true);
    this.nv.drawScene();
  }

  // ==================== Event Listeners ====================

  setupEventListeners() {
    const niftiInput = document.getElementById('niftiInput');
    if (niftiInput) {
      niftiInput.addEventListener('change', (e) => this.fileIOController.handleFileInput(e));
    }

    const dicomInput = document.getElementById('dicomInput');
    if (dicomInput) {
      dicomInput.addEventListener('change', (e) => {
        this.dicomController.convertFiles(Array.from(e.target.files));
      });
    }

    this.setupDropZone('niftiDropZone', 'nifti');
    this.setupDropZone('dicomDropZone', 'dicom');

    const runBtn = document.getElementById('runSegmentation');
    if (runBtn) runBtn.addEventListener('click', () => this.runSegmentation());

    const cancelBtn = document.getElementById('cancelButton');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelSegmentation());

    const copyConsole = document.getElementById('copyConsole');
    if (copyConsole) copyConsole.addEventListener('click', () => this.console.copyToClipboard());

    const clearConsole = document.getElementById('clearConsole');
    if (clearConsole) clearConsole.addEventListener('click', () => this.console.clear());

    document.querySelectorAll('.view-tab[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-tab[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewerController.setViewType(btn.dataset.view);
      });
    });

    const opacitySlider = document.getElementById('overlayOpacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.viewerController.setOverlayOpacity(val);
        const display = document.getElementById('overlayOpacityValue');
        if (display) display.textContent = `${Math.round(val * 100)}%`;
      });
    }

    this.setupWindowControls();

    const interpToggle = document.getElementById('interpolation');
    if (interpToggle) {
      interpToggle.addEventListener('change', (e) => {
        this.nv.setInterpolation(!e.target.checked);
        this.nv.drawScene();
      });
    }

    const colorbarToggle = document.getElementById('colorbarToggle');
    if (colorbarToggle) {
      colorbarToggle.addEventListener('change', (e) => {
        this.nv.opts.isColorbar = e.target.checked;
        this.nv.drawScene();
      });
    }

    const crosshairToggle = document.getElementById('crosshairToggle');
    if (crosshairToggle) {
      crosshairToggle.addEventListener('change', (e) => {
        this.nv.setCrosshairWidth(e.target.checked ? 1 : 0);
      });
    }

    const downloadBtn = document.getElementById('downloadCurrentVolume');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.downloadCurrentVolume());
    }

    const screenshotBtn = document.getElementById('screenshotViewer');
    if (screenshotBtn) {
      screenshotBtn.addEventListener('click', () => this.saveScreenshot());
    }

    const colormapSelect = document.getElementById('colormapSelect');
    if (colormapSelect) {
      colormapSelect.addEventListener('change', (e) => {
        if (this.nv.volumes?.length) {
          this.nv.volumes[0].colormap = e.target.value;
          this.nv.updateGLVolume();
        }
      });
    }

    const clearResults = document.getElementById('clearResults');
    if (clearResults) clearResults.addEventListener('click', () => this.clearResults());

    // Modal buttons
    const aboutBtn = document.getElementById('aboutButton');
    if (aboutBtn) aboutBtn.addEventListener('click', () => this.aboutModal.open());
    const closeAbout = document.getElementById('closeAbout');
    if (closeAbout) closeAbout.addEventListener('click', () => this.aboutModal.close());

    const citationsBtn = document.getElementById('citationsButton');
    if (citationsBtn) citationsBtn.addEventListener('click', () => this.citationsModal.open());
    const closeCitations = document.getElementById('closeCitations');
    if (closeCitations) closeCitations.addEventListener('click', () => this.citationsModal.close());

    const privacyBtn = document.getElementById('privacyButton');
    if (privacyBtn) privacyBtn.addEventListener('click', () => this.privacyModal.open());
    const closePrivacy = document.getElementById('closePrivacy');
    if (closePrivacy) closePrivacy.addEventListener('click', () => this.privacyModal.close());
  }

  setupDropZone(zoneId, mode) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');

      if (mode === 'dicom') {
        this.dicomController.convertDropItems(e.dataTransfer.items);
      } else {
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          this.fileIOController.niftiFile = files[0];
          this.fileIOController.updateFileListUI('nifti', [files[0]]);
          this.fileIOController.updateOutput(`Loaded: ${files[0].name}`);
          this.fileIOController.onFileLoaded(files[0]);
        }
      }
    });
  }

  setupInputModeTabs() {
    document.querySelectorAll('.input-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        this.fileIOController.setInputMode(mode);

        document.querySelectorAll('.input-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.input-mode-content').forEach(c => c.classList.remove('active'));
        const content = document.getElementById(`${mode}Mode`);
        if (content) content.classList.add('active');
      });
    });
  }

  setupInfoTooltips() {
    document.querySelectorAll('.info-icon').forEach(icon => {
      const tooltip = icon.querySelector('.info-tooltip');
      if (!tooltip) return;

      icon.addEventListener('mouseenter', () => {
        tooltip.style.display = 'block';
        const iconRect = icon.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        let top = iconRect.top - tipRect.height - 6;
        let left = iconRect.left + iconRect.width / 2 - tipRect.width / 2;
        if (top < 4) top = iconRect.bottom + 6;
        left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
      });

      icon.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });
  }

  // ==================== Viewer Controls ====================

  setupWindowControls() {
    const rangeMin = document.getElementById('rangeMin');
    const rangeMax = document.getElementById('rangeMax');
    const windowMin = document.getElementById('windowMin');
    const windowMax = document.getElementById('windowMax');
    const resetBtn = document.getElementById('resetWindow');
    if (!rangeMin || !rangeMax || !windowMin || !windowMax) return;

    const updateSelected = () => {
      const selected = document.getElementById('rangeSelected');
      if (!selected) return;
      const min = parseFloat(rangeMin.value);
      const max = parseFloat(rangeMax.value);
      selected.style.left = `${min}%`;
      selected.style.width = `${max - min}%`;
    };

    const applyFromSliders = () => {
      if (!this.nv.volumes.length) return;
      const vol = this.nv.volumes[0];
      const dataMin = vol.global_min ?? 0;
      const dataMax = vol.global_max ?? 1;
      const range = dataMax - dataMin || 1;
      const newMin = dataMin + (parseFloat(rangeMin.value) / 100) * range;
      const newMax = dataMin + (parseFloat(rangeMax.value) / 100) * range;
      windowMin.value = newMin.toPrecision(4);
      windowMax.value = newMax.toPrecision(4);
      vol.cal_min = newMin;
      vol.cal_max = newMax;
      this.nv.updateGLVolume();
      updateSelected();
    };

    const applyFromInputs = () => {
      if (!this.nv.volumes.length) return;
      const vol = this.nv.volumes[0];
      const newMin = parseFloat(windowMin.value);
      const newMax = parseFloat(windowMax.value);
      if (isNaN(newMin) || isNaN(newMax)) return;
      vol.cal_min = newMin;
      vol.cal_max = newMax;
      this.nv.updateGLVolume();
      this.syncSlidersToVolume();
    };

    rangeMin.addEventListener('input', () => {
      if (parseFloat(rangeMin.value) > parseFloat(rangeMax.value) - 1) {
        rangeMin.value = parseFloat(rangeMax.value) - 1;
      }
      applyFromSliders();
    });

    rangeMax.addEventListener('input', () => {
      if (parseFloat(rangeMax.value) < parseFloat(rangeMin.value) + 1) {
        rangeMax.value = parseFloat(rangeMin.value) + 1;
      }
      applyFromSliders();
    });

    windowMin.addEventListener('change', applyFromInputs);
    windowMax.addEventListener('change', applyFromInputs);

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!this.nv.volumes.length) return;
        const vol = this.nv.volumes[0];
        vol.cal_min = vol.global_min ?? 0;
        vol.cal_max = vol.global_max ?? 1;
        this.nv.updateGLVolume();
        this.syncWindowControls();
      });
    }
  }

  syncWindowControls() {
    if (!this.nv.volumes.length) return;
    const vol = this.nv.volumes[0];
    const windowMin = document.getElementById('windowMin');
    const windowMax = document.getElementById('windowMax');
    if (windowMin) windowMin.value = (vol.cal_min ?? 0).toPrecision(4);
    if (windowMax) windowMax.value = (vol.cal_max ?? 1).toPrecision(4);
    this.syncSlidersToVolume();
    const dlBtn = document.getElementById('downloadCurrentVolume');
    if (dlBtn) dlBtn.disabled = false;
  }

  syncSlidersToVolume() {
    if (!this.nv.volumes.length) return;
    const vol = this.nv.volumes[0];
    const dataMin = vol.global_min ?? 0;
    const dataMax = vol.global_max ?? 1;
    const range = dataMax - dataMin || 1;
    const rangeMin = document.getElementById('rangeMin');
    const rangeMax = document.getElementById('rangeMax');
    const selected = document.getElementById('rangeSelected');
    if (!rangeMin || !rangeMax) return;
    const pctMin = Math.max(0, Math.min(100, ((vol.cal_min - dataMin) / range) * 100));
    const pctMax = Math.max(0, Math.min(100, ((vol.cal_max - dataMin) / range) * 100));
    rangeMin.value = pctMin;
    rangeMax.value = pctMax;
    if (selected) {
      selected.style.left = `${pctMin}%`;
      selected.style.width = `${pctMax - pctMin}%`;
    }
  }

  downloadCurrentVolume() {
    if (!this.nv.volumes?.length) {
      this.updateOutput('No volume loaded');
      return;
    }
    const vol = this.nv.volumes[0];
    const name = (vol.name || 'volume').replace(/\.(nii|nii\.gz)$/i, '');
    const niftiBuffer = this.createNiftiFromVolume(vol);
    const blob = new Blob([niftiBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.nii`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateOutput(`Downloaded: ${name}.nii`);
  }

  createNiftiFromVolume(vol) {
    const hdr = vol.hdr;
    const img = vol.img;
    let datatype = 16, bitpix = 32, bytesPerVoxel = 4;
    if (img instanceof Float64Array) { datatype = 64; bitpix = 64; bytesPerVoxel = 8; }
    else if (img instanceof Int16Array) { datatype = 4; bitpix = 16; bytesPerVoxel = 2; }
    else if (img instanceof Uint8Array) { datatype = 2; bitpix = 8; bytesPerVoxel = 1; }

    const headerSize = 352;
    const buffer = new ArrayBuffer(headerSize + img.length * bytesPerVoxel);
    const view = new DataView(buffer);

    view.setInt32(0, 348, true);
    const dims = hdr.dims || [3, vol.dims[1], vol.dims[2], vol.dims[3], 1, 1, 1, 1];
    for (let i = 0; i < 8; i++) view.setInt16(40 + i * 2, dims[i] || 0, true);
    view.setInt16(70, datatype, true);
    view.setInt16(72, bitpix, true);
    const pixdim = hdr.pixDims || [1, 1, 1, 1, 1, 1, 1, 1];
    for (let i = 0; i < 8; i++) view.setFloat32(76 + i * 4, pixdim[i] || 1, true);
    view.setFloat32(108, headerSize, true);
    view.setFloat32(112, hdr.scl_slope || 1, true);
    view.setFloat32(116, hdr.scl_inter || 0, true);
    view.setUint8(123, 10);
    view.setInt16(252, hdr.qform_code || 1, true);
    view.setInt16(254, hdr.sform_code || 1, true);
    if (hdr.affine) {
      for (let i = 0; i < 4; i++) {
        view.setFloat32(280 + i * 4, hdr.affine[0][i] || 0, true);
        view.setFloat32(296 + i * 4, hdr.affine[1][i] || 0, true);
        view.setFloat32(312 + i * 4, hdr.affine[2][i] || 0, true);
      }
    }
    view.setUint8(344, 0x6E);
    view.setUint8(345, 0x2B);
    view.setUint8(346, 0x31);
    view.setUint8(347, 0x00);

    new Uint8Array(buffer, headerSize).set(new Uint8Array(img.buffer, img.byteOffset, img.byteLength));
    return buffer;
  }

  saveScreenshot() {
    let filename = 'musclemap_screenshot.png';
    if (this.nv.volumes?.length) {
      const name = (this.nv.volumes[0].name || 'volume').replace(/\.(nii|nii\.gz)$/i, '');
      filename = `${name}_screenshot.png`;
    }
    this.nv.saveScene(filename);
    this.updateOutput(`Screenshot saved: ${filename}`);
  }

  // ==================== File Handling ====================

  async onFileLoaded(file) {
    this.inputFile = file;
    await this.viewerController.loadBaseVolume(file);
    this.syncWindowControls();

    const runBtn = document.getElementById('runSegmentation');
    if (runBtn) runBtn.disabled = false;

    this.currentResultTab = 'input';
    document.querySelectorAll('.stage-btn').forEach(b => b.classList.remove('active'));
    const overlayControl = document.getElementById('overlayControl');
    if (overlayControl) overlayControl.classList.add('hidden');

    // Hide legend
    this.muscleLegend.hide();
  }

  // ==================== Inference ====================

  async runSegmentation() {
    if (!this.fileIOController.hasValidData()) {
      this.updateOutput('No input volume loaded');
      return;
    }

    const file = this.fileIOController.getActiveFile();

    // Get model selection
    const modelSelect = document.getElementById('modelSelect');
    const selectedModelName = modelSelect ? modelSelect.value : Config.MODELS[0].name;
    const modelConfig = Config.MODELS.find(m => m.name === selectedModelName) || Config.MODELS[0];

    // Get overlap setting
    const overlapSelect = document.getElementById('overlapSelect');
    const overlap = overlapSelect ? parseFloat(overlapSelect.value) : Config.INFERENCE_DEFAULTS.overlap;

    // Get chunk size setting
    const chunkSizeSelect = document.getElementById('chunkSizeSelect');
    const chunkSizeRaw = chunkSizeSelect ? chunkSizeSelect.value : Config.INFERENCE_DEFAULTS.chunkSize;
    const chunkSize = chunkSizeRaw === 'auto' ? 'auto' : parseInt(chunkSizeRaw, 10);

    const modelBaseUrl = new URL(Config.MODEL_BASE_URL, window.location.href).href;
    const inputData = await file.arrayBuffer();

    const runBtn = document.getElementById('runSegmentation');
    const cancelBtn = document.getElementById('cancelButton');
    if (runBtn) runBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = false;

    // Clear previous
    this.inferenceExecutor.clearResults();
    this.disableAllResultTabs();
    this.muscleLegend.hide();

    // Store selected model for result display
    this.currentModelName = modelConfig.name;

    // Re-register colormap with model-specific labels
    const modelLabels = getLabelsForModel(modelConfig.name);
    const colormapData = generateNiivueColormap(modelLabels);
    this.viewerController.registerMuscleColormap(colormapData);

    await this.inferenceExecutor.run({
      inputData,
      settings: {
        modelName: modelConfig.name,
        numClasses: modelConfig.numClasses,
        roiSize: modelConfig.roiSize,
        overlap,
        chunkSize,
        modelBaseUrl
      }
    });
  }

  cancelSegmentation() {
    this.inferenceExecutor.cancel();
    const runBtn = document.getElementById('runSegmentation');
    const cancelBtn = document.getElementById('cancelButton');
    if (runBtn) runBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;
  }

  // ==================== Results ====================

  handleStageData(data) {
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
      resultsSection.classList.remove('collapsed');
    }

    if (!document.getElementById('stage-item-input')) {
      this.addStageButton('input');
    }

    this.addStageButton(data.stage);

    // Auto-show segmentation when it arrives
    if (data.stage === 'segmentation') {
      this.showResult('segmentation');
    }
  }

  addStageButton(stage) {
    const container = document.getElementById('stageButtons');
    if (!container || document.getElementById(`stage-item-${stage}`)) return;

    const displayName = Config.STAGE_NAMES[stage] || stage;

    const item = document.createElement('div');
    item.className = 'stage-item';
    item.id = `stage-item-${stage}`;

    const showBtn = document.createElement('button');
    showBtn.className = 'btn stage-btn';
    showBtn.textContent = displayName;
    showBtn.addEventListener('click', () => this.showResult(stage));
    item.appendChild(showBtn);

    if (stage !== 'input') {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'download-btn';
      dlBtn.title = `Download ${displayName}`;
      dlBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      dlBtn.addEventListener('click', () => this.inferenceExecutor.downloadStage(stage));
      item.appendChild(dlBtn);
    }

    container.appendChild(item);
  }

  showDetectedMuscles(labelIndices) {
    const modelLabels = getLabelsForModel(this.currentModelName);
    const allLabels = getMuscleLabels(modelLabels);
    const detected = labelIndices.map(idx => {
      const label = allLabels.find(l => l.index === idx);
      return label || { index: idx, name: getLabelName(idx, modelLabels), color: getLabelColor(idx, modelLabels) };
    });
    this.muscleLegend.show(detected);
  }

  onInferenceComplete() {
    const runBtn = document.getElementById('runSegmentation');
    const cancelBtn = document.getElementById('cancelButton');
    const statusText = document.getElementById('statusText');
    if (runBtn) runBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;
    if (statusText) statusText.textContent = 'Ready';
  }

  onInferenceError(msg) {
    const runBtn = document.getElementById('runSegmentation');
    const cancelBtn = document.getElementById('cancelButton');
    const statusText = document.getElementById('statusText');
    if (runBtn) runBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;
    if (statusText) statusText.textContent = 'Error';
  }

  async showResult(stage) {
    this.currentResultTab = stage;

    document.querySelectorAll('.stage-btn').forEach(b => b.classList.remove('active'));
    const item = document.getElementById(`stage-item-${stage}`);
    if (item) {
      const btn = item.querySelector('.stage-btn');
      if (btn) btn.classList.add('active');
    }

    const overlayControl = document.getElementById('overlayControl');

    if (stage === 'input') {
      if (overlayControl) overlayControl.classList.add('hidden');
      if (this.inputFile) {
        await this.viewerController.loadBaseVolume(this.inputFile);
        this.syncWindowControls();
      }
      return;
    }

    const result = this.inferenceExecutor.getResult(stage);
    if (!result?.file || !this.inputFile) return;

    if (overlayControl) overlayControl.classList.remove('hidden');

    await this.viewerController.showResultAsOverlay(this.inputFile, result.file, 'musclemap');
    this.syncWindowControls();
  }

  disableAllResultTabs() {
    const container = document.getElementById('stageButtons');
    if (container) container.innerHTML = '';
  }

  clearResults() {
    this.inferenceExecutor.clearResults();
    this.disableAllResultTabs();
    this.muscleLegend.hide();

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
      resultsSection.classList.add('hidden');
      resultsSection.classList.add('collapsed');
    }

    const overlayControl = document.getElementById('overlayControl');
    if (overlayControl) overlayControl.classList.add('hidden');

    if (this.inputFile) {
      this.viewerController.loadBaseVolume(this.inputFile);
    }
  }

  // ==================== UI Helpers ====================

  updateOutput(msg) {
    this.console.log(msg);
  }

  setProgress(value, text) {
    this.progress.setProgress(value);
    const statusText = document.getElementById('statusText');
    if (statusText) {
      if (value >= 1) statusText.textContent = 'Complete';
      else if (text) statusText.textContent = text;
      else if (value > 0) statusText.textContent = 'Processing...';
    }
  }

  removeFile(type, index) {
    this.fileIOController.removeFile(type, index);
  }

  clearFiles(type) {
    this.fileIOController.clearFiles(type);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new MuscleMapApp();
});
