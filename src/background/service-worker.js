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

  // 3. Prepare target page (hide scrollbars, catalog sticky elements)
  await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_PREPARE' });

  const capturedFrames = [];

  try {
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const isFirst = i === 0;

      // Scroll viewport into position
      await chrome.tabs.sendMessage(tab.id, {
        action: 'SPROCKET_SCROLL_TO',
        scrollY: slice.scrollY,
        isFirstSlice: isFirst,
        currentFrame: i + 1,
        totalFrames: slices.length
      });

      // Capture frame
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      capturedFrames.push({
        descriptor: slice,
        dataUrl
      });
    }
  } finally {
    // 4. Always restore page state
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_RESTORE' });
    } catch (e) {
      console.debug('Failed to restore page', e);
    }
  }

  // 5. Store capture job
  const captureId = `sprocket_capture_${Date.now()}`;
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

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
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
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
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
