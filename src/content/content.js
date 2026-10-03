/**
 * Sprocket - In-Page Content Script
 * Responsible for DOM measurements, scrollbar suppression, sticky element
 * de-duplication, viewport scrolling, and real-time capture telemetry.
 */

(() => {
  // Clean up any stale message listener if re-injected after extension reload
  if (window.__SPROCKET_MESSAGE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__SPROCKET_MESSAGE_LISTENER__);
    } catch {}
  }

  let originalScroll = { x: 0, y: 0 };
  let originalOverflow = null;
  let fixedStickyElements = [];
  let styleLockElement = null;

  /**
   * Reads high-fidelity page and viewport telemetry.
   */
  function getDocumentTelemetry() {
    const doc = document.documentElement;
    const body = document.body;

    let totalWidth = Math.max(
      body ? body.scrollWidth : 0,
      doc.scrollWidth,
      body ? body.offsetWidth : 0,
      doc.offsetWidth,
      doc.clientWidth
    );

    let totalHeight = Math.max(
      body ? body.scrollHeight : 0,
      doc.scrollHeight,
      body ? body.offsetHeight : 0,
      doc.offsetHeight,
      doc.clientHeight
    );

    // Also inspect root wrapper elements (e.g. Next.js #__next, React #root, SPA main)
    const rootContainers = document.querySelectorAll('body > div, body > main, #__next, #root, #app');
    for (let i = 0; i < rootContainers.length; i++) {
      const ch = rootContainers[i].scrollHeight;
      if (ch && ch > totalHeight) {
        totalHeight = ch;
      }
    }

    const viewportWidth = window.innerWidth || doc.clientWidth || 1280;
    const viewportHeight = window.innerHeight || doc.clientHeight || 800;
    const dpr = window.devicePixelRatio || 1;

    return {
      title: document.title || 'Untitled Page',
      url: window.location.href,
      totalWidth,
      totalHeight,
      viewportWidth,
      viewportHeight,
      dpr,
      scrollX: window.scrollX || window.pageXOffset || 0,
      scrollY: window.scrollY || window.pageYOffset || 0
    };
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.code === 'Escape') {
      try {
        chrome.runtime.sendMessage({ action: 'SPROCKET_STOP_CAPTURE' }).catch(() => {});
      } catch {}
    }
  }

  function cleanupResidualHud() {
    try {
      const huds = document.querySelectorAll('#sprocket-hud-banner, [id^="sprocket-hud"]');
      huds.forEach((el) => el.remove());
    } catch {}
  }

  /**
   * Prepares the webpage for clean multi-frame capture.
   * Hides scrollbars, disables smooth scrolling, records fixed/sticky nodes.
   */
  function prepareForCapture() {
    cleanupResidualHud();
    window.addEventListener('keydown', onKeyDown, { capture: true });

    originalScroll = {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0
    };

    // Inject temporary CSS to freeze scrollbars and disable smooth-scrolling animations.
    // NOTE: NEVER set overflow: hidden here, as that locks viewport scrolling in Blink/Chromium!
    if (!styleLockElement) {
      styleLockElement = document.createElement('style');
      styleLockElement.id = 'sprocket-capture-lock';
      styleLockElement.textContent = `
        html, body {
          scroll-behavior: auto !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        ::-webkit-scrollbar {
          display: none !important;
          width: 0px !important;
          height: 0px !important;
          background: transparent !important;
        }
        ::-webkit-scrollbar-thumb,
        ::-webkit-scrollbar-track,
        ::-webkit-scrollbar-corner,
        ::-webkit-scrollbar-button {
          display: none !important;
          width: 0px !important;
          height: 0px !important;
          background: transparent !important;
          visibility: hidden !important;
        }
        * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(styleLockElement);
      // Force instantaneous layout recalculation so scrollbars vanish before measurement
      void document.documentElement.offsetHeight;
      if (document.body) void document.body.offsetHeight;
    }

    // Catalog all fixed and sticky elements so we can hide them after frame 0
    fixedStickyElements = [];
    const allElements = document.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      // Skip any Sprocket elements if present
      if (el.id && el.id.startsWith('sprocket-')) continue;

      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        fixedStickyElements.push({
          element: el,
          originalVisibility: el.style.visibility,
          originalOpacity: el.style.opacity
        });
      }
    }
  }

  /**
   * Jumps to target scroll coordinates and updates sticky element visibility.
   */
  async function scrollToSlice(scrollY, isFirstSlice, currentFrame, totalFrames) {
    cleanupResidualHud();

    // 1. Jump viewport directly
    window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = scrollY;
    if (document.body) {
      document.body.scrollTop = scrollY;
    }

    // 2. Also scroll any root container that might have overflow-y
    const rootContainers = document.querySelectorAll('body > div, body > main, #__next, #root, #app');
    for (let i = 0; i < rootContainers.length; i++) {
      const el = rootContainers[i];
      if (el.scrollHeight > window.innerHeight && el.scrollTop !== undefined) {
        el.scrollTop = scrollY;
      }
    }

    // After frame 0, hide fixed/sticky elements to avoid duplicate headers down the image
    if (!isFirstSlice) {
      for (const item of fixedStickyElements) {
        item.element.style.visibility = 'hidden';
      }
    } else {
      for (const item of fixedStickyElements) {
        item.element.style.visibility = item.originalVisibility;
      }
    }

    // Yield for DOM repaint & dynamic component rendering
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 250);
      });
    });

    return {
      success: true,
      actualScrollY: window.scrollY || document.documentElement.scrollTop || 0
    };
  }

  /**
   * Restores the page to its exact pre-capture state.
   */
  function restoreAfterCapture() {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    cleanupResidualHud();

    // Restore fixed/sticky elements
    for (const item of fixedStickyElements) {
      item.element.style.visibility = item.originalVisibility;
      item.element.style.opacity = item.originalOpacity;
    }
    fixedStickyElements = [];

    // Remove lock styles
    if (styleLockElement && styleLockElement.parentNode) {
      styleLockElement.parentNode.removeChild(styleLockElement);
      styleLockElement = null;
    }

    // Restore user's original scroll position
    window.scrollTo(originalScroll.x, originalScroll.y);
  }

  // Safe stubs to prevent errors if invoked
  window.__SPROCKET_UPDATE_HUD__ = () => {};
  window.__SPROCKET_REMOVE_HUD__ = cleanupResidualHud;
  window.__SPROCKET_HIDE_HUD__ = cleanupResidualHud;
  window.__SPROCKET_SHOW_HUD__ = () => {};

  // Communication interface with extension service worker and popup
  window.__SPROCKET_MESSAGE_LISTENER__ = (message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'SPROCKET_GET_TELEMETRY') {
      sendResponse({ success: true, telemetry: getDocumentTelemetry() });
      return false;
    }

    if (message.action === 'SPROCKET_PREPARE') {
      prepareForCapture();
      sendResponse({ success: true });
      return false;
    }

    if (message.action === 'SPROCKET_HIDE_HUD' || message.action === 'SPROCKET_SHOW_HUD') {
      cleanupResidualHud();
      sendResponse({ success: true });
      return false;
    }

    if (message.action === 'SPROCKET_SCROLL_TO') {
      const { scrollY, isFirstSlice, currentFrame, totalFrames } = message;
      scrollToSlice(scrollY, isFirstSlice, currentFrame, totalFrames).then(() => {
        sendResponse({ success: true });
      });
      return true; // Keep channel open for async response
    }

    if (message.action === 'SPROCKET_RESTORE') {
      restoreAfterCapture();
      sendResponse({ success: true });
      return false;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(window.__SPROCKET_MESSAGE_LISTENER__);
})();
