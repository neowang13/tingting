import { ApiError } from "@/lib/api";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 8_000;
const MIN_DIMENSION = 64;

export interface ValidatedImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  extension: "jpg" | "png" | "webp" | "avif";
  width: number;
  height: number;
  bytes: Uint8Array;
}

export async function validateImageFile(file: File): Promise<ValidatedImage> {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "INVALID_IMAGE_SIZE", "Images must be between 1 byte and 8 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImage(bytes);
  if (!detected) {
    throw new ApiError(400, "INVALID_IMAGE_SIGNATURE", "Upload a genuine JPEG, PNG, WebP, or AVIF image.");
  }
  if (
    detected.width < MIN_DIMENSION ||
    detected.height < MIN_DIMENSION ||
    detected.width > MAX_DIMENSION ||
    detected.height > MAX_DIMENSION
  ) {
    throw new ApiError(400, "INVALID_IMAGE_DIMENSIONS", "Image dimensions must be between 64 and 8,000 pixels.");
  }
  return { ...detected, bytes };
}

function detectImage(bytes: Uint8Array): Omit<ValidatedImage, "bytes"> | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return {
      mimeType: "image/png",
      extension: "png",
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20)
    };
  }

  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = readJpegDimensions(bytes);
    return dimensions ? { mimeType: "image/jpeg", extension: "jpg", ...dimensions } : null;
  }

  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const dimensions = readWebpDimensions(bytes);
    return dimensions ? { mimeType: "image/webp", extension: "webp", ...dimensions } : null;
  }

  if (bytes.length >= 24 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") {
      const dimensions = readAvifDimensions(bytes);
      return dimensions ? { mimeType: "image/avif", extension: "avif", ...dimensions } : null;
    }
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8]
      };
    }
    offset += length + 2;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array) {
  const type = ascii(bytes, 12, 4);
  if (type === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUint24Little(bytes, 24),
      height: 1 + readUint24Little(bytes, 27)
    };
  }
  if (type === "VP8 " && bytes.length >= 30) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff
    };
  }
  if (type === "VP8L" && bytes.length >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readAvifDimensions(bytes: Uint8Array) {
  for (let index = 4; index + 16 < bytes.length; index += 1) {
    if (ascii(bytes, index, 4) === "ispe") {
      return {
        width: readUint32(bytes, index + 8),
        height: readUint32(bytes, index + 12)
      };
    }
  }
  return null;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint24Little(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
