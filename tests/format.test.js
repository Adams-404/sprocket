import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFilename, formatBytes, formatDimensions, dataUrlToBlob } from '../src/utils/format.js';

test('generateFilename produces clean, safe filenames', () => {
  const fixedDate = new Date('2026-10-02T13:45:30Z');

  const filename = generateFilename({
    title: 'My Project: Cool / Dashboard & Tools * [Live]',
    url: 'https://app.example.com/dashboard?view=matrix',
    mode: 'full',
    format: 'png',
    date: fixedDate
  });

  assert.ok(filename.startsWith('sprocket_full_app-example-com_'));
  assert.ok(filename.endsWith('.png'));
  // Ensure no illegal filesystem characters
  assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  assert.match(filename, /^sprocket_[a-z0-9-_]+\.png$/i);
});

test('generateFilename handles empty or invalid inputs gracefully', () => {
  const filename = generateFilename();
  assert.ok(filename.startsWith('sprocket_full_'));
  assert.ok(filename.endsWith('.png'));
});

test('generateFilename correctly maps jpeg extension to jpg', () => {
  const filename = generateFilename({
    title: 'Photo',
    url: 'https://unsplash.com',
    format: 'jpeg'
  });
  assert.ok(filename.endsWith('.jpg'));
});

test('formatBytes formats binary magnitudes accurately', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024 * 2.5), '2.5 MB');
});

test('formatDimensions returns clean telemetry strings', () => {
  const dims1 = formatDimensions(1920, 1080, 1);
  assert.equal(dims1, '1920 × 1080 px (16:9)');

  const dims2 = formatDimensions(1440, 900, 2);
  assert.equal(dims2, '1440 × 900 px (8:5) @ 2x DPR');
});

test('dataUrlToBlob converts base64 image data to Blob', () => {
  // 1x1 transparent PNG in base64
  const transparentPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const blob = dataUrlToBlob(transparentPng);

  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0);
});
