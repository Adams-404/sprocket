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

  const progressPanel = document.getElementById('progress-panel');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatus = document.getElementById('progress-status');
  const btnStopCapture = document.getElementById('btn-stop-capture');

  const btnCaptureFull = document.getElementById('btn-capture-full');
  const btnCaptureViewport = document.getElementById('btn-capture-viewport');
  const btnCaptureRegion = document.getElementById('btn-capture-region');

  const toggleSound = document.getElementById('toggle-shutter-sound');
  const selectFormat = document.getElementById('select-format');
  const selectResolution = document.getElementById('select-resolution');

  const errorBanner = document.getElementById('error-banner');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');
  const btnErrorClose = document.getElementById('btn-error-close');

  let currentTab = null;
  let currentTelemetry = null;
  let soundEnabled = true;

  // 1. Load user preferences
  try {
    const prefs = await chrome.storage.local.get(['sprocket_sound', 'sprocket_format', 'sprocket_resolution']);
    if (prefs.sprocket_sound !== undefined) {
      soundEnabled = prefs.sprocket_sound;
      toggleSound.checked = soundEnabled;
    }
    if (prefs.sprocket_format) {
      selectFormat.value = prefs.sprocket_format;
    }
    if (prefs.sprocket_resolution && selectResolution) {
      selectResolution.value = prefs.sprocket_resolution;
    }
  } catch (e) {
    console.debug('Failed to load prefs:', e);
  }

  // Preference change listeners
  toggleSound.addEventListener('change', async () => {
    soundEnabled = toggleSound.checked;
    await chrome.storage.local.set({ sprocket_sound: soundEnabled });
    if (soundEnabled) {
      playShutterSound({ enabled: true });
    }
  });

  function updateResolutionTelemetry() {
    const res = selectResolution ? selectResolution.value : '4k';
    if (res === '4k') {
      metricDpr.textContent = '4K ULTRA';
      metricDpr.title = 'Super-sampled 4K Ultra-HD capture';
    } else {
      metricDpr.textContent = '1x NATIVE';
      metricDpr.title = '1:1 native hardware display pixels';
    }
  }

  updateResolutionTelemetry();

  if (selectResolution) {
    selectResolution.addEventListener('change', async () => {
      await chrome.storage.local.set({ sprocket_resolution: selectResolution.value });
      updateResolutionTelemetry();
    });
  }

  selectFormat.addEventListener('change', async () => {
    await chrome.storage.local.set({ sprocket_format: selectFormat.value });
  });

  // State handlers - Buttons are ALWAYS enabled and ready
  function setReadyState() {
    statusPill.className = 'status-indicator';
    statusLabel.textContent = 'READY';
    btnCaptureFull.disabled = false;
    btnCaptureViewport.disabled = false;
    btnCaptureRegion.disabled = false;
    if (btnStopCapture) btnStopCapture.disabled = false;
  }

  function setBusyState(message = 'EXPOSING...') {
    statusPill.className = 'status-indicator busy';
    statusLabel.textContent = 'BUSY';
    btnCaptureFull.disabled = true;
    btnCaptureViewport.disabled = true;
    btnCaptureRegion.disabled = true;

    progressPanel.style.display = 'flex';
    progressStatus.textContent = message;
    progressFill.style.width = '15%';
    progressPercent.textContent = '15%';
  }

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

  if (btnErrorClose) {
    btnErrorClose.addEventListener('click', hideError);
  }

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

  // Robust target tab locator: checks current window, then last focused window, then any active tab
  async function getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) return tab;
    } catch {}

    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.id) return tab;
    } catch {}

    try {
      const all = await chrome.tabs.query({ active: true });
      if (all && all.length > 0) return all[0];
    } catch {}

    return null;
  }

  // Set initial ready state immediately
  setReadyState();

  // 2. Discover active tab and populate telemetry
  try {
    currentTab = await getActiveTab();

    if (currentTab) {
      let host = 'Active Page';
      if (currentTab.url) {
        try {
          const urlObj = new URL(currentTab.url);
          host = urlObj.hostname ? urlObj.hostname.replace(/^www\./, '') : (currentTab.title || 'Active Page');
        } catch {
          host = currentTab.title || 'Active Page';
        }
      } else if (currentTab.title) {
        host = currentTab.title;
      }

      telemetryHost.textContent = host;
      telemetryHost.title = currentTab.title || currentTab.url || host;

      const w = currentTab.width || 1280;
      const h = currentTab.height || 800;
      metricCanvas.textContent = `${w} × ${h}`;
      metricFrames.textContent = 'Auto';
      metricDpr.textContent = '1x DPR';
      badgeFrames.textContent = 'READY';

      // Asynchronously fetch deep DOM telemetry from content script (optional, non-blocking)
      chrome.runtime.sendMessage({
        action: 'SPROCKET_GET_TAB_TELEMETRY',
        tabId: currentTab.id
      }).then((response) => {
        if (response && response.success && response.telemetry) {
          currentTelemetry = response.telemetry;
          const t = response.telemetry;

          if (t.title) telemetryHost.title = t.title;

          const totalW = Math.round(t.totalWidth || w);
          const totalH = Math.round(t.totalHeight || h);
          metricCanvas.textContent = `${totalW} × ${totalH}`;

          const vh = t.viewportHeight || h;
          const frames = Math.max(1, Math.ceil(totalH / vh));
          metricFrames.textContent = `${frames}`;
          badgeFrames.textContent = `${frames} FRAME${frames > 1 ? 'S' : ''}`;

          const dpr = t.dpr || 1;
          metricDpr.textContent = `${dpr}x DPR`;
        }
      }).catch((err) => {
        console.debug('Non-blocking DOM telemetry fetch:', err);
      });
    } else {
      telemetryHost.textContent = 'Active Page';
      metricCanvas.textContent = 'Ready';
      metricFrames.textContent = 'Auto';
      metricDpr.textContent = '1x DPR';
    }
  } catch (err) {
    console.debug('Tab discovery error:', err);
    telemetryHost.textContent = 'Active Page';
  }

  // Listen for real-time frame progress updates from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'SPROCKET_PROGRESS_UPDATE') {
      progressFill.style.width = `${message.percent}%`;
      progressPercent.textContent = `${message.percent}%`;
      progressStatus.textContent = `FRAME [${message.currentFrame}/${message.totalFrames}]...`;
    }
  });

  // --- Button Handlers ---

  // Full Page Exposure
  btnCaptureFull.addEventListener('click', async () => {
    hideError();
    let tab = await getActiveTab();
    if (!tab || !tab.id) tab = currentTab;
    if (!tab || !tab.id) {
      showError('Unable to locate active webpage. Click on the page and reopen Sprocket.');
      return;
    }

    currentTab = tab;
    playShutterSound({ enabled: soundEnabled });
    setBusyState('STITCHING FRAMES...');

    const resolution = selectResolution ? selectResolution.value : '4k';
    const format = selectFormat ? selectFormat.value : 'png';

    // Trigger full-page capture in background service worker
    chrome.runtime.sendMessage({
      action: 'SPROCKET_START_FULL_CAPTURE',
      tabId: tab.id,
      windowId: tab.windowId,
      resolution,
      format
    }).catch((err) => {
      console.debug('Capture error:', err);
    });

    // Close the popup after audio triggers so user directly sees the page scroll & in-page HUD
    setTimeout(() => {
      window.close();
    }, 200);
  });

  // Visible Viewport Capture
  btnCaptureViewport.addEventListener('click', async () => {
    hideError();
    let tab = await getActiveTab();
    if (!tab || !tab.id) tab = currentTab;
    if (!tab || !tab.id) {
      showError('Unable to locate active webpage. Click on the page and reopen Sprocket.');
      return;
    }

    currentTab = tab;
    playShutterSound({ enabled: soundEnabled });
    setBusyState('CAPTURING VIEWPORT...');

    const resolution = selectResolution ? selectResolution.value : '4k';
    const format = selectFormat ? selectFormat.value : 'png';

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_VISIBLE_CAPTURE',
        tabId: tab.id,
        windowId: tab.windowId,
        resolution,
        format
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
    hideError();
    let tab = await getActiveTab();
    if (!tab || !tab.id) tab = currentTab;
    if (!tab || !tab.id) {
      showError('Unable to locate active webpage. Click on the page and reopen Sprocket.');
      return;
    }

    currentTab = tab;
    const resolution = selectResolution ? selectResolution.value : '4k';
    const format = selectFormat ? selectFormat.value : 'png';

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SPROCKET_START_REGION_CAPTURE',
        tabId: tab.id,
        windowId: tab.windowId,
        resolution,
        format
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
