import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlices, clampBoundingBox } from '../src/utils/stitch.js';

test('calculateSlices handles single viewport page', () => {
  const slices = calculateSlices({
    totalWidth: 1200,
    totalHeight: 800,
    viewportWidth: 1200,
    viewportHeight: 900,
    dpr: 1
  });

  assert.equal(slices.length, 1);
  assert.deepEqual(slices[0], {
    index: 0,
    scrollY: 0,
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1200,
    sourceHeight: 800,
    destX: 0,
    destY: 0,
    destWidth: 1200,
    destHeight: 800
  });
});

test('calculateSlices handles exact multiples of viewport height', () => {
  const slices = calculateSlices({
    totalWidth: 1000,
    totalHeight: 3000,
    viewportWidth: 1000,
    viewportHeight: 1000,
    dpr: 1
  });

  assert.equal(slices.length, 3);
  assert.equal(slices[0].scrollY, 0);
  assert.equal(slices[0].destY, 0);

  assert.equal(slices[1].scrollY, 1000);
  assert.equal(slices[1].destY, 1000);

  assert.equal(slices[2].scrollY, 2000);
  assert.equal(slices[2].destY, 2000);
});

test('calculateSlices handles fractional remainders without repeating pixels', () => {
  // Page is 2500px high, viewport is 1000px high.
  // Slices:
  // Slice 0: Y=0..1000 (1000px)
  // Slice 1: Y=1000..2000 (1000px)
  // Slice 2: remainder is 500px.
  // Window scrolls to max: 2500 - 1000 = 1500.
  // In the viewport (0..1000), top 500px is already captured (from 1500..2000).
  // So crop should start at sourceY: 500, with sourceHeight: 500.
  // DestY should be 2000, destHeight: 500.
  const slices = calculateSlices({
    totalWidth: 1000,
    totalHeight: 2500,
    viewportWidth: 1000,
    viewportHeight: 1000,
    dpr: 1
  });

  assert.equal(slices.length, 3);

  // Frame 0
  assert.equal(slices[0].scrollY, 0);
  assert.equal(slices[0].sourceY, 0);
  assert.equal(slices[0].sourceHeight, 1000);
  assert.equal(slices[0].destY, 0);
  assert.equal(slices[0].destHeight, 1000);

  // Frame 1
  assert.equal(slices[1].scrollY, 1000);
  assert.equal(slices[1].sourceY, 0);
  assert.equal(slices[1].sourceHeight, 1000);
  assert.equal(slices[1].destY, 1000);
  assert.equal(slices[1].destHeight, 1000);

  // Frame 2 (remainder frame)
  assert.equal(slices[2].scrollY, 1500); // 2500 - 1000
  assert.equal(slices[2].sourceY, 500);  // 1000 - 500
  assert.equal(slices[2].sourceHeight, 500);
  assert.equal(slices[2].destY, 2000);
  assert.equal(slices[2].destHeight, 500);

  // Total stitched canvas height covers exactly 2500px
  const totalCovered = slices.reduce((acc, s) => acc + s.destHeight, 0);
  assert.equal(totalCovered, 2500);
});

test('calculateSlices correctly scales with Retina DPR (2.0x)', () => {
  const slices = calculateSlices({
    totalWidth: 1000,
    totalHeight: 2000,
    viewportWidth: 1000,
    viewportHeight: 1000,
    dpr: 2
  });

  assert.equal(slices.length, 2);
  // Source width and destination width in device pixels
  assert.equal(slices[0].sourceWidth, 2000);
  assert.equal(slices[0].sourceHeight, 2000);
  assert.equal(slices[0].destWidth, 2000);
  assert.equal(slices[0].destHeight, 2000);

  assert.equal(slices[1].destY, 2000);
  assert.equal(slices[1].destHeight, 2000);
});

test('clampBoundingBox clamps box coordinates within image bounds', () => {
  const box = { x: -50, y: 10, width: 600, height: 400 };
  const clamped = clampBoundingBox(box, 500, 500, 1);

  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 10);
  assert.equal(clamped.width, 500); // Clamped so x + width <= 500
  assert.equal(clamped.height, 400);
});

test('clampBoundingBox handles inverted negative drag dimensions', () => {
  // Dragged from (300, 300) up-left to (100, 100) -> width = -200, height = -200
  const box = { x: 300, y: 300, width: -200, height: -200 };
  const clamped = clampBoundingBox(box, 1000, 1000, 1);

  assert.equal(clamped.x, 100);
  assert.equal(clamped.y, 100);
  assert.equal(clamped.width, 200);
  assert.equal(clamped.height, 200);
});
