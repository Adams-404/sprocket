import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlices } from '../src/utils/stitch.js';

test('fallback telemetry generates valid 1-frame capture slice', () => {
  // Simulating fallback telemetry when content script cannot be queried
  const fallbackTelemetry = {
    title: 'Active Page',
    url: 'https://devin.ai',
    totalWidth: 1280,
    totalHeight: 800,
    viewportWidth: 1280,
    viewportHeight: 800,
    dpr: 1,
    scrollX: 0,
    scrollY: 0
  };

  const slices = calculateSlices(fallbackTelemetry);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].destY, 0);
  assert.equal(slices[0].destHeight, 800);
});

test('fallback telemetry scales properly with DPR 2', () => {
  const fallbackTelemetry = {
    title: 'High DPI Page',
    url: 'https://example.com',
    totalWidth: 1440,
    totalHeight: 900,
    viewportWidth: 1440,
    viewportHeight: 900,
    dpr: 2
  };

  const slices = calculateSlices(fallbackTelemetry);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].destWidth, 2880);
  assert.equal(slices[0].destHeight, 1800);
});
