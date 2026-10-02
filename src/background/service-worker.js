/**
 * Sprocket - Background Service Worker (Manifest V3)
 * Orchestrates multi-frame captures, tab scripting, stitching dispatch,
 * hotkey commands, and viewer lifecycle.
 */

import { calculateSlices } from '../utils/stitch.js';
import { generateFilename } from '../utils/format.js';

// Clean up old capture sessions from storage on startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Sprocket service worker installed.');
  await cleanOldCaptures();
});

chrome.runtime.onStartup.addListener(async () => {
  await cleanOldCaptures();
});

async function cleanOldCaptures() {
  try {
    const all = await chrome.storage.local.get(null);
    const keysToRemove = [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('sprocket_capture_') && value.createdAt && value.createdAt < oneDayAgo) {
        keysToRemove.push(key);
      }
    }
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  } catch (err) {
    console.debug('Sprocket: Storage cleanup error', err);
  }
}

/**
 * Ensures content script is injected into the target tab, returning telemetry.
 * Falls back gracefully to tab metrics if page blocks script injection.
 */
async function ensureContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'SPROCKET_GET_TELEMETRY' });
    if (response && response.success && response.telemetry) {
      return response.telemetry;
    }
  } catch {
    // Needs injection
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content.js']
    });

    const response = await chrome.tabs.sendMessage(tabId, { action: 'SPROCKET_GET_TELEMETRY' });
    if (response && response.success && response.telemetry) {
      return response.telemetry;
    }
  } catch (err) {
    console.debug('Sprocket: Script injection skipped or non-responsive:', err);
  }

  // Resilient fallback telemetry
  try {
    const tab = await chrome.tabs.get(tabId);
    const w = tab.width || 1280;
    const h = tab.height || 800;
    return {
      title: tab.title || 'Active Page',
      url: tab.url || '',
      totalWidth: w,
      totalHeight: h,
      viewportWidth: w,
      viewportHeight: h,
      dpr: 1,
      scrollX: 0,
      scrollY: 0
    };
  } catch {
    return {
      title: 'Active Page',
      url: '',
      totalWidth: 1280,
      totalHeight: 800,
      viewportWidth: 1280,
      viewportHeight: 800,
      dpr: 1,
      scrollX: 0,
      scrollY: 0
    };
  }
}

// Minimum interval between captureVisibleTab calls to strictly respect Chromium's
// MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.
// Chromium's token bucket allows 1 call per second. 1050ms guarantees strictly < 1 call/sec.
const MIN_CAPTURE_INTERVAL_MS = 1050;
let lastCaptureTimestamp = 0;
let activeCaptureSession = null;

/**
 * Throttled and fault-tolerant captureVisibleTab wrapper.
 * Strictly throttles call rate and automatically retries with backoff if quota is hit.
 */
async function safeCaptureVisibleTab(windowId, options = { format: 'png' }, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const elapsed = now - lastCaptureTimestamp;
    if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
      const waitTime = MIN_CAPTURE_INTERVAL_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    try {
      lastCaptureTimestamp = Date.now();
      return await chrome.tabs.captureVisibleTab(windowId, options);
    } catch (err) {
      const msg = err?.message || String(err);
      const isQuota = msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') ||
                      msg.includes('quota') ||
                      msg.includes('MAX_CAPTURE');

      if (isQuota && attempt < maxRetries) {
        const backoffMs = 1500 + attempt * 500;
        console.warn(`Sprocket: Quota limit touched. Recharging token bucket for ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        lastCaptureTimestamp = Date.now();
        continue;
      }

      throw err;
    }
  }
}

/**
 * Captures the entire scrollable page through sequential frame advancement.
 */
async function captureFullPage(tab) {
  // Ensure target tab and its window are active and focused
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((r) => setTimeout(r, 150));
  } catch (e) {
    console.debug('Failed to focus tab/window:', e);
  }

  // 1. Get telemetry (with seamless fallback)
  const telemetry = await ensureContentScript(tab.id);

  // 2. Calculate frame slices
  const slices = calculateSlices({
    totalWidth: telemetry.totalWidth,
    totalHeight: telemetry.totalHeight,
    viewportWidth: telemetry.viewportWidth,
    viewportHeight: telemetry.viewportHeight,
    dpr: telemetry.dpr
  });

  const captureId = `sprocket_capture_${Date.now()}`;
  activeCaptureSession = { id: captureId, stopRequested: false };

  // 3. Prepare target page (hide scrollbars, catalog sticky elements)
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_PREPARE' });
  } catch (e) {
    console.debug('SPROCKET_PREPARE skipped:', e);
  }

  const capturedFrames = [];

  try {
    for (let i = 0; i < slices.length; i++) {
      // Check if user clicked STOP button
      if (activeCaptureSession && activeCaptureSession.stopRequested) {
        console.log(`Sprocket: Capture halted early at frame ${i}/${slices.length} by user request.`);
        break;
      }

      const slice = slices[i];
      const isFirst = i === 0;

      // Ensure target tab is in the foreground of its window before captureVisibleTab
      try {
        const [activeInWin] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (!activeInWin || activeInWin.id !== tab.id) {
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e) {
        console.debug('Tab focus check:', e);
      }

      // Broadcast progress update to popup and HUD
      chrome.runtime.sendMessage({
        action: 'SPROCKET_PROGRESS_UPDATE',
        currentFrame: i + 1,
        totalFrames: slices.length,
        percent: Math.round(((i) / slices.length) * 100)
      }).catch(() => {});

      // Scroll viewport into position
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'SPROCKET_SCROLL_TO',
          scrollY: slice.scrollY,
          isFirstSlice: isFirst,
          currentFrame: i + 1,
          totalFrames: slices.length
        });
      } catch (e) {
        // Fallback: direct window.scrollTo via scripting
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (y) => window.scrollTo(0, y),
            args: [slice.scrollY]
          });
          await new Promise((r) => setTimeout(r, 150));
        } catch (err2) {
          console.debug('Direct scroll script skipped:', err2);
        }
      }

      // Capture frame safely respecting Chromium rate limit
      const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
      capturedFrames.push({
        descriptor: slice,
        dataUrl
      });
    }

    // Broadcast 100% progress
    chrome.runtime.sendMessage({
      action: 'SPROCKET_PROGRESS_UPDATE',
      currentFrame: capturedFrames.length,
      totalFrames: slices.length,
      percent: 100
    }).catch(() => {});
  } finally {
    activeCaptureSession = null;
    // 4. Always restore page state
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_RESTORE' });
    } catch (e) {
      console.debug('Failed to restore page:', e);
    }
  }

  if (capturedFrames.length === 0) {
    throw new Error('Capture stopped before any frames were taken.');
  }

  // Adjust telemetry to actual captured height if stopped early
  const lastSlice = capturedFrames[capturedFrames.length - 1];
  const actualCoveredHeight = (lastSlice.descriptor.destY + lastSlice.descriptor.destHeight) / (telemetry.dpr || 1);
  telemetry.totalHeight = actualCoveredHeight;

  // 5. Store capture job
  const payload = {
    id: captureId,
    mode: 'full',
    telemetry,
    slices: capturedFrames,
    createdAt: Date.now()
  };

  await chrome.storage.local.set({ [captureId]: payload });

  // 6. Open Studio Viewer
  await openViewer(captureId);
  return { success: true, captureId };
}

/**
 * Captures the currently visible viewport.
 */
async function captureVisibleViewport(tab) {
  let telemetry = null;
  try {
    telemetry = await ensureContentScript(tab.id);
  } catch {
    telemetry = {
      title: tab.title || 'Untitled',
      url: tab.url || '',
      viewportWidth: tab.width || 1280,
      viewportHeight: tab.height || 800,
      totalWidth: tab.width || 1280,
      totalHeight: tab.height || 800,
      dpr: 1
    };
  }

  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((r) => setTimeout(r, 100));
  } catch (e) {
    console.debug('Failed to focus tab/window:', e);
  }

  const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
  const captureId = `sprocket_capture_${Date.now()}`;

  const payload = {
    id: captureId,
    mode: 'viewport',
    telemetry,
    dataUrl,
    createdAt: Date.now()
  };

  await chrome.storage.local.set({ [captureId]: payload });
  await openViewer(captureId);
  return { success: true, captureId };
}

/**
 * Injects the region selector tool onto the current page.
 */
async function startRegionSelector(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {}

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['src/content/selector.js']
  });

  return { success: true };
}

/**
 * Handles region selection completion from selector.js.
 */
async function handleRegionSelected(tab, rect, title, url) {
  const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
  const captureId = `sprocket_capture_${Date.now()}`;

  const payload = {
    id: captureId,
    mode: 'region',
    telemetry: {
      title: title || tab.title || 'Untitled',
      url: url || tab.url,
      viewportWidth: tab.width,
      viewportHeight: tab.height,
      dpr: rect.dpr || 1
    },
    cropRect: rect,
    dataUrl,
    createdAt: Date.now()
  };

  await chrome.storage.local.set({ [captureId]: payload });
  await openViewer(captureId);
}

/**
 * Opens the Sprocket Studio viewer in a new tab.
 */
async function openViewer(captureId) {
  const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${encodeURIComponent(captureId)}`);
  await chrome.tabs.create({ url: viewerUrl, active: true });
}

// Global Hotkey / Command Listener
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) return;

  try {
    if (command === 'capture-full-page') {
      await captureFullPage(tab);
    } else if (command === 'capture-visible') {
      await captureVisibleViewport(tab);
    } else if (command === 'capture-selected') {
      await startRegionSelector(tab);
    }
  } catch (err) {
    console.error('Sprocket command error:', err);
  }
});

// Helper to safely get the target tab across popup and background contexts
async function resolveTargetTab(targetTabId, windowId) {
  if (targetTabId) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab && tab.id) return tab;
    } catch {}
  }
  if (windowId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab && tab.id) return tab;
    } catch {}
  }
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

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  (async () => {
    try {
      switch (message.action) {
        case 'SPROCKET_GET_TAB_TELEMETRY': {
          const targetTab = await resolveTargetTab(message.tabId, message.windowId);
          if (!targetTab) {
            sendResponse({ success: false, error: 'Target tab not found' });
            return;
          }
          const telemetry = await ensureContentScript(targetTab.id);
          sendResponse({ success: true, telemetry, tab: targetTab });
          break;
        }

        case 'SPROCKET_START_FULL_CAPTURE': {
          const tab = await resolveTargetTab(message.tabId, message.windowId);
          if (!tab) throw new Error('No target tab resolved for capture.');
          const result = await captureFullPage(tab);
          sendResponse(result);
          break;
        }

        case 'SPROCKET_STOP_CAPTURE': {
          if (activeCaptureSession) {
            activeCaptureSession.stopRequested = true;
            console.log('Sprocket: User requested capture stop.');
          }
          sendResponse({ success: true });
          break;
        }

        case 'SPROCKET_START_VISIBLE_CAPTURE': {
          const tab = await resolveTargetTab(message.tabId, message.windowId);
          if (!tab) throw new Error('No target tab resolved for capture.');
          const result = await captureVisibleViewport(tab);
          sendResponse(result);
          break;
        }

        case 'SPROCKET_START_REGION_CAPTURE': {
          const tab = await resolveTargetTab(message.tabId, message.windowId);
          if (!tab) throw new Error('No target tab resolved for capture.');
          const result = await startRegionSelector(tab);
          sendResponse(result);
          break;
        }

        case 'SPROCKET_REGION_SELECTED': {
          const tab = sender.tab || (await resolveTargetTab(message.tabId, message.windowId));
          await handleRegionSelected(tab, message.rect, message.title, message.url);
          sendResponse({ success: true });
          break;
        }

        case 'SPROCKET_GET_CAPTURE_DATA': {
          const captureId = message.captureId;
          const record = await chrome.storage.local.get(captureId);
          if (record && record[captureId]) {
            sendResponse({ success: true, capture: record[captureId] });
          } else {
            sendResponse({ success: false, error: 'Capture record not found.' });
          }
          break;
        }

        case 'SPROCKET_GET_ACTIVE_TELEMETRY': {
          const tab = await resolveTargetTab(message.tabId, message.windowId);
          if (!tab) {
            sendResponse({ success: false, error: 'Tab not found' });
            return;
          }
          const telemetry = await ensureContentScript(tab.id);
          sendResponse({ success: true, telemetry, tab });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      console.error('Sprocket service worker message error:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    }
  })();

  return true; // Keep asynchronous channel open
});
