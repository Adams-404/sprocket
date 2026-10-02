/**
 * Sprocket - Popup Controller
 * Manages active page telemetry display, capture triggers, mechanical audio,
 * and user preferences.
 */

import { playShutterSound } from '../utils/audio.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusPill = document.getElementById('status-pill');
  const statusLabel = document.getElementById('status-label');
  const telemetryPanel = document.getElementById('telemetry-panel');
  const telemetryHost = document.getElementById('telemetry-host');
  const metricCanvas = document.getElementById('metric-canvas');
  const metricFrames = document.getElementById('metric-frames');
  const metricDpr = document.getElementById('metric-dpr');
  const badgeFrames = document.getElementById('badge-frames');
  const unsupportedBanner = document.getElementById('unsupported-banner');
  const progressPanel = document.getElementById('progress-panel');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const actionControls = document.getElementById('action-controls');

  const btnCaptureFull = document.getElementById('btn-capture-full');
  const btnCaptureViewport = document.getElementById('btn-capture-viewport');
  const btnCaptureRegion = document.getElementById('btn-capture-region');

  const toggleSound = document.getElementById('toggle-shutter-sound');
  const selectFormat = document.getElementById('select-format');

  let currentTab = null;
  let currentTelemetry = null;
  let soundEnabled = true;

  // 1. Load preferences
  const prefs = await chrome.storage.local.get(['sprocket_sound', 'sprocket_format']);
  if (prefs.sprocket_sound !== undefined) {
    soundEnabled = prefs.sprocket_sound;
    toggleSound.checked = soundEnabled;
  }
  if (prefs.sprocket_format) {
    selectFormat.value = prefs.sprocket_format;
  }

  // Preference change listeners
  toggleSound.addEventListener('change', async () => {
    soundEnabled = toggleSound.checked;
    await chrome.storage.local.set({ sprocket_sound: soundEnabled });
    if (soundEnabled) {
      playShutterSound({ enabled: true });
    }
  });

  selectFormat.addEventListener('change', async () => {
    await chrome.storage.local.set({ sprocket_format: selectFormat.value });
  });

  // 2. Query active tab and telemetry
  try {
    const response = await chrome.runtime.sendMessage({ action: 'SPROCKET_GET_ACTIVE_TELEMETRY' });

    if (!response || !response.success) {
      handleUnsupportedPage();
      return;
    }

    currentTab = response.tab;
    currentTelemetry = response.telemetry;

    // Display host and title
    let host = 'Web Page';
    try {
      const urlObj = new URL(currentTelemetry.url);
      host = urlObj.hostname.replace(/^www\./, '');
    } catch {
      host = currentTelemetry.title || 'Current Page';
    }
    telemetryHost.textContent = host;
    telemetryHost.title = currentTelemetry.title || currentTelemetry.url;

    // Dimensions
    const totalW = Math.round(currentTelemetry.totalWidth);
    const totalH = Math.round(currentTelemetry.totalHeight);
    metricCanvas.textContent = `${totalW} × ${totalH}`;

    // Estimated Frames
    const frames = Math.max(1, Math.ceil(currentTelemetry.totalHeight / currentTelemetry.viewportHeight));
    metricFrames.textContent = `${frames}`;
    badgeFrames.textContent = `${frames} FRAME${frames > 1 ? 'S' : ''}`;

    // DPR
    const dpr = currentTelemetry.dpr || 1;
    metricDpr.textContent = `${dpr}x DPR`;

    setReadyState();
  } catch (err) {
    console.debug('Failed to get telemetry:', err);
    handleUnsupportedPage();
  }

  function handleUnsupportedPage() {
    statusPill.className = 'status-indicator error';
    statusLabel.textContent = 'RESTRICTED';
    telemetryPanel.style.opacity = '0.5';
    telemetryHost.textContent = 'Restricted Internal Page';
    metricCanvas.textContent = '-- × --';
    metricFrames.textContent = '--';
    metricDpr.textContent = '--';
    badgeFrames.textContent = 'N/A';
    unsupportedBanner.style.display = 'flex';

    btnCaptureFull.disabled = true;
    btnCaptureViewport.disabled = true;
    btnCaptureRegion.disabled = true;
  }

  function setReadyState() {
    statusPill.className = 'status-indicator';
    statusLabel.textContent = 'READY';
    btnCaptureFull.disabled = false;
    btnCaptureViewport.disabled = false;
    btnCaptureRegion.disabled = false;
  }

  function setBusyState(message = 'EXPOSING...') {
    statusPill.className = 'status-indicator busy';
    statusLabel.textContent = 'BUSY';
    btnCaptureFull.disabled = true;
    btnCaptureViewport.disabled = true;
    btnCaptureRegion.disabled = true;

    progressPanel.style.display = 'flex';
    progressStatus.textContent = message;
    progressFill.style.width = '20%';
    progressPercent.textContent = '20%';
  }

  // --- Button Handlers ---

  // Full Page Capture
  btnCaptureFull.addEventListener('click', async () => {
    if (!currentTab) return;
    playShutterSound({ enabled: soundEnabled });
    setBusyState('STITCHING FRAMES...');

    try {
      progressFill.style.width = '60%';
      progressPercent.textContent = '60%';

      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_FULL_CAPTURE',
        tabId: currentTab.id
      });

      if (res && res.success) {
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        setTimeout(() => window.close(), 250);
      } else {
        alert(res?.error || 'Full-page capture encountered an error.');
        setReadyState();
        progressPanel.style.display = 'none';
      }
    } catch (err) {
      alert(`Capture failed: ${err.message || err}`);
      setReadyState();
      progressPanel.style.display = 'none';
    }
  });

  // Visible Viewport Capture
  btnCaptureViewport.addEventListener('click', async () => {
    if (!currentTab) return;
    playShutterSound({ enabled: soundEnabled });
    setBusyState('CAPTURING VIEWPORT...');

    try {
      await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_VISIBLE_CAPTURE',
        tabId: currentTab.id
      });
      window.close();
    } catch (err) {
      alert(`Viewport capture failed: ${err.message || err}`);
      setReadyState();
    }
  });

  // Region Selector
  btnCaptureRegion.addEventListener('click', async () => {
    if (!currentTab) return;
    try {
      await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_REGION_CAPTURE',
        tabId: currentTab.id
      });
      // Close popup immediately so user can select region on the actual web page
      window.close();
    } catch (err) {
      alert(`Region selector failed: ${err.message || err}`);
    }
  });
});
