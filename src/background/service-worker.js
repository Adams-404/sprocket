/**
 * Sprocket - Background Service Worker (Manifest V3)
 * Orchestrates multi-frame captures, tab scripting, stitching dispatch,
 * hotkey commands, and viewer lifecycle.
 */

import { calculateSlices } from '../utils/stitch.js';
import { generateFilename } from '../utils/format.js';

// Fast in-memory capture store to ensure reliable viewer access across storage quotas
const memoryCaptures = new Map();

// Clean up old capture sessions from storage and memory on startup
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
 * Ensures content script is injected and returns accurate DOM telemetry.
 * Uses direct page DOM execution to measure full document height even on complex SPAs.
 */
async function ensureContentScript(tabId) {
  // 1. Direct DOM inspection via executeScript to ensure full-document height is detected on modern SPAs
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const doc = document.documentElement;
        const body = document.body;

        // Reset restrictive body overflow that can block window.scrollTo
        if (body && (body.style.overflowY === 'hidden' || body.style.overflowY === 'scroll')) {
          body.style.overflowY = 'visible';
        }

        const widths = [
          doc.clientWidth,
          doc.scrollWidth,
          doc.offsetWidth,
          body ? body.scrollWidth : 0,
          body ? body.offsetWidth : 0,
          window.innerWidth
        ].filter(Boolean);

        const heights = [
          doc.clientHeight,
          doc.scrollHeight,
          doc.offsetHeight,
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          window.innerHeight
        ].filter(Boolean);

        // Also inspect direct children of body in case page uses full-height wrapper
        const children = document.querySelectorAll('body > *');
        for (let i = 0; i < children.length; i++) {
          const el = children[i];
          if (el.scrollHeight) heights.push(el.scrollHeight);
          if (el.offsetHeight) heights.push(el.offsetHeight);
        }

        const totalWidth = Math.max(...widths);
        const totalHeight = Math.max(...heights);
        const viewportWidth = window.innerWidth || doc.clientWidth || 1280;
        const viewportHeight = window.innerHeight || doc.clientHeight || 800;

        return {
          title: document.title || 'Untitled',
          url: window.location.href,
          totalWidth,
          totalHeight,
          viewportWidth,
          viewportHeight,
          dpr: window.devicePixelRatio || 1,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0
        };
      }
    });

    if (execResult && execResult.result && execResult.result.totalHeight > 0) {
      // Also inject content.js for sticky headers and HUD
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      }).catch(() => {});

      return execResult.result;
    }
  } catch (err) {
    console.debug('Sprocket: Script execution measurement failed:', err);
  }

  // 2. Message query fallback
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'SPROCKET_GET_TELEMETRY' });
    if (response && response.success && response.telemetry) {
      return response.telemetry;
    }
  } catch {}

  // 3. Tab fallback
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
// 1150ms guarantees strictly < 1 call/sec token bucket safety margin.
const MIN_CAPTURE_INTERVAL_MS = 1150;
let lastCaptureTimestamp = 0;
let activeCaptureSession = null;

/**
 * Throttled and fault-tolerant captureVisibleTab wrapper.
 * Throttles call rate and automatically retries with backoff if quota or window issues occur.
 */
async function safeCaptureVisibleTab(windowId, options = { format: 'png' }, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const elapsed = now - lastCaptureTimestamp;
    if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
      const waitTime = MIN_CAPTURE_INTERVAL_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    try {
      lastCaptureTimestamp = Date.now();
      if (windowId) {
        try {
          return await chrome.tabs.captureVisibleTab(windowId, options);
        } catch (winErr) {
          // If specified windowId throws, fallback to active current window
          return await chrome.tabs.captureVisibleTab(null, options);
        }
      } else {
        return await chrome.tabs.captureVisibleTab(null, options);
      }
    } catch (err) {
      const msg = err?.message || String(err);
      const isQuota = msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') ||
                      msg.includes('quota') ||
                      msg.includes('MAX_CAPTURE');

      if (isQuota && attempt < maxRetries) {
        const backoffMs = 2000 + attempt * 500;
        console.warn(`Sprocket: Quota touched. Recharging token bucket for ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        lastCaptureTimestamp = Date.now();
        continue;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      throw err;
    }
  }
}

/**
 * Captures the entire scrollable page through sequential frame advancement.
 */
async function captureFullPage(tab, options = {}) {
  const resolution = options.resolution || '4k';
  const format = options.format || 'png';
  // Ensure target tab and its window are active and focused
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((r) => setTimeout(r, 150));
  } catch (e) {
    console.debug('Failed to focus tab/window:', e);
  }

  const captureId = `sprocket_capture_${Date.now()}`;
  activeCaptureSession = { id: captureId, stopRequested: false };

  // 1. Prepare target page FIRST (hide scrollbars, catalog sticky elements)
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_PREPARE' });
  } catch (e) {
    console.debug('SPROCKET_PREPARE skipped:', e);
  }

  // Allow DOM to reflow cleanly without scrollbars
  await new Promise((r) => setTimeout(r, 120));

  // 2. Get telemetry (accurately measured on clean, full-width reflowed page)
  const telemetry = await ensureContentScript(tab.id);

  // 3. Calculate frame slices
  const slices = calculateSlices({
    totalWidth: telemetry.totalWidth,
    totalHeight: telemetry.totalHeight,
    viewportWidth: telemetry.viewportWidth,
    viewportHeight: telemetry.viewportHeight,
    dpr: telemetry.dpr
  });

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

      // Broadcast progress update
      chrome.runtime.sendMessage({
        action: 'SPROCKET_PROGRESS_UPDATE',
        currentFrame: i + 1,
        totalFrames: slices.length,
        percent: Math.round(((i) / slices.length) * 100)
      }).catch(() => {});

      // Scroll viewport into position using both content script and direct scripting
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
            func: (targetY, isFirstSlice, currentFrame, totalFrames) => {
              window.scrollTo({ top: targetY, left: 0, behavior: 'instant' });
              if (document.scrollingElement) document.scrollingElement.scrollTop = targetY;
              if (document.documentElement) document.documentElement.scrollTop = targetY;
              if (document.body) document.body.scrollTop = targetY;
              const containers = document.querySelectorAll('body > div, body > main, #__next, #root, #app');
              for (let c of containers) {
                if (c.scrollHeight > window.innerHeight && c.scrollTop !== undefined) c.scrollTop = targetY;
              }
              if (typeof window.__SPROCKET_UPDATE_HUD__ === 'function') {
                window.__SPROCKET_UPDATE_HUD__(currentFrame, totalFrames);
              }
            },
            args: [slice.scrollY, isFirst, i + 1, slices.length]
          });
        } catch (err2) {
          console.debug('Direct scroll script skipped:', err2);
        }
      }

      // Temporarily hide Sprocket HUD from viewport before capturing frame
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_HIDE_HUD' });
      } catch {}

      // Wait 60ms for Chromium compositor to paint clean frame without HUD
      await new Promise((r) => setTimeout(r, 60));

      // Capture frame safely respecting Chromium rate limit
      try {
        const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
        capturedFrames.push({
          descriptor: slice,
          dataUrl
        });
      } catch (captureErr) {
        console.warn(`Sprocket: Frame ${i + 1}/${slices.length} capture error:`, captureErr);
        // If we already have captured frames, break and finish with what we have instead of dying
        if (capturedFrames.length > 0) {
          console.log(`Sprocket: Preserving ${capturedFrames.length} captured frames and proceeding to stitch.`);
          break;
        } else {
          throw captureErr;
        }
      } finally {
        // Restore HUD for the user during scrolling / between frames
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_SHOW_HUD' });
        } catch {}
      }
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
    // Always restore page state
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

  // 5. Store capture job in memory AND local storage
  const payload = {
    id: captureId,
    mode: 'full',
    resolution,
    format,
    telemetry,
    slices: capturedFrames,
    createdAt: Date.now()
  };

  memoryCaptures.set(captureId, payload);

  try {
    await chrome.storage.local.set({ [captureId]: payload });
  } catch (storageErr) {
    console.warn('Sprocket: Local storage write failed (falling back to memory cache):', storageErr);
  }

  // 6. ALWAYS Open Studio Viewer
  try {
    await openViewer(captureId);
  } catch (viewerErr) {
    console.error('Sprocket: Failed to open viewer tab:', viewerErr);
  }

  return { success: true, captureId };
}

/**
 * Captures the currently visible viewport.
 */
async function captureVisibleViewport(tab, options = {}) {
  const resolution = options.resolution || '4k';
  const format = options.format || 'png';
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

  // Ensure any HUD is hidden before capturing viewport
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'SPROCKET_HIDE_HUD' });
  } catch {}
  await new Promise((r) => setTimeout(r, 60));

  const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
  const captureId = `sprocket_capture_${Date.now()}`;

  const payload = {
    id: captureId,
    mode: 'viewport',
    resolution,
    format,
    telemetry,
    dataUrl,
    createdAt: Date.now()
  };

  memoryCaptures.set(captureId, payload);

  try {
    await chrome.storage.local.set({ [captureId]: payload });
  } catch (storageErr) {
    console.warn('Sprocket: Viewport storage write issue:', storageErr);
  }

  await openViewer(captureId);
  return { success: true, captureId };
}

let pendingRegionOptions = { resolution: '4k', format: 'png' };

/**
 * Injects the region selector tool onto the current page.
 */
async function startRegionSelector(tab, options = {}) {
  pendingRegionOptions = {
    resolution: options.resolution || '4k',
    format: options.format || 'png'
  };

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
async function handleRegionSelected(tab, rect, title, url, options = {}) {
  const resolution = options.resolution || pendingRegionOptions.resolution || '4k';
  const format = options.format || pendingRegionOptions.format || 'png';

  const dataUrl = await safeCaptureVisibleTab(tab.windowId, { format: 'png' });
  const captureId = `sprocket_capture_${Date.now()}`;

  const payload = {
    id: captureId,
    mode: 'region',
    resolution,
    format,
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

  memoryCaptures.set(captureId, payload);

  try {
    await chrome.storage.local.set({ [captureId]: payload });
  } catch (storageErr) {
    console.warn('Sprocket: Region storage write issue:', storageErr);
  }

  await openViewer(captureId);
}

/**
 * Opens the Sprocket Studio viewer in a new tab.
 */
async function openViewer(captureId) {
  const viewerUrl = chrome.runtime.getURL(`src/viewer/viewer.html?id=${encodeURIComponent(captureId)}`);
  return await chrome.tabs.create({ url: viewerUrl, active: true });
}

// Global Hotkey / Command Listener
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) return;

  const prefs = await chrome.storage.local.get(['sprocket_resolution', 'sprocket_format']);
  const options = {
    resolution: prefs.sprocket_resolution || '4k',
    format: prefs.sprocket_format || 'png'
  };

  try {
    if (command === 'capture-full-page') {
      await captureFullPage(tab, options);
    } else if (command === 'capture-visible') {
      await captureVisibleViewport(tab, options);
    } else if (command === 'capture-selected') {
      await startRegionSelector(tab, options);
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
          const result = await captureFullPage(tab, {
            resolution: message.resolution,
            format: message.format
          });
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
          const result = await captureVisibleViewport(tab, {
            resolution: message.resolution,
            format: message.format
          });
          sendResponse(result);
          break;
        }

        case 'SPROCKET_START_REGION_CAPTURE': {
          const tab = await resolveTargetTab(message.tabId, message.windowId);
          if (!tab) throw new Error('No target tab resolved for capture.');
          const result = await startRegionSelector(tab, {
            resolution: message.resolution,
            format: message.format
          });
          sendResponse(result);
          break;
        }

        case 'SPROCKET_REGION_SELECTED': {
          const tab = sender.tab || (await resolveTargetTab(message.tabId, message.windowId));
          await handleRegionSelected(tab, message.rect, message.title, message.url, pendingRegionOptions);
          sendResponse({ success: true });
          break;
        }

        case 'SPROCKET_GET_CAPTURE_DATA': {
          const captureId = message.captureId;
          let record = memoryCaptures.get(captureId);
          if (!record) {
            const stored = await chrome.storage.local.get(captureId);
            record = stored && stored[captureId];
          }
          if (record) {
            sendResponse({ success: true, capture: record });
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
