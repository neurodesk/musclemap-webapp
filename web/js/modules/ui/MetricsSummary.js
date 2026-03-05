/**
 * Metrics Summary Card
 *
 * Displays volumetric metrics summary and provides CSV download
 * after segmentation completes.
 */
export class MetricsSummary {
  constructor(containerId = 'metricsSummary') {
    this.containerId = containerId;
    this.metrics = null;
    this.detectedLabels = null;
  }

  /**
   * Show metrics summary card.
   * @param {object} metrics - { labelVolumes, labelSliceCounts, totalVolumeMl, voxelSizeMm, totalSlices }
   * @param {Array<{index: number, name: string}>} detectedLabels
   */
  show(metrics, detectedLabels) {
    this.metrics = metrics;
    this.detectedLabels = detectedLabels;

    const container = document.getElementById(this.containerId);
    if (!container) return;

    const content = container.querySelector('.section-content');
    if (!content) return;

    content.innerHTML = '';

    // Summary stats row
    const header = document.createElement('div');
    header.className = 'metrics-header';

    const muscleCount = detectedLabels.length;
    const totalVol = metrics.totalVolumeMl;
    const vs = metrics.voxelSizeMm;

    header.appendChild(this._createStat(muscleCount, 'Muscles'));
    header.appendChild(this._createStat(totalVol.toFixed(1), 'Total ml'));
    header.appendChild(this._createStat(
      `${vs[0].toFixed(1)} x ${vs[1].toFixed(1)} x ${vs[2].toFixed(1)}`,
      'Voxel mm'
    ));

    content.appendChild(header);

    // Download CSV button
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn btn-secondary btn-sm';
    dlBtn.style.cssText = 'width: 100%; margin-top: var(--space-sm);';
    dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Metrics CSV`;
    dlBtn.addEventListener('click', () => this._downloadCSV());
    content.appendChild(dlBtn);

    container.classList.remove('hidden');
  }

  hide() {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.classList.add('hidden');
      const content = container.querySelector('.section-content');
      if (content) content.innerHTML = '';
    }
    this.metrics = null;
    this.detectedLabels = null;
  }

  _createStat(value, label) {
    const stat = document.createElement('div');
    stat.className = 'metrics-stat';

    const valEl = document.createElement('span');
    valEl.className = 'metrics-stat-value';
    valEl.textContent = value;

    const labEl = document.createElement('span');
    labEl.className = 'metrics-stat-label';
    labEl.textContent = label;

    stat.appendChild(valEl);
    stat.appendChild(labEl);
    return stat;
  }

  _downloadCSV() {
    if (!this.metrics || !this.detectedLabels) return;

    const rows = ['label_index,label_name,volume_ml,slice_count'];

    for (const label of this.detectedLabels) {
      const vol = this.metrics.labelVolumes[label.index] || 0;
      const slices = this.metrics.labelSliceCounts[label.index] || 0;
      const name = `"${label.name.replace(/"/g, '""')}"`;
      rows.push(`${label.index},${name},${vol.toFixed(4)},${slices}`);
    }

    // Total row
    rows.push(`,"TOTAL",${this.metrics.totalVolumeMl.toFixed(4)},`);

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'musclemap_metrics.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
