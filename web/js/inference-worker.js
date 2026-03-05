/**
 * MuscleMap Inference Worker
 *
 * Runs ONNX model inference for 2D slice-by-slice muscle segmentation.
 * Pipeline: NIfTI parse → orient → resample → normalize → crop → 2D sliding window → postprocess → output
 */

/* global importScripts, ort, localforage, nifti */

importScripts('../wasm/ort.min.js');
importScripts('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js');
importScripts('../nifti-js/index.js');

// ==================== Message Helpers ====================

function postProgress(value, text) {
  self.postMessage({ type: 'progress', value, text });
}

function postLog(message) {
  self.postMessage({ type: 'log', message });
}

function postError(message) {
  self.postMessage({ type: 'error', message });
}

function postComplete() {
  self.postMessage({ type: 'complete' });
}

function postStageData(stage, niftiData, description) {
  self.postMessage(
    { type: 'stageData', stage, niftiData, description },
    [niftiData]
  );
}

function postDetectedLabels(labels) {
  self.postMessage({ type: 'detectedLabels', labels });
}

// ==================== NIfTI Parsing ====================

function decompressIfNeeded(data) {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof nifti !== 'undefined' && nifti.isCompressed) {
      if (nifti.isCompressed(bytes.buffer)) {
        return new Uint8Array(nifti.decompress(bytes.buffer));
      }
    }
    throw new Error('Gzipped NIfTI detected but decompression not available');
  }
  return bytes;
}

function parseNiftiInput(arrayBuffer) {
  const data = decompressIfNeeded(arrayBuffer);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const dims = [];
  for (let i = 0; i < 8; i++) dims.push(view.getInt16(40 + i * 2, true));
  const nx = dims[1], ny = dims[2], nz = dims[3];

  const pixDims = [];
  for (let i = 0; i < 8; i++) pixDims.push(view.getFloat32(76 + i * 4, true));

  const datatype = view.getInt16(70, true);
  const voxOffset = view.getFloat32(108, true);
  const sclSlope = view.getFloat32(112, true) || 1;
  const sclInter = view.getFloat32(116, true) || 0;
  const dataStart = Math.ceil(voxOffset);
  const nTotal = nx * ny * nz;

  const imageData = new Float32Array(nTotal);
  switch (datatype) {
    case 2:
      for (let i = 0; i < nTotal; i++) imageData[i] = data[dataStart + i] * sclSlope + sclInter;
      break;
    case 4:
      for (let i = 0; i < nTotal; i++) imageData[i] = view.getInt16(dataStart + i * 2, true) * sclSlope + sclInter;
      break;
    case 8:
      for (let i = 0; i < nTotal; i++) imageData[i] = view.getInt32(dataStart + i * 4, true) * sclSlope + sclInter;
      break;
    case 16:
      for (let i = 0; i < nTotal; i++) imageData[i] = view.getFloat32(dataStart + i * 4, true) * sclSlope + sclInter;
      break;
    case 64:
      for (let i = 0; i < nTotal; i++) imageData[i] = view.getFloat64(dataStart + i * 8, true) * sclSlope + sclInter;
      break;
    case 512:
      for (let i = 0; i < nTotal; i++) imageData[i] = view.getUint16(dataStart + i * 2, true) * sclSlope + sclInter;
      break;
    default:
      throw new Error(`Unsupported NIfTI datatype: ${datatype}`);
  }

  // Extract affine matrix (prefer sform)
  const affine = extractAffine(view);

  const headerSize = dataStart;
  const headerBytes = new ArrayBuffer(headerSize);
  new Uint8Array(headerBytes).set(data.slice(0, headerSize));

  return {
    imageData,
    dims: [nx, ny, nz],
    voxelSize: [Math.abs(pixDims[1]) || 1, Math.abs(pixDims[2]) || 1, Math.abs(pixDims[3]) || 1],
    headerBytes,
    affine
  };
}

function extractAffine(view) {
  const sformCode = view.getInt16(254, true);
  const qformCode = view.getInt16(252, true);

  if (sformCode > 0) {
    const affine = [new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array([0, 0, 0, 1])];
    for (let i = 0; i < 4; i++) {
      affine[0][i] = view.getFloat32(280 + i * 4, true);
      affine[1][i] = view.getFloat32(296 + i * 4, true);
      affine[2][i] = view.getFloat32(312 + i * 4, true);
    }
    return affine;
  }

  if (qformCode > 0) {
    const pixDims = [];
    for (let i = 0; i < 4; i++) pixDims.push(view.getFloat32(76 + i * 4, true));
    const qb = view.getFloat32(256, true);
    const qc = view.getFloat32(260, true);
    const qd = view.getFloat32(264, true);
    const qx = view.getFloat32(268, true);
    const qy = view.getFloat32(272, true);
    const qz = view.getFloat32(276, true);
    const sqr = qb * qb + qc * qc + qd * qd;
    const qa = sqr > 1.0 ? 0.0 : Math.sqrt(1.0 - sqr);
    const R = [
      [qa*qa+qb*qb-qc*qc-qd*qd, 2*(qb*qc-qa*qd), 2*(qb*qd+qa*qc)],
      [2*(qb*qc+qa*qd), qa*qa+qc*qc-qb*qb-qd*qd, 2*(qc*qd-qa*qb)],
      [2*(qb*qd-qa*qc), 2*(qc*qd+qa*qb), qa*qa+qd*qd-qb*qb-qc*qc]
    ];
    const qfac = pixDims[0] < 0 ? -1 : 1;
    return [
      new Float64Array([R[0][0]*pixDims[1], R[0][1]*pixDims[2], R[0][2]*pixDims[3]*qfac, qx]),
      new Float64Array([R[1][0]*pixDims[1], R[1][1]*pixDims[2], R[1][2]*pixDims[3]*qfac, qy]),
      new Float64Array([R[2][0]*pixDims[1], R[2][1]*pixDims[2], R[2][2]*pixDims[3]*qfac, qz]),
      new Float64Array([0, 0, 0, 1])
    ];
  }

  const pixDims = [];
  for (let i = 0; i < 4; i++) pixDims.push(view.getFloat32(76 + i * 4, true));
  return [
    new Float64Array([pixDims[1] || 1, 0, 0, 0]),
    new Float64Array([0, pixDims[2] || 1, 0, 0]),
    new Float64Array([0, 0, pixDims[3] || 1, 0]),
    new Float64Array([0, 0, 0, 1])
  ];
}

// ==================== NIfTI Output ====================

function createOutputNifti(uint8Data, sourceHeader, dims) {
  const srcView = new DataView(sourceHeader);
  const voxOffset = srcView.getFloat32(108, true);
  const headerSize = Math.ceil(voxOffset);

  const buffer = new ArrayBuffer(headerSize + uint8Data.length);
  const destBytes = new Uint8Array(buffer);
  const destView = new DataView(buffer);

  destBytes.set(new Uint8Array(sourceHeader).slice(0, headerSize));

  // Set datatype to UINT8
  destView.setInt16(70, 2, true);
  destView.setInt16(72, 8, true);

  // Update dims if provided
  if (dims) {
    destView.setInt16(40, 3, true);
    destView.setInt16(42, dims[0], true);
    destView.setInt16(44, dims[1], true);
    destView.setInt16(46, dims[2], true);
    destView.setInt16(48, 1, true);
  }

  destView.setFloat32(112, 1, true);
  destView.setFloat32(116, 0, true);

  new Uint8Array(buffer, headerSize).set(uint8Data);
  return buffer;
}

// ==================== Preprocessing ====================

function getOrientationTransform(affine) {
  const mat = [
    [affine[0][0], affine[0][1], affine[0][2]],
    [affine[1][0], affine[1][1], affine[1][2]],
    [affine[2][0], affine[2][1], affine[2][2]]
  ];

  const perm = [0, 0, 0];
  const flip = [false, false, false];
  const used = [false, false, false];

  for (let outAxis = 0; outAxis < 3; outAxis++) {
    let bestAxis = -1;
    let bestVal = -1;
    for (let inAxis = 0; inAxis < 3; inAxis++) {
      if (used[inAxis]) continue;
      const val = Math.abs(mat[outAxis][inAxis]);
      if (val > bestVal) {
        bestVal = val;
        bestAxis = inAxis;
      }
    }
    perm[outAxis] = bestAxis;
    flip[outAxis] = mat[outAxis][bestAxis] < 0;
    used[bestAxis] = true;
  }

  return { perm, flip };
}

function orientToRAS(data, dims, perm, flip) {
  const [nx, ny, nz] = dims;
  const srcDims = [nx, ny, nz];
  const dstDims = [srcDims[perm[0]], srcDims[perm[1]], srcDims[perm[2]]];
  const [dx, dy, dz] = dstDims;
  const result = new Float32Array(dx * dy * dz);

  for (let oz = 0; oz < dz; oz++) {
    for (let oy = 0; oy < dy; oy++) {
      for (let ox = 0; ox < dx; ox++) {
        const coords = [ox, oy, oz];
        const src = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          src[perm[i]] = flip[i] ? (dstDims[i] - 1 - coords[i]) : coords[i];
        }
        const srcIdx = src[0] + src[1] * nx + src[2] * nx * ny;
        const dstIdx = ox + oy * dx + oz * dx * dy;
        result[dstIdx] = data[srcIdx];
      }
    }
  }

  return { data: result, dims: dstDims };
}

function resampleVolume(data, dims, srcSpacing, tgtSpacing) {
  const [nx, ny, nz] = dims;
  const actualTarget = tgtSpacing.map((t, i) => t < 0 ? srcSpacing[i] : t);

  const newDims = [
    Math.round(nx * srcSpacing[0] / actualTarget[0]),
    Math.round(ny * srcSpacing[1] / actualTarget[1]),
    Math.round(nz * srcSpacing[2] / actualTarget[2])
  ];
  const [nnx, nny, nnz] = newDims;
  const result = new Float32Array(nnx * nny * nnz);

  const scaleX = (nx - 1) / Math.max(nnx - 1, 1);
  const scaleY = (ny - 1) / Math.max(nny - 1, 1);
  const scaleZ = (nz - 1) / Math.max(nnz - 1, 1);

  for (let z = 0; z < nnz; z++) {
    const sz = z * scaleZ;
    const z0 = Math.floor(sz);
    const z1 = Math.min(z0 + 1, nz - 1);
    const wz = sz - z0;
    for (let y = 0; y < nny; y++) {
      const sy = y * scaleY;
      const y0 = Math.floor(sy);
      const y1 = Math.min(y0 + 1, ny - 1);
      const wy = sy - y0;
      for (let x = 0; x < nnx; x++) {
        const sx = x * scaleX;
        const x0 = Math.floor(sx);
        const x1 = Math.min(x0 + 1, nx - 1);
        const wx = sx - x0;

        const c000 = data[x0 + y0*nx + z0*nx*ny];
        const c100 = data[x1 + y0*nx + z0*nx*ny];
        const c010 = data[x0 + y1*nx + z0*nx*ny];
        const c110 = data[x1 + y1*nx + z0*nx*ny];
        const c001 = data[x0 + y0*nx + z1*nx*ny];
        const c101 = data[x1 + y0*nx + z1*nx*ny];
        const c011 = data[x0 + y1*nx + z1*nx*ny];
        const c111 = data[x1 + y1*nx + z1*nx*ny];

        const c00 = c000*(1-wx) + c100*wx;
        const c01 = c001*(1-wx) + c101*wx;
        const c10 = c010*(1-wx) + c110*wx;
        const c11 = c011*(1-wx) + c111*wx;
        const c0 = c00*(1-wy) + c10*wy;
        const c1 = c01*(1-wy) + c11*wy;

        result[x + y*nnx + z*nnx*nny] = c0*(1-wz) + c1*wz;
      }
    }
  }

  return { data: result, dims: newDims, spacing: actualTarget };
}

function zScoreNormalizeNonzero(data) {
  const n = data.length;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] !== 0) { sum += data[i]; count++; }
  }
  if (count === 0) return new Float32Array(n);
  const mean = sum / count;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] !== 0) { const d = data[i] - mean; sumSq += d * d; }
  }
  const std = Math.sqrt(sumSq / count) || 1;
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i] !== 0) result[i] = (data[i] - mean) / std;
  }
  return result;
}

function cropForeground(data, dims, margin) {
  const [nx, ny, nz] = dims;
  let minX = nx, maxX = 0, minY = ny, maxY = 0, minZ = nz, maxZ = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (data[x + y*nx + z*nx*ny] !== 0) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
  }

  if (maxX < minX) return { data: new Float32Array(0), dims: [0,0,0], origin: [0,0,0] };

  const ox = Math.max(0, minX - margin);
  const oy = Math.max(0, minY - margin);
  const oz = Math.max(0, minZ - margin);
  const ex = Math.min(nx, maxX + margin + 1);
  const ey = Math.min(ny, maxY + margin + 1);
  const ez = Math.min(nz, maxZ + margin + 1);
  const cnx = ex - ox, cny = ey - oy, cnz = ez - oz;

  const result = new Float32Array(cnx * cny * cnz);
  for (let z = 0; z < cnz; z++) {
    for (let y = 0; y < cny; y++) {
      const srcOff = (z+oz)*nx*ny + (y+oy)*nx + ox;
      const dstOff = z*cnx*cny + y*cnx;
      result.set(data.subarray(srcOff, srcOff + cnx), dstOff);
    }
  }

  return { data: result, dims: [cnx, cny, cnz], origin: [ox, oy, oz] };
}

// ==================== Sliding Window ====================

function computeGaussianWeightMap(h, w) {
  const sigma = Math.min(h, w) / 8;
  const weights = new Float32Array(h * w);
  const cy = (h - 1) / 2;
  const cx = (w - 1) / 2;
  const s2 = 2 * sigma * sigma;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dy = y - cy, dx = x - cx;
      weights[y * w + x] = Math.exp(-(dy*dy + dx*dx) / s2);
    }
  }
  return weights;
}

function computeTilePositions(imgH, imgW, patchH, patchW, overlap) {
  const stepH = Math.max(1, Math.round(patchH * (1 - overlap)));
  const stepW = Math.max(1, Math.round(patchW * (1 - overlap)));

  const numY = Math.max(1, Math.ceil((imgH - patchH) / stepH) + 1);
  const numX = Math.max(1, Math.ceil((imgW - patchW) / stepW) + 1);

  const positions = [];
  const seen = new Set();

  for (let iy = 0; iy < numY; iy++) {
    let y = iy * stepH;
    if (y + patchH > imgH) y = Math.max(0, imgH - patchH);
    for (let ix = 0; ix < numX; ix++) {
      let x = ix * stepW;
      if (x + patchW > imgW) x = Math.max(0, imgW - patchW);
      const key = `${y},${x}`;
      if (!seen.has(key)) {
        seen.add(key);
        positions.push({ y, x });
      }
    }
  }

  return positions;
}

// ==================== Postprocessing ====================

function connectedComponents3D(binaryMask, dims) {
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const labels = new Int32Array(n);
  let nextLabel = 1;
  const parent = [0];
  const rank = [0];

  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }

  function union(a, b) {
    a = find(a); b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) { const t = a; a = b; b = t; }
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }

  const neighborOffsets = [];
  for (let dz = -1; dz <= 0; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dz === 0 && dy === 0 && dx >= 0) continue;
        neighborOffsets.push([dx, dy, dz]);
      }

  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const idx = z*ny*nx + y*nx + x;
        if (!binaryMask[idx]) continue;
        const neighborLabels = [];
        for (let i = 0; i < neighborOffsets.length; i++) {
          const nx2 = x+neighborOffsets[i][0], ny2 = y+neighborOffsets[i][1], nz2 = z+neighborOffsets[i][2];
          if (nx2<0||nx2>=nx||ny2<0||ny2>=ny||nz2<0||nz2>=nz) continue;
          const nIdx = nz2*ny*nx + ny2*nx + nx2;
          if (labels[nIdx] > 0) neighborLabels.push(labels[nIdx]);
        }
        if (neighborLabels.length === 0) {
          labels[idx] = nextLabel;
          parent.push(nextLabel);
          rank.push(0);
          nextLabel++;
        } else {
          let minLabel = find(neighborLabels[0]);
          for (let i = 1; i < neighborLabels.length; i++) {
            const c = find(neighborLabels[i]);
            if (c < minLabel) minLabel = c;
          }
          labels[idx] = minLabel;
          for (let i = 0; i < neighborLabels.length; i++) union(minLabel, neighborLabels[i]);
        }
      }

  const canonicalMap = new Map();
  let finalLabel = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] === 0) continue;
    const root = find(labels[i]);
    if (!canonicalMap.has(root)) canonicalMap.set(root, ++finalLabel);
    labels[i] = canonicalMap.get(root);
  }
  return { labels, numComponents: finalLabel };
}

function perLabelLargestComponent(labelVolume, dims, numLabels) {
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const result = new Uint8Array(n);

  for (let label = 1; label <= numLabels; label++) {
    const mask = new Uint8Array(n);
    let hasVoxels = false;
    for (let i = 0; i < n; i++) {
      if (labelVolume[i] === label) { mask[i] = 1; hasVoxels = true; }
    }
    if (!hasVoxels) continue;

    const { labels: ccLabels, numComponents } = connectedComponents3D(mask, dims);

    if (numComponents <= 1) {
      for (let i = 0; i < n; i++) if (mask[i]) result[i] = label;
    } else {
      const sizes = new Int32Array(numComponents + 1);
      for (let i = 0; i < n; i++) if (ccLabels[i] > 0) sizes[ccLabels[i]]++;
      let best = 1, bestSize = 0;
      for (let c = 1; c <= numComponents; c++) {
        if (sizes[c] > bestSize) { bestSize = sizes[c]; best = c; }
      }
      for (let i = 0; i < n; i++) if (ccLabels[i] === best) result[i] = label;
    }

    if (label % 10 === 0) {
      postProgress(0.85 + 0.10 * (label / numLabels), `Cleaning label ${label}/${numLabels}...`);
    }
  }

  return result;
}

// ==================== Inverse Transform ====================

function uncrop(croppedData, croppedDims, fullDims, origin) {
  const [nx, ny, nz] = fullDims;
  const [cnx, cny, cnz] = croppedDims;
  const [ox, oy, oz] = origin;
  const result = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < cnz; z++) {
    for (let y = 0; y < cny; y++) {
      const srcOff = z*cnx*cny + y*cnx;
      const dstOff = (z+oz)*nx*ny + (y+oy)*nx + ox;
      result.set(croppedData.subarray(srcOff, srcOff + cnx), dstOff);
    }
  }
  return result;
}

function resampleLabelsNearest(data, dims, tgtDims) {
  const [nx, ny, nz] = dims;
  const [tnx, tny, tnz] = tgtDims;
  const result = new Uint8Array(tnx * tny * tnz);
  const scaleX = (nx - 1) / Math.max(tnx - 1, 1);
  const scaleY = (ny - 1) / Math.max(tny - 1, 1);
  const scaleZ = (nz - 1) / Math.max(tnz - 1, 1);
  for (let z = 0; z < tnz; z++) {
    const sz = Math.round(z * scaleZ);
    for (let y = 0; y < tny; y++) {
      const sy = Math.round(y * scaleY);
      for (let x = 0; x < tnx; x++) {
        const sx = Math.round(x * scaleX);
        result[x + y*tnx + z*tnx*tny] = data[sx + sy*nx + sz*nx*ny];
      }
    }
  }
  return result;
}

function inverseOrient(data, dims, perm, flip, origDims) {
  const [dx, dy, dz] = dims;
  const [nx, ny, nz] = origDims;
  const result = new Uint8Array(nx * ny * nz);
  for (let oz = 0; oz < dz; oz++) {
    for (let oy = 0; oy < dy; oy++) {
      for (let ox = 0; ox < dx; ox++) {
        const coords = [ox, oy, oz];
        const src = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          src[perm[i]] = flip[i] ? (dims[i] - 1 - coords[i]) : coords[i];
        }
        const srcIdx = ox + oy*dx + oz*dx*dy;
        const dstIdx = src[0] + src[1]*nx + src[2]*nx*ny;
        result[dstIdx] = data[srcIdx];
      }
    }
  }
  return result;
}

// ==================== Model Loading ====================

async function fetchModel(url, modelName, progressBase, progressSpan) {
  const displayName = modelName || url.split('/').pop();

  try {
    const cached = await localforage.getItem(url);
    if (cached && cached.byteLength > 1000000) {
      postLog(`Model loaded from cache: ${displayName}`);
      postProgress(progressBase + progressSpan, `Cached: ${displayName}`);
      return cached;
    }
  } catch (e) { /* cache miss */ }

  postLog(`Downloading: ${displayName}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);

  const contentLength = parseInt(response.headers.get('content-length'), 10);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength) {
      const dlProgress = received / contentLength;
      const mb = (received / 1048576).toFixed(1);
      const totalMb = (contentLength / 1048576).toFixed(0);
      postProgress(progressBase + dlProgress * progressSpan, `Downloading ${displayName} (${mb}/${totalMb} MB)`);
    }
  }

  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }

  try {
    await localforage.setItem(url, data.buffer);
  } catch (e) {
    postLog('Warning: Could not cache model (storage full?)');
  }

  postLog(`Downloaded: ${displayName} (${(received / 1048576).toFixed(1)} MB)`);
  return data.buffer;
}

// ==================== Chunk Size Resolution ====================

function resolveChunkSize(setting) {
  if (typeof setting === 'number' && [1, 2, 4, 8].includes(setting)) {
    return setting;
  }
  // Auto mode: detect device memory
  const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
  const availableMB = deviceMemory * 1024 * 0.3; // use 30% of total
  const perChunkMB = 25; // 100 classes × 256 × 256 × 4 bytes ≈ 25 MB
  const chunkSize = Math.min(8, Math.max(1, Math.floor(availableMB / perChunkMB)));
  return chunkSize;
}

// ==================== Main Inference Pipeline ====================

async function runInference(config) {
  const { inputData, settings } = config;
  const {
    modelName = 'musclemap-wholebody.onnx',
    overlap = 0.5,
    chunkSize: chunkSizeSetting = 'auto',
    modelBaseUrl
  } = settings;

  const NUM_CLASSES = 100;
  const ROI_H = 256, ROI_W = 256;
  const TARGET_SPACING = [1.0, 1.0, -1];
  const CROP_MARGIN = 20;

  // 1. Parse NIfTI
  postLog('Parsing input volume...');
  postProgress(0.02, 'Reading NIfTI...');
  const { imageData, dims, voxelSize, headerBytes, affine } = parseNiftiInput(inputData);
  const [nx, ny, nz] = dims;
  postLog(`Volume: ${nx}x${ny}x${nz}, spacing: ${voxelSize.map(v => v.toFixed(2)).join('x')}mm`);

  const origDims = [...dims];
  const origVoxelSize = [...voxelSize];

  // 2. Orient to RAS
  postProgress(0.05, 'Orienting to RAS...');
  postLog('Orienting to RAS...');
  const { perm, flip } = getOrientationTransform(affine);
  const isIdentity = perm[0] === 0 && perm[1] === 1 && perm[2] === 2 && !flip[0] && !flip[1] && !flip[2];

  let currentData, currentDims, currentSpacing;
  if (isIdentity) {
    currentData = imageData;
    currentDims = [...dims];
    currentSpacing = [...voxelSize];
  } else {
    const oriented = orientToRAS(imageData, dims, perm, flip);
    currentData = oriented.data;
    currentDims = oriented.dims;
    // Reorder spacing according to permutation
    currentSpacing = [voxelSize[perm[0]], voxelSize[perm[1]], voxelSize[perm[2]]];
  }
  postLog(`RAS dims: ${currentDims.join('x')}`);

  const rasDims = [...currentDims];
  const rasSpacing = [...currentSpacing];

  // 3. Resample to target spacing
  postProgress(0.08, 'Resampling...');
  const needsResample = Math.abs(currentSpacing[0] - TARGET_SPACING[0]) > 0.01 ||
                         Math.abs(currentSpacing[1] - TARGET_SPACING[1]) > 0.01;

  let resampledDims;
  if (needsResample) {
    postLog('Resampling to target spacing...');
    const resampled = resampleVolume(currentData, currentDims, currentSpacing, TARGET_SPACING);
    currentData = resampled.data;
    currentDims = resampled.dims;
    currentSpacing = resampled.spacing;
    postLog(`Resampled: ${currentDims.join('x')}`);
  }
  resampledDims = [...currentDims];

  // 4. Normalize
  postProgress(0.10, 'Normalizing...');
  postLog('Z-score normalizing (nonzero voxels)...');
  currentData = zScoreNormalizeNonzero(currentData);

  // 5. Crop foreground
  postProgress(0.12, 'Cropping foreground...');
  const cropped = cropForeground(currentData, currentDims, CROP_MARGIN);
  if (cropped.dims[0] === 0) {
    throw new Error('No foreground voxels found in volume');
  }
  currentData = cropped.data;
  currentDims = cropped.dims;
  const cropOrigin = cropped.origin;
  postLog(`Cropped: ${currentDims.join('x')} (origin: ${cropOrigin.join(',')})`);

  // 6. Download and load model
  const modelUrl = `${modelBaseUrl}/${modelName}`;
  const modelData = await fetchModel(modelUrl, modelName, 0.15, 0.15);

  postProgress(0.30, 'Loading ONNX model...');
  postLog('Creating ONNX InferenceSession...');
  const session = await ort.InferenceSession.create(modelData, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });
  postLog(`Session created. Input: ${session.inputNames}, Output: ${session.outputNames}`);

  // 7. Precompute Gaussian weight map
  const gaussianWeights = computeGaussianWeightMap(ROI_H, ROI_W);

  // 8. Slice-by-slice inference
  const [cnx, cny, cnz] = currentDims;
  const labelVolume = new Uint8Array(cnx * cny * cnz);
  const sliceSize = cnx * cny;

  const resolvedChunkSize = resolveChunkSize(chunkSizeSetting);
  postLog(`Starting 2D inference: ${cnz} slices, overlap=${overlap}, chunkSize=${resolvedChunkSize}${chunkSizeSetting === 'auto' ? ' (auto)' : ''}`);
  const inferenceStartTime = performance.now();

  for (let z = 0; z < cnz; z++) {
    // Extract axial slice
    const slice = currentData.subarray(z * sliceSize, (z + 1) * sliceSize);

    // Check if slice has any data
    let hasData = false;
    for (let i = 0; i < sliceSize; i++) {
      if (slice[i] !== 0) { hasData = true; break; }
    }

    if (!hasData) {
      // Skip empty slices
      if (z % 20 === 0) {
        postProgress(0.32 + 0.50 * (z / cnz), `Slice ${z+1}/${cnz} (empty)`);
      }
      continue;
    }

    // Pad slice if smaller than ROI
    let inferH = cny, inferW = cnx;
    let paddedSlice = slice;
    let padOffsetX = 0, padOffsetY = 0;

    if (cny < ROI_H || cnx < ROI_W) {
      inferH = Math.max(cny, ROI_H);
      inferW = Math.max(cnx, ROI_W);
      paddedSlice = new Float32Array(inferH * inferW);
      padOffsetY = Math.floor((inferH - cny) / 2);
      padOffsetX = Math.floor((inferW - cnx) / 2);
      for (let y = 0; y < cny; y++) {
        paddedSlice.set(
          slice.subarray(y * cnx, y * cnx + cnx),
          (y + padOffsetY) * inferW + padOffsetX
        );
      }
    }

    // Compute tiles
    const tiles = computeTilePositions(inferH, inferW, ROI_H, ROI_W, overlap);

    // Accumulation buffers for this slice
    const accumSize = NUM_CLASSES * inferH * inferW;
    let accum, weightSum;

    if (accumSize <= 100_000_000) {
      // Full accumulation
      accum = new Float32Array(accumSize);
      weightSum = new Float32Array(inferH * inferW);

      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const pixelCount = inferH * inferW;
      const patchSize = ROI_H * ROI_W;

      // Process tiles in chunks
      for (let ti = 0; ti < tiles.length; ti += resolvedChunkSize) {
        const chunkTiles = tiles.slice(ti, ti + resolvedChunkSize);
        const N = chunkTiles.length;

        // Build batched input [N, 1, ROI_H, ROI_W]
        const batchInput = new Float32Array(N * patchSize);
        for (let b = 0; b < N; b++) {
          const tile = chunkTiles[b];
          for (let py = 0; py < ROI_H; py++) {
            const srcOff = (tile.y + py) * inferW + tile.x;
            const dstOff = b * patchSize + py * ROI_W;
            batchInput.set(paddedSlice.subarray(srcOff, srcOff + ROI_W), dstOff);
          }
        }

        // Run batched inference
        const inputTensor = new ort.Tensor('float32', batchInput, [N, 1, ROI_H, ROI_W]);
        const results = await session.run({ [inputName]: inputTensor });
        const output = results[outputName].data;
        inputTensor.dispose();

        // Accumulate Gaussian-weighted predictions for each tile in chunk
        const outputPerTile = NUM_CLASSES * patchSize;
        for (let b = 0; b < N; b++) {
          const tile = chunkTiles[b];
          const batchOffset = b * outputPerTile;

          for (let c = 0; c < NUM_CLASSES; c++) {
            for (let py = 0; py < ROI_H; py++) {
              for (let px = 0; px < ROI_W; px++) {
                const gw = gaussianWeights[py * ROI_W + px];
                const gy = tile.y + py;
                const gx = tile.x + px;
                const gIdx = gy * inferW + gx;
                accum[c * pixelCount + gIdx] += output[batchOffset + c * patchSize + py * ROI_W + px] * gw;
              }
            }
          }

          for (let py = 0; py < ROI_H; py++) {
            for (let px = 0; px < ROI_W; px++) {
              weightSum[(tile.y + py) * inferW + (tile.x + px)] += gaussianWeights[py * ROI_W + px];
            }
          }
        }
      }

      // Argmax for this slice
      for (let i = 0; i < pixelCount; i++) {
        if (weightSum[i] === 0) continue;
        let bestClass = 0, bestVal = -Infinity;
        for (let c = 0; c < NUM_CLASSES; c++) {
          const val = accum[c * pixelCount + i];
          if (val > bestVal) { bestVal = val; bestClass = c; }
        }

        // Map back from padded coords to original
        const py = Math.floor(i / inferW);
        const px = i % inferW;
        const oy = py - padOffsetY;
        const ox = px - padOffsetX;
        if (oy >= 0 && oy < cny && ox >= 0 && ox < cnx) {
          labelVolume[z * sliceSize + oy * cnx + ox] = bestClass;
        }
      }
    } else {
      // Very large slice: single centered patch fallback
      const patch = new Float32Array(ROI_H * ROI_W);
      const cy = Math.max(0, Math.floor((inferH - ROI_H) / 2));
      const cx = Math.max(0, Math.floor((inferW - ROI_W) / 2));
      for (let py = 0; py < ROI_H; py++) {
        const srcOff = (cy + py) * inferW + cx;
        patch.set(paddedSlice.subarray(srcOff, srcOff + ROI_W), py * ROI_W);
      }
      const inputTensor = new ort.Tensor('float32', patch, [1, 1, ROI_H, ROI_W]);
      const results = await session.run({ [session.inputNames[0]]: inputTensor });
      const output = results[session.outputNames[0]].data;
      inputTensor.dispose();

      for (let py = 0; py < ROI_H; py++) {
        for (let px = 0; px < ROI_W; px++) {
          let bestClass = 0, bestVal = -Infinity;
          for (let c = 0; c < NUM_CLASSES; c++) {
            const val = output[c * ROI_H * ROI_W + py * ROI_W + px];
            if (val > bestVal) { bestVal = val; bestClass = c; }
          }
          const oy = (cy + py) - padOffsetY;
          const ox = (cx + px) - padOffsetX;
          if (oy >= 0 && oy < cny && ox >= 0 && ox < cnx) {
            labelVolume[z * sliceSize + oy * cnx + ox] = bestClass;
          }
        }
      }
    }

    // Progress reporting
    if (z % 5 === 0 || z === cnz - 1) {
      const elapsed = (performance.now() - inferenceStartTime) / 1000;
      const eta = (elapsed / (z + 1)) * (cnz - z - 1);
      postProgress(0.32 + 0.50 * ((z + 1) / cnz), `Slice ${z+1}/${cnz} (ETA: ${eta.toFixed(0)}s)`);
    }
  }

  const totalTime = ((performance.now() - inferenceStartTime) / 1000).toFixed(1);
  postLog(`Inference complete: ${cnz} slices in ${totalTime}s`);

  // Release session
  await session.release();

  // 9. Per-label connected components cleanup
  postProgress(0.83, 'Cleaning labels (connected components)...');
  postLog('Running per-label connected component cleanup...');
  const cleanedLabels = perLabelLargestComponent(labelVolume, currentDims, NUM_CLASSES - 1);

  // 10. Inverse transform: uncrop
  postProgress(0.95, 'Inverse transform...');
  postLog('Applying inverse transforms...');
  let outputLabels = uncrop(cleanedLabels, currentDims, resampledDims, cropOrigin);

  // Inverse resample (nearest neighbor)
  if (needsResample) {
    outputLabels = resampleLabelsNearest(outputLabels, resampledDims, rasDims);
  }

  // Inverse orient
  if (!isIdentity) {
    outputLabels = inverseOrient(outputLabels, rasDims, perm, flip, origDims);
  }

  // Count detected labels
  const labelCounts = new Int32Array(NUM_CLASSES);
  for (let i = 0; i < outputLabels.length; i++) {
    if (outputLabels[i] > 0 && outputLabels[i] < NUM_CLASSES) {
      labelCounts[outputLabels[i]]++;
    }
  }
  const detectedIndices = [];
  for (let i = 1; i < NUM_CLASSES; i++) {
    if (labelCounts[i] > 0) detectedIndices.push(i);
  }
  postLog(`Detected ${detectedIndices.length} muscles`);
  postDetectedLabels(detectedIndices);

  // 11. Create output NIfTI
  const outputNifti = createOutputNifti(outputLabels, headerBytes, origDims);
  postStageData('segmentation', outputNifti, 'Muscle segmentation');

  let totalVoxels = 0;
  for (let i = 0; i < outputLabels.length; i++) {
    if (outputLabels[i] > 0) totalVoxels++;
  }
  postLog(`Output: ${totalVoxels} labeled voxels, ${detectedIndices.length} muscles`);

  postProgress(1.0, 'Complete');
  postComplete();
}

// ==================== Message Handler ====================

self.onmessage = async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      try {
        ort.env.wasm.numThreads = navigator.hardwareConcurrency > 1 ? 2 : 1;
        ort.env.wasm.wasmPaths = '../wasm/';

        localforage.config({
          name: 'MuscleMapModelCache',
          storeName: 'models'
        });

        self.postMessage({ type: 'initialized' });
      } catch (error) {
        postError(`Initialization failed: ${error.message}`);
      }
      break;

    case 'run':
      try {
        await runInference(data);
      } catch (error) {
        console.error('Inference error:', error);
        postError(error?.message || String(error));
      }
      break;
  }
};
