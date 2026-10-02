/**
 * Sprocket - Mechanical Shutter Audio Synthesizer
 * Uses Web Audio API to synthesize an authentic tactile camera shutter sound.
 * Zero external audio files required. Completely offline & instantaneous.
 */

let sharedAudioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContextClass();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Synthesizes a mechanical SLR focal-plane shutter sound:
 * 1. Initial mirror-flip click (resonant metallic transient)
 * 2. Shutter curtain transit (pink-filtered noise flutter)
 * 3. Sprocket gear advance tick (crisp micro-pulse)
 *
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true] - Whether audio should play
 * @param {number} [options.volume=0.3] - Master volume (0.0 to 1.0)
 */
export function playShutterSound({ enabled = true, volume = 0.3 } = {}) {
  if (!enabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1.0, volume)), now);
    masterGain.connect(ctx.destination);

    // --- Phase 1: Mechanical Mirror Flip (High resonant transient) ---
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.04);

    oscGain.gain.setValueAtTime(0.8, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.05);

    // --- Phase 2: Shutter Curtain Transit (Filtered noise burst) ---
    const bufferSize = Math.floor(ctx.sampleRate * 0.08); // 80ms noise
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now + 0.015);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.08);
    filter.Q.value = 3.0;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0, now);
    noiseGain.gain.setValueAtTime(0.6, now + 0.015);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);

    whiteNoise.start(now + 0.015);
    whiteNoise.stop(now + 0.085);

    // --- Phase 3: Sprocket Gear Advance Tick (120ms mark) ---
    const tickOsc = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tickOsc.type = 'square';
    tickOsc.frequency.setValueAtTime(3200, now + 0.09);
    tickOsc.frequency.exponentialRampToValueAtTime(400, now + 0.11);

    tickGain.gain.setValueAtTime(0.0, now);
    tickGain.gain.setValueAtTime(0.4, now + 0.09);
    tickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    tickOsc.connect(tickGain);
    tickGain.connect(masterGain);

    tickOsc.start(now + 0.09);
    tickOsc.stop(now + 0.125);
  } catch (err) {
    console.debug('Sprocket: Audio playback skipped', err);
  }
}
