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
 * Checks if a tab URL is allowed for script injection and capture.
 */
function isSupportedUrl(url) {
  if (!url) return false;
  return !/^(chrome|brave|edge|about|devtools|chrome-extension):/i.test(url) &&
         !url.startsWith('https://chrome.google.com/webstore') &&
         !url.startsWith('https://chromewebstore.google.com');
}

/**
 * Ensures content script is injected into the target tab.
 */
async function ensureContentScript(tabId) {
  try {
    // Ping content script to see if already present
    const response = await chrome.tabs.sendMessage(tabId, { action: 'SPROCKET_GET_TELEMETRY' });
    if (response && response.success) {
      return response.telemetry;
    }
  } catch {
    // Not injected yet, inject now
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content/content.js']
  });

  const response = await chrome.tabs.sendMessage(tabId, { action: 'SPROCKET_GET_TELEMETRY' });
  if (!response || !response.telemetry) {
    throw new Error('Failed to retrieve page measurements from content script.');
  }
  return response.telemetry;
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
    // 1. Enforce minimum spacing between calls
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
        // Chromium token bucket refills at 1000ms. Back off 1500ms+ so bucket fully recharges.
        const backoffMs = 1500 + attempt * 500;
        console.warn(`Sprocket: Quota limit touched. Recharging token bucket for ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        lastCaptureTimestamp = Date.now();
        continue;
      }

      // If not a quota error or out of retries, rethrow
      throw err;
    }
  }
}

/**
 * Captures the entire scrollable page through sequential frame advancement.
 */
async function captureFullPage(tab) {
  if (!isSupportedUrl(tab.url)) {
    throw new Error('Cannot capture browser internal pages or protected URLs.');
  }

  // 1. Get telemetry
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
  await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_PREPARE' });

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

      // Broadcast progress update to popup and HUD
      chrome.runtime.sendMessage({
        action: 'SPROCKET_PROGRESS_UPDATE',
        currentFrame: i + 1,
        totalFrames: slices.length,
        percent: Math.round(((i) / slices.length) * 100)
      }).catch(() => {});

      // Scroll viewport into position
      await chrome.tabs.sendMessage(tab.id, {
        action: 'SPROCKET_SCROLL_TO',
        scrollY: slice.scrollY,
        isFirstSlice: isFirst,
        currentFrame: i + 1,
        totalFrames: slices.length
      });

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
      console.debug('Failed to restore page', e);
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
  if (!isSupportedUrl(tab.url)) {
    throw new Error('Cannot capture browser internal pages or protected URLs.');
  }

  let telemetry = null;
  try {
    telemetry = await ensureContentScript(tab.id);
  } catch {
    telemetry = {
      title: tab.title || 'Untitled',
      url: tab.url,
      viewportWidth: tab.width || 1280,
      viewportHeight: tab.height || 800,
      totalWidth: tab.width || 1280,
      totalHeight: tab.height || 800,
      dpr: 1
    };
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
  if (!isSupportedUrl(tab.url)) {
    throw new Error('Cannot capture browser internal pages or protected URLs.');
  }

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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  (async () => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      switch (message.action) {
        case 'SPROCKET_START_FULL_CAPTURE': {
          const tab = message.tabId ? await chrome.tabs.get(message.tabId) : activeTab;
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
          const tab = message.tabId ? await chrome.tabs.get(message.tabId) : activeTab;
          const result = await captureVisibleViewport(tab);
          sendResponse(result);
          break;
        }

        case 'SPROCKET_START_REGION_CAPTURE': {
          const tab = message.tabId ? await chrome.tabs.get(message.tabId) : activeTab;
          const result = await startRegionSelector(tab);
          sendResponse(result);
          break;
        }

        case 'SPROCKET_REGION_SELECTED': {
          const tab = sender.tab || activeTab;
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
          if (!activeTab || !isSupportedUrl(activeTab.url)) {
            sendResponse({ success: false, reason: 'unsupported' });
            return;
          }
          const telemetry = await ensureContentScript(activeTab.id);
          sendResponse({ success: true, telemetry, tab: activeTab });
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
