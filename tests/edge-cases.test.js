import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlices } from '../src/utils/stitch.js';
import { generateFilename, formatBytes, formatDimensions } from '../src/utils/format.js';

test('stitching calculates correct frames for ultra-tall document (15,000px)', () => {
  const slices = calculateSlices({
    totalWidth: 1440,
    totalHeight: 15000,
    viewportWidth: 1440,
    viewportHeight: 900,
    dpr: 2
  });

  // 15000 / 900 = 16.666 -> 17 frames
  assert.equal(slices.length, 17);

  // First frame starts at scrollY 0
  assert.equal(slices[0].scrollY, 0);

  // Last frame handles remainder
  const lastSlice = slices[slices.length - 1];
  assert.equal(lastSlice.scrollY, 15000 - 900); // 14100
  // Remainder height is 15000 - (16 * 900) = 15000 - 14400 = 600 CSS px
  assert.equal(lastSlice.destHeight, 600 * 2); // In device pixels

  // Sum of destHeight in CSS px equals totalHeight
  const totalCssHeight = slices.reduce((sum, s) => sum + s.destHeight / 2, 0);
  assert.equal(totalCssHeight, 15000);
});

test('filename generator trims and cleans edge-case URLs', () => {
  const file1 = generateFilename({
    url: 'https://sub.domain.co.uk:8080/path/to/page?query=1#hash',
    title: 'Hello / World \\ Test : Colon * Star ? Question " Quote < > | Pipe',
    mode: 'region',
    format: 'png',
    date: new Date('2026-10-02T12:00:00Z')
  });

  assert.ok(file1.startsWith('sprocket_region_sub-domain-co-uk_'));
  assert.ok(!file1.includes(':'));
  assert.ok(!file1.includes('/'));
  assert.ok(!file1.includes('\\'));
  assert.ok(!file1.includes('*'));
  assert.ok(!file1.includes('?'));
});

test('formatBytes handles very large and tiny magnitudes', () => {
  assert.equal(formatBytes(-10), '0 B');
  assert.equal(formatBytes(15), '15 B');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 1.5), '1.5 GB');
});
