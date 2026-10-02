import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CRC32 calculation table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcData = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPng(width, height, pixelDrawer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression method: 0 (deflate)
  ihdr[11] = 0; // Filter method: 0 (standard)
  ihdr[12] = 0; // Interlace: 0 (none)
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image scanlines
  // Each scanline: 1 byte filter type (0x00) + width * 4 bytes RGBA
  const rowSize = 1 + width * 4;
  const rawScanlines = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawScanlines[rowOffset] = 0; // Filter byte 0 = None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelDrawer(x, y, width, height);
      rawScanlines[pixelOffset] = r;
      rawScanlines[pixelOffset + 1] = g;
      rawScanlines[pixelOffset + 2] = b;
      rawScanlines[pixelOffset + 3] = a;
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Draw Sprocket mechanical aperture icon
function drawSprocketIcon(x, y, size) {
  // Normalize to -1.0 to 1.0 coordinate space
  const nx = (x + 0.5 - size / 2) / (size / 2);
  const ny = (y + 0.5 - size / 2) / (size / 2);
  const dist = Math.sqrt(nx * nx + ny * ny);
  const angle = Math.atan2(ny, nx); // -PI to PI

  // Outside bounds
  if (dist > 0.98) {
    return [0, 0, 0, 0];
  }

  // Outer sprocket teeth (8 teeth)
  // Teeth radius: 0.72 to 0.92
  const numTeeth = 8;
  const toothAngle = (angle + Math.PI) / (2 * Math.PI) * numTeeth;
  const toothFrac = toothAngle - Math.floor(toothAngle);
  const isTooth = toothFrac < 0.5;

  // Background base plate (dark obsidian charcoal)
  const plateColor = [22, 24, 29, 255];
  const accentAmber = [255, 107, 53, 255]; // Mechanical safety orange / amber
  const darkGroove = [34, 38, 46, 255];
  const innerAperture = [12, 13, 16, 255];
  const centerPin = [255, 180, 100, 255];

  // Outer gear teeth region
  if (dist > 0.74 && dist <= 0.94) {
    if (isTooth) {
      // Antialiasing edge
      const edge = Math.min(1, Math.max(0, (0.94 - dist) * size * 0.8));
      return [accentAmber[0], accentAmber[1], accentAmber[2], Math.round(255 * edge)];
    } else {
      return [0, 0, 0, 0];
    }
  }

  // Inner gear body ring (0.50 to 0.74)
  if (dist > 0.52 && dist <= 0.74) {
    // Subtle bevel border
    if (dist > 0.71) {
      return [accentAmber[0], accentAmber[1], accentAmber[2], 255];
    }
    // Sprocket perforation holes (4 circular cutouts inside gear body)
    const holeAngle = (angle + Math.PI / 4 + Math.PI) / (2 * Math.PI) * 4;
    const holeFrac = Math.abs(holeAngle - Math.floor(holeAngle) - 0.5);
    const holeDist = Math.abs(dist - 0.62);
    if (holeFrac < 0.14 && holeDist < 0.08) {
      // Perforation cutout
      return [10, 11, 14, 255];
    }
    return plateColor;
  }

  // Lens bezel ring (0.46 to 0.52)
  if (dist > 0.46 && dist <= 0.52) {
    return darkGroove;
  }

  // Aperture chamber (0.16 to 0.46)
  if (dist > 0.16 && dist <= 0.46) {
    // 6 Aperture blades pattern
    const bladeAngle = (angle + 0.3) % (Math.PI / 3);
    const bladeLine = Math.sin(bladeAngle * 3);
    if (bladeLine > 0.85 && size >= 32) {
      return [45, 50, 60, 255]; // Blade seam line
    }
    return innerAperture;
  }

  // Center optical lens / pin (dist <= 0.16)
  if (dist <= 0.16) {
    // Center point / highlight
    if (dist < 0.07) {
      return centerPin;
    }
    return [accentAmber[0], accentAmber[1], accentAmber[2], 255];
  }

  return plateColor;
}

// Generate icons for required sizes
const sizes = [16, 32, 48, 128];
const iconsDir = path.resolve(__dirname, '../icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

for (const size of sizes) {
  const pngBuffer = createPng(size, size, (x, y) => drawSprocketIcon(x, y, size));
  const outputPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outputPath, pngBuffer);
  console.log(`✓ Generated ${outputPath} (${size}x${size}, ${pngBuffer.length} bytes)`);
}

console.log('✓ All Sprocket icons generated successfully.');
