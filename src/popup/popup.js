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

  function isSupportedUrl(url) {
    if (!url) return false;
    return !/^(chrome|brave|edge|about|devtools|chrome-extension):/i.test(url) &&
           !url.startsWith('https://chrome.google.com/webstore') &&
           !url.startsWith('https://chromewebstore.google.com');
  }

  // 2. Query active tab directly from popup window context
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id || !isSupportedUrl(tab.url)) {
      handleUnsupportedPage();
      return;
    }

    currentTab = tab;

    const response = await chrome.runtime.sendMessage({
      action: 'SPROCKET_GET_TAB_TELEMETRY',
      tabId: tab.id
    });

    if (!response || !response.success || !response.telemetry) {
      handleUnsupportedPage();
      return;
    }

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

  const errorBanner = document.getElementById('error-banner');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const btnErrorClose = document.getElementById('btn-error-close');

  function showError(msg, title = 'CAPTURE ERROR') {
    errorTitle.textContent = title;
    errorMessage.textContent = msg;
    errorBanner.style.display = 'flex';
    setReadyState();
    progressPanel.style.display = 'none';
  }

  function hideError() {
    errorBanner.style.display = 'none';
  }

  const btnStopCapture = document.getElementById('btn-stop-capture');
  if (btnStopCapture) {
    btnStopCapture.addEventListener('click', async () => {
      btnStopCapture.disabled = true;
      progressStatus.textContent = 'FINISHING & STITCHING...';
      try {
        await chrome.runtime.sendMessage({ action: 'SPROCKET_STOP_CAPTURE' });
      } catch (e) {
        console.debug('Stop message failed', e);
      }
    });
  }

  // Listen for real-time progress updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'SPROCKET_PROGRESS_UPDATE') {
      progressFill.style.width = `${message.percent}%`;
      progressPercent.textContent = `${message.percent}%`;
      progressStatus.textContent = `FRAME [${message.currentFrame}/${message.totalFrames}]...`;
    }
  });

  // --- Button Handlers ---

  // Full Page Capture
  btnCaptureFull.addEventListener('click', async () => {
    if (!currentTab) return;
    hideError();
    playShutterSound({ enabled: soundEnabled });
    setBusyState('STITCHING FRAMES...');

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_FULL_CAPTURE',
        tabId: currentTab.id
      });

      if (res && res.success) {
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        setTimeout(() => window.close(), 250);
      } else {
        showError(res?.error || 'Full-page capture encountered an error.');
      }
    } catch (err) {
      showError(err.message || String(err), 'CAPTURE FAILED');
    }
  });

  // Visible Viewport Capture
  btnCaptureViewport.addEventListener('click', async () => {
    if (!currentTab) return;
    hideError();
    playShutterSound({ enabled: soundEnabled });
    setBusyState('CAPTURING VIEWPORT...');

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_VISIBLE_CAPTURE',
        tabId: currentTab.id
      });
      if (res && res.success) {
        window.close();
      } else {
        showError(res?.error || 'Viewport capture failed.');
      }
    } catch (err) {
      showError(err.message || String(err), 'VIEWPORT FAILED');
    }
  });

  // Region Selector
  btnCaptureRegion.addEventListener('click', async () => {
    if (!currentTab) return;
    hideError();
    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_REGION_CAPTURE',
        tabId: currentTab.id
      });
      if (res && res.success) {
        window.close();
      } else {
        showError(res?.error || 'Could not launch selector.');
      }
    } catch (err) {
      showError(err.message || String(err), 'SELECTOR FAILED');
    }
  });
});
