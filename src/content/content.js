/**
 * Sprocket - In-Page Content Script
 * Responsible for DOM measurements, scrollbar suppression, sticky element
 * de-duplication, viewport scrolling, and real-time capture telemetry.
 */

(() => {
  // Prevent duplicate listener bindings if injected multiple times
  if (window.__SPROCKET_CONTENT_SCRIPT_LOADED__) return;
  window.__SPROCKET_CONTENT_SCRIPT_LOADED__ = true;

  let originalScroll = { x: 0, y: 0 };
  let originalOverflow = null;
  let fixedStickyElements = [];
  let hudElement = null;
  let styleLockElement = null;

  /**
   * Reads high-fidelity page and viewport telemetry.
   */
  function getDocumentTelemetry() {
    const doc = document.documentElement;
    const body = document.body;

    const totalWidth = Math.max(
      body ? body.scrollWidth : 0,
      doc.scrollWidth,
      body ? body.offsetWidth : 0,
      doc.offsetWidth,
      doc.clientWidth
    );

    const totalHeight = Math.max(
      body ? body.scrollHeight : 0,
      doc.scrollHeight,
      body ? body.offsetHeight : 0,
      doc.offsetHeight,
      doc.clientHeight
    );

    const viewportWidth = window.innerWidth || doc.clientWidth;
    const viewportHeight = window.innerHeight || doc.clientHeight;
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

  /**
   * Prepares the webpage for clean multi-frame capture.
   * Hides scrollbars, disables smooth scrolling, records fixed/sticky nodes.
   */
  function prepareForCapture() {
    originalScroll = {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0
    };

    // Inject temporary CSS to freeze scrollbars and disable smooth-scrolling animations
    if (!styleLockElement) {
      styleLockElement = document.createElement('style');
      styleLockElement.id = 'sprocket-capture-lock';
      styleLockElement.textContent = `
        html, body {
          scroll-behavior: auto !important;
          overflow: hidden !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        html::-webkit-scrollbar, body::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
      `;
      document.head.appendChild(styleLockElement);
    }

    // Catalog all fixed and sticky elements so we can hide them after frame 0
    fixedStickyElements = [];
    const allElements = document.querySelectorAll('*');
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      // Skip our own HUD if present
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

    showHud('INITIALIZING EXPOSURE...', 0);
  }

  /**
   * Jumps to target scroll coordinates and updates sticky element visibility.
   */
  async function scrollToSlice(scrollY, isFirstSlice, currentFrame, totalFrames) {
    // Jump viewport directly
    window.scrollTo(0, scrollY);

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

    const pct = Math.round((currentFrame / totalFrames) * 100);
    showHud(`FRAME [${currentFrame}/${totalFrames}] — ${pct}%`, pct);

    // Yield for DOM repaint & dynamic component rendering
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 200);
      });
    });
  }

  /**
   * Restores the page to its exact pre-capture state.
   */
  function restoreAfterCapture() {
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

    // Remove HUD
    removeHud();

    // Restore user's original scroll position
    window.scrollTo(originalScroll.x, originalScroll.y);
  }

  /**
   * Renders a sleek, tactile heads-up progress badge in top right.
   */
  function showHud(text, percent) {
    if (!hudElement) {
      hudElement = document.createElement('div');
      hudElement.id = 'sprocket-hud-banner';
      hudElement.style.cssText = `
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        z-index: 2147483647 !important;
        background: #141519 !important;
        color: #f3f4f6 !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
        font-size: 11px !important;
        letter-spacing: 0.08em !important;
        padding: 8px 14px !important;
        border-radius: 6px !important;
        border: 1px solid #ff6b35 !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6) !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        pointer-events: auto !important;
        transition: opacity 0.15s ease !important;
      `;
      document.body.appendChild(hudElement);
    }

    hudElement.innerHTML = `
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff6b35;box-shadow:0 0 8px #ff6b35;"></span>
      <span style="font-weight:600;color:#ff6b35;">SPROCKET</span>
      <span style="color:#9ca3af;">//</span>
      <span>${text}</span>
      <button id="sprocket-hud-stop-btn" style="
        background: #ff6b35 !important;
        color: #0b0c0f !important;
        font-family: inherit !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 3px 8px !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        letter-spacing: 0.05em !important;
      ">■ STOP &amp; STITCH</button>
    `;

    const stopBtn = hudElement.querySelector('#sprocket-hud-stop-btn');
    if (stopBtn) {
      stopBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopBtn.disabled = true;
        stopBtn.textContent = 'FINISHING...';
        chrome.runtime.sendMessage({ action: 'SPROCKET_STOP_CAPTURE' }).catch(() => {});
      };
    }
  }

  function removeHud() {
    if (hudElement && hudElement.parentNode) {
      hudElement.parentNode.removeChild(hudElement);
      hudElement = null;
    }
  }

  // Communication interface with extension service worker and popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  });
})();
