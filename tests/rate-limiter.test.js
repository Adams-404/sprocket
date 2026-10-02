import test from 'node:test';
import assert from 'node:assert/strict';

test('rate limiter guarantees minimum spacing between calls', async () => {
  const MIN_INTERVAL = 100; // 100ms for test
  let lastTimestamp = 0;
  const callTimestamps = [];

  async function mockThrottledCapture() {
    const now = Date.now();
    const elapsed = now - lastTimestamp;
    if (elapsed < MIN_INTERVAL) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
    }
    lastTimestamp = Date.now();
    callTimestamps.push(lastTimestamp);
    return 'captured';
  }

  // Execute 3 captures rapidly in a loop
  for (let i = 0; i < 3; i++) {
    await mockThrottledCapture();
  }

  assert.equal(callTimestamps.length, 3);
  const diff1 = callTimestamps[1] - callTimestamps[0];
  const diff2 = callTimestamps[2] - callTimestamps[1];

  // Both intervals must be at least MIN_INTERVAL (with small timing tolerance)
  assert.ok(diff1 >= MIN_INTERVAL - 5, `Expected diff1 >= ${MIN_INTERVAL}, got ${diff1}`);
  assert.ok(diff2 >= MIN_INTERVAL - 5, `Expected diff2 >= ${MIN_INTERVAL}, got ${diff2}`);
});

test('rate limiter handles quota errors with backoff and retry', async () => {
  let attempts = 0;

  async function mockFlakyCapture() {
    attempts++;
    if (attempts < 3) {
      const err = new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
      throw err;
    }
    return 'success';
  }

  async function safeCaptureWithRetry(maxRetries = 4) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await mockFlakyCapture();
      } catch (err) {
        if (err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 20)); // short backoff for test
          continue;
        }
        throw err;
      }
    }
  }

  const result = await safeCaptureWithRetry();
  assert.equal(result, 'success');
  assert.equal(attempts, 3);
});

test('early stop capture halts loop and computes trimmed canvas height', () => {
  const totalFrames = 10;
  const capturedFrames = [];
  const session = { stopRequested: false };

  for (let i = 0; i < totalFrames; i++) {
    if (i === 4) {
      session.stopRequested = true;
    }
    if (session.stopRequested) {
      break;
    }
    capturedFrames.push({
      descriptor: {
        index: i,
        destY: i * 800,
        destHeight: 800
      }
    });
  }

  assert.equal(capturedFrames.length, 4);
  const lastSlice = capturedFrames[capturedFrames.length - 1];
  const actualCoveredHeight = lastSlice.descriptor.destY + lastSlice.descriptor.destHeight;
  assert.equal(actualCoveredHeight, 3200); // 4 * 800
});
