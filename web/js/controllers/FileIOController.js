/**
 * FileIOController
 *
 * Handles single MRI file input for muscle segmentation.
 * Auto-detects NIfTI vs DICOM files.
 */

export class FileIOController {
  constructor(options) {
    this.updateOutput = options.updateOutput || (() => {});
    this.onFileLoaded = options.onFileLoaded || (() => {});
    this.onDicomFiles = options.onDicomFiles || (() => {});

    this.activeFile = null;
  }

  getActiveFile() {
    return this.activeFile;
  }

  hasValidData() {
    return this.activeFile !== null;
  }

  static isNiftiFile(file) {
    const name = file.name.toLowerCase();
    return name.endsWith('.nii') || name.endsWith('.nii.gz');
  }

  handleFileInput(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Check if any file is NIfTI
    const niftiFile = files.find(f => FileIOController.isNiftiFile(f));
    if (niftiFile) {
      this.setFile(niftiFile);
    } else {
      // Treat as DICOM
      this.onDicomFiles(files);
    }
  }

  handleDroppedFiles(files) {
    if (!files || files.length === 0) return;

    const niftiFile = files.find(f => FileIOController.isNiftiFile(f));
    if (niftiFile) {
      this.setFile(niftiFile);
    } else {
      this.onDicomFiles(files);
    }
  }

  setFile(file) {
    this.activeFile = file;
    this.updateFileListUI([file]);
    this.updateOutput(`Loaded: ${file.name}`);
    this.onFileLoaded(file);
  }

  updateFileListUI(files) {
    const listElement = document.getElementById('fileList');
    const fileDrop = listElement?.closest('.upload-group')?.querySelector('.file-drop');

    if (!listElement) return;

    listElement.innerHTML = '';

    if (files && files.length > 0) {
      fileDrop?.classList.add('has-files');
      files.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
          <span>${file.name}</span>
          <button class="file-remove" onclick="app.clearFiles()">&times;</button>
        `;
        listElement.appendChild(fileItem);
      });

      const label = fileDrop?.querySelector('.file-drop-label span');
      if (label) label.textContent = files[0].name || '1 file selected';
    } else {
      fileDrop?.classList.remove('has-files');
      const label = fileDrop?.querySelector('.file-drop-label span');
      if (label) label.textContent = 'Drop NIfTI or DICOM files';
    }
  }

  clearFiles() {
    this.activeFile = null;
    this.updateFileListUI([]);
  }
}
