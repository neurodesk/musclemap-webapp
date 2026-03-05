/**
 * NIfTI Utilities Module
 *
 * Pure functions for parsing and creating NIfTI files.
 * Extended with affine matrix extraction for MuscleMap preprocessing.
 */

/**
 * Parse NIfTI header to extract dimensions and spatial metadata.
 * @param {ArrayBuffer} headerBuffer - 352-byte NIfTI-1 header
 * @returns {Object} Header info
 */
export function parseNiftiHeader(headerBuffer) {
  const view = new DataView(headerBuffer);

  const dims = [];
  for (let i = 0; i < 8; i++) {
    dims.push(view.getInt16(40 + i * 2, true));
  }

  const pixDims = [];
  for (let i = 0; i < 8; i++) {
    pixDims.push(view.getFloat32(76 + i * 4, true));
  }

  return {
    dims: dims,
    nx: dims[1],
    ny: dims[2],
    nz: dims[3],
    pixDims: pixDims,
    voxelSize: [pixDims[1] || 1, pixDims[2] || 1, pixDims[3] || 1],
    datatype: view.getInt16(70, true),
    bitpix: view.getInt16(72, true),
    voxOffset: view.getFloat32(108, true),
    sclSlope: view.getFloat32(112, true) || 1,
    sclInter: view.getFloat32(116, true) || 0,
  };
}

/**
 * Extract the 4x4 affine matrix from a NIfTI header.
 * Prefers sform if available, falls back to qform.
 * @param {DataView} view - DataView of the NIfTI header
 * @returns {Float64Array[]} 4x4 affine as array of 4 rows
 */
export function extractAffine(view) {
  const sformCode = view.getInt16(254, true);
  const qformCode = view.getInt16(252, true);

  if (sformCode > 0) {
    return extractSformAffine(view);
  } else if (qformCode > 0) {
    return extractQformAffine(view);
  }

  // Default: identity with pixdims
  const pixDims = [];
  for (let i = 0; i < 4; i++) {
    pixDims.push(view.getFloat32(76 + i * 4, true));
  }
  return [
    new Float64Array([pixDims[1] || 1, 0, 0, 0]),
    new Float64Array([0, pixDims[2] || 1, 0, 0]),
    new Float64Array([0, 0, pixDims[3] || 1, 0]),
    new Float64Array([0, 0, 0, 1])
  ];
}

function extractSformAffine(view) {
  // srow_x at offset 280, srow_y at 296, srow_z at 312 (each 4 float32s)
  const affine = [
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array([0, 0, 0, 1])
  ];
  for (let i = 0; i < 4; i++) {
    affine[0][i] = view.getFloat32(280 + i * 4, true);
    affine[1][i] = view.getFloat32(296 + i * 4, true);
    affine[2][i] = view.getFloat32(312 + i * 4, true);
  }
  return affine;
}

function extractQformAffine(view) {
  const pixDims = [];
  for (let i = 0; i < 4; i++) {
    pixDims.push(view.getFloat32(76 + i * 4, true));
  }

  // Quaternion parameters
  const qb = view.getFloat32(256, true);
  const qc = view.getFloat32(260, true);
  const qd = view.getFloat32(264, true);
  const qx = view.getFloat32(268, true);
  const qy = view.getFloat32(272, true);
  const qz = view.getFloat32(276, true);

  // Compute qa
  const sqr = qb * qb + qc * qc + qd * qd;
  const qa = sqr > 1.0 ? 0.0 : Math.sqrt(1.0 - sqr);

  // Rotation matrix from quaternion
  const R = [
    [qa*qa + qb*qb - qc*qc - qd*qd, 2*(qb*qc - qa*qd), 2*(qb*qd + qa*qc)],
    [2*(qb*qc + qa*qd), qa*qa + qc*qc - qb*qb - qd*qd, 2*(qc*qd - qa*qb)],
    [2*(qb*qd - qa*qc), 2*(qc*qd + qa*qb), qa*qa + qd*qd - qb*qb - qc*qc]
  ];

  // qfac for z-flip
  const qfac = pixDims[0] < 0 ? -1 : 1;

  const affine = [
    new Float64Array([R[0][0] * pixDims[1], R[0][1] * pixDims[2], R[0][2] * pixDims[3] * qfac, qx]),
    new Float64Array([R[1][0] * pixDims[1], R[1][1] * pixDims[2], R[1][2] * pixDims[3] * qfac, qy]),
    new Float64Array([R[2][0] * pixDims[1], R[2][1] * pixDims[2], R[2][2] * pixDims[3] * qfac, qz]),
    new Float64Array([0, 0, 0, 1])
  ];
  return affine;
}

/**
 * Check if data is gzip compressed
 */
export function isGzipped(data) {
  return data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Read NIfTI image data from uncompressed buffer
 */
export function readNiftiImageData(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const dims = [];
  for (let i = 0; i < 8; i++) {
    dims.push(view.getInt16(40 + i * 2, true));
  }
  const nTotal = dims[1] * dims[2] * dims[3];

  const datatype = view.getInt16(70, true);
  const voxOffset = view.getFloat32(108, true);
  const sclSlope = view.getFloat32(112, true) || 1;
  const sclInter = view.getFloat32(116, true) || 0;
  const dataStart = Math.ceil(voxOffset);
  const result = new Float64Array(nTotal);

  switch (datatype) {
    case 2: // UINT8
      for (let i = 0; i < nTotal; i++) result[i] = data[dataStart + i] * sclSlope + sclInter;
      break;
    case 4: // INT16
      for (let i = 0; i < nTotal; i++) result[i] = view.getInt16(dataStart + i * 2, true) * sclSlope + sclInter;
      break;
    case 8: // INT32
      for (let i = 0; i < nTotal; i++) result[i] = view.getInt32(dataStart + i * 4, true) * sclSlope + sclInter;
      break;
    case 16: // FLOAT32
      for (let i = 0; i < nTotal; i++) result[i] = view.getFloat32(dataStart + i * 4, true) * sclSlope + sclInter;
      break;
    case 64: // FLOAT64
      for (let i = 0; i < nTotal; i++) result[i] = view.getFloat64(dataStart + i * 8, true) * sclSlope + sclInter;
      break;
    case 512: // UINT16
      for (let i = 0; i < nTotal; i++) result[i] = view.getUint16(dataStart + i * 2, true) * sclSlope + sclInter;
      break;
    default:
      throw new Error(`Unsupported NIfTI datatype: ${datatype}`);
  }

  return result;
}

/**
 * Create a NIfTI buffer with uint8 label data.
 */
export function createUint8Nifti(uint8Data, sourceHeader) {
  const srcView = new DataView(sourceHeader);
  const voxOffset = srcView.getFloat32(108, true);
  const headerSize = Math.ceil(voxOffset);

  const buffer = new ArrayBuffer(headerSize + uint8Data.length);
  const destBytes = new Uint8Array(buffer);
  const destView = new DataView(buffer);

  destBytes.set(new Uint8Array(sourceHeader).slice(0, headerSize));

  // Datatype = UINT8 (2), bitpix = 8
  destView.setInt16(70, 2, true);
  destView.setInt16(72, 8, true);
  destView.setInt16(40, 3, true); // dim[0] = 3
  destView.setInt16(48, 1, true); // dim[4] = 1
  destView.setFloat32(112, 1, true); // scl_slope = 1
  destView.setFloat32(116, 0, true); // scl_inter = 0

  new Uint8Array(buffer, headerSize).set(uint8Data);
  return buffer;
}

/**
 * Create a NIfTI buffer with float32 data.
 */
export function createFloat32Nifti(float32Data, sourceHeader) {
  const srcView = new DataView(sourceHeader);
  const voxOffset = srcView.getFloat32(108, true);
  const headerSize = Math.ceil(voxOffset);

  const dataSize = float32Data.length * 4;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const destBytes = new Uint8Array(buffer);
  const destView = new DataView(buffer);

  destBytes.set(new Uint8Array(sourceHeader).slice(0, headerSize));

  destView.setInt16(70, 16, true); // FLOAT32
  destView.setInt16(72, 32, true);
  destView.setInt16(40, 3, true);
  destView.setInt16(48, 1, true);
  destView.setFloat32(112, 1, true);
  destView.setFloat32(116, 0, true);

  new Float32Array(buffer, headerSize).set(float32Data);
  return buffer;
}

/**
 * Create a minimal NIfTI header from NiiVue volume.
 */
export function createNiftiHeaderFromVolume(vol) {
  const headerSize = 352;
  const buffer = new ArrayBuffer(headerSize);
  const view = new DataView(buffer);
  const hdr = vol.hdr;

  view.setInt32(0, 348, true);
  const dims = hdr.dims || [3, vol.dims[1], vol.dims[2], vol.dims[3], 1, 1, 1, 1];
  for (let i = 0; i < 8; i++) view.setInt16(40 + i * 2, dims[i] || 0, true);
  view.setInt16(70, 16, true);
  view.setInt16(72, 32, true);
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

  return buffer;
}

/**
 * Extract the header portion of a NIfTI file.
 */
export function extractNiftiHeader(niftiData) {
  const view = new DataView(niftiData.buffer, niftiData.byteOffset, niftiData.byteLength);
  const voxOffset = view.getFloat32(108, true);
  const headerSize = Math.ceil(voxOffset);
  const header = new ArrayBuffer(headerSize);
  new Uint8Array(header).set(niftiData.slice(0, headerSize));
  return header;
}
