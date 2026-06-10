/**
 * ViewerController
 *
 * Manages NiiVue visualization with support for base volume and segmentation overlays.
 * Adapted for MuscleMap's discrete 100-class colormap.
 */

import { createUint8PreviewNiftiFile } from '../modules/file-io/NiftiUtils.js?v=1.2.18';

const LARGE_VOLUME_DISPLAY_LIMIT_BYTES = 256 * 1024 ** 2;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';

  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export class ViewerController {
  constructor(options) {
    this.nv = options.nv;
    this.updateOutput = options.updateOutput || (() => {});
    this.currentBaseFile = null;
    this.currentBaseDisplayFile = null;
    this.currentOverlayFile = null;
    this.currentBaseDisplayMode = 'original';
    this.muscleColormapRegistered = false;
  }

  isAvailable() {
    return !!this.nv;
  }

  /**
   * Register the MuscleMap discrete colormap with NiiVue.
   * @param {Object} colormapData - { R, G, B, A } arrays from labels.js
   */
  registerMuscleColormap(colormapData) {
    if (!this.isAvailable()) return;
    try {
      this.nv.addColormap('musclemap', colormapData);
      this.muscleColormapRegistered = true;
    } catch (e) {
      console.warn('Could not register musclemap colormap:', e);
    }
  }

  async loadBaseVolume(file) {
    if (!this.isAvailable()) return;
    try {
      const displayFile = await this._createBaseDisplayFile(file);
      this.updateOutput(`Loading ${displayFile.name}...`);
      const url = URL.createObjectURL(displayFile);
      try {
        await this.nv.loadVolumes([{ url: url, name: displayFile.name }]);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.currentBaseFile = file;
      this.currentBaseDisplayFile = displayFile;
      this.currentOverlayFile = null;
      this.updateOutput(`${displayFile.name} loaded`);
    } catch (error) {
      this.updateOutput(`Error loading ${file.name}: ${error.message}`);
      console.error(error);
    }
  }

  async _createBaseDisplayFile(file) {
    this.currentBaseDisplayMode = 'original';
    if (!this._shouldUseUint8Preview(file)) return file;

    this.updateOutput(
      `Warning: ${file.name} is ${formatBytes(file.size)}, which can exceed browser GPU texture limits. ` +
      'Displaying an 8-bit preview; segmentation will use the original NIfTI data.'
    );

    try {
      const preview = await createUint8PreviewNiftiFile(file);
      this.currentBaseDisplayMode = 'uint8-preview';
      this.updateOutput(
        `Prepared 8-bit display preview (${preview.dims.join('x')}, ` +
        `${formatBytes(preview.previewBytes)}, intensity ${preview.sourceMin.toPrecision(4)}..${preview.sourceMax.toPrecision(4)}).`
      );
      return preview.file;
    } catch (error) {
      this.updateOutput(`Warning: 8-bit display preview failed: ${error.message}. Trying the original volume.`);
      this.currentBaseDisplayMode = 'original';
      return file;
    }
  }

  _shouldUseUint8Preview(file) {
    const name = file?.name?.toLowerCase?.() || '';
    const isNifti = name.endsWith('.nii') || name.endsWith('.nii.gz');
    return isNifti && (file?.size || 0) >= LARGE_VOLUME_DISPLAY_LIMIT_BYTES;
  }

  async loadOverlay(file, colormap = 'musclemap', opacity = 0.5) {
    if (!this.isAvailable()) return;
    try {
      const url = URL.createObjectURL(file);
      await this.nv.addVolumeFromUrl({ url: url, name: file.name, colormap: colormap });
      URL.revokeObjectURL(url);

      if (this.nv.volumes.length > 1) {
        // Force display range so uint8 label values map 1:1 to colormap indices.
        // NiiVue auto-detects range from data (e.g. 0-8), which compresses all
        // labels into the first few % of the LUT. Setting cal_max=255 ensures
        // value N maps to colormap entry N.
        this.nv.volumes[1].cal_min = 0;
        this.nv.volumes[1].cal_max = 255;
        this.nv.setOpacity(1, opacity);
        this.nv.updateGLVolume();
      }

      this.currentOverlayFile = file;
    } catch (error) {
      this.updateOutput(`Error loading overlay: ${error.message}`);
      console.error(error);
    }
  }

  async showResultAsOverlay(baseFile, overlayFile, colormap = 'musclemap') {
    await this.loadBaseVolume(baseFile);
    if (overlayFile) {
      await this.loadOverlay(overlayFile, colormap);
    }
  }

  setViewType(type) {
    if (!this.isAvailable()) return;
    const typeMap = {
      multiplanar: this.nv.sliceTypeMultiplanar,
      axial: this.nv.sliceTypeAxial,
      coronal: this.nv.sliceTypeCoronal,
      sagittal: this.nv.sliceTypeSagittal,
      render: this.nv.sliceTypeRender
    };
    if (typeMap[type] !== undefined) {
      this.nv.setSliceType(typeMap[type]);
    }
  }

  setBaseOpacity(value) {
    if (!this.isAvailable()) return;
    if (this.nv.volumes.length > 0) {
      this.nv.setOpacity(0, value);
      this.nv.updateGLVolume();
    }
  }

  setOverlayOpacity(value) {
    if (!this.isAvailable()) return;
    if (this.nv.volumes.length > 1) {
      this.nv.setOpacity(1, value);
      this.nv.updateGLVolume();
    }
  }

  setOverlayColormap(colormap) {
    if (!this.isAvailable()) return;
    if (this.nv.volumes.length > 1) {
      this.nv.volumes[1].colormap = colormap;
      this.nv.updateGLVolume();
    }
  }

  getCurrentFile() {
    return this.currentBaseFile;
  }

  isBasePreviewActive() {
    return this.currentBaseDisplayMode !== 'original' &&
      !!this.currentBaseFile &&
      !!this.currentBaseDisplayFile &&
      this.currentBaseDisplayFile !== this.currentBaseFile;
  }
}
