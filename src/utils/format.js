/**
 * Sprocket - Formatting & Data Utilities
 * Clean, dependable helper functions for filenames, sizes, and binary conversions.
 */

/**
 * Sanitizes a title string and hostname into a clean, safe filename.
 * Example: "GitHub - Adams-404/sprocket: A tool", "github.com" -> "sprocket_github-com_Adams-404-sprocket_20261002_130542.png"
 *
 * @param {Object} options
 * @param {string} [options.title=''] - Page title
 * @param {string} [options.url=''] - Page URL
 * @param {string} [options.mode='full'] - Capture mode ('full', 'viewport', 'region')
 * @param {string} [options.format='png'] - Extension ('png', 'jpeg', 'webp')
 * @param {Date} [options.date=new Date()] - Capture timestamp
 * @returns {string} Sanitized filename
 */
export function generateFilename({
  title = '',
  url = '',
  mode = 'full',
  format = 'png',
  date = new Date()
} = {}) {
  let hostname = '';
  try {
    if (url) {
      const parsed = new URL(url);
      hostname = parsed.hostname.replace(/^www\./, '');
    }
  } catch {
    hostname = 'web';
  }

  // Sanitize hostname: keep alphanumerics and dashes
  const cleanHost = (hostname || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  // Sanitize title: remove illegal filename characters, condense spaces/symbols
  const cleanTitle = (title || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  // Timestamp format: YYYYMMDD_HHMMSS
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

  const prefix = 'sprocket';
  const parts = [prefix, mode, cleanHost, cleanTitle, timestamp].filter(Boolean);
  const ext = format === 'jpeg' ? 'jpg' : format.toLowerCase();

  return `${parts.join('_')}.${ext}`;
}

/**
 * Formats a byte number into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Formats pixel dimensions with optional aspect ratio and device pixel ratio.
 * @param {number} width
 * @param {number} height
 * @param {number} [dpr=1]
 * @returns {string}
 */
export function formatDimensions(width, height, dpr = 1) {
  const w = Math.round(width);
  const h = Math.round(height);
  const dprStr = dpr > 1 ? ` @ ${dpr}x DPR` : '';

  // Approximate common aspect ratios
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(w, h);
  let ratioStr = '';
  if (divisor > 0) {
    const rx = Math.round(w / divisor);
    const ry = Math.round(h / divisor);
    if (rx < 40 && ry < 40) {
      ratioStr = ` (${rx}:${ry})`;
    }
  }

  return `${w} × ${h} px${ratioStr}${dprStr}`;
}

/**
 * Converts a base64 Data URL to a native binary Blob.
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new TypeError('Invalid dataUrl supplied to dataUrlToBlob');
  }

  const parts = dataUrl.split(',');
  if (parts.length < 2) {
    throw new Error('Malformed Data URL');
  }

  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binaryString = atob(parts[1]);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

/**
 * Reads a Blob as a Data URL string.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
