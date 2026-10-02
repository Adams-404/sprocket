/**
 * Sprocket - Interactive Region Selector
 * Injects a precision viewfinder overlay allowing users to drag and select
 * a custom crop region directly on any webpage.
 */

(() => {
  // If an active selector already exists, clean it up
  const existing = document.getElementById('sprocket-selector-root');
  if (existing) existing.remove();

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentRect = { x: 0, y: 0, width: 0, height: 0 };

  const root = document.createElement('div');
  root.id = 'sprocket-selector-root';
  root.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483646 !important;
    cursor: crosshair !important;
    user-select: none !important;
    -webkit-user-select: none !important;
    overflow: hidden !important;
  `;

  // SVG Dark Mask with cutout
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;');
  svg.innerHTML = `
    <defs>
      <mask id="sprocket-mask">
        <rect width="100%" height="100%" fill="white" />
        <rect id="sprocket-cutout" x="0" y="0" width="0" height="0" fill="black" />
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="rgba(12, 13, 16, 0.65)" mask="url(#sprocket-mask)" />
  `;
  root.appendChild(svg);

  // Selection Box Outline
  const box = document.createElement('div');
  box.id = 'sprocket-selection-box';
  box.style.cssText = `
    position: absolute !important;
    border: 1px solid #ff6b35 !important;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 12px rgba(255, 107, 53, 0.3) !important;
    display: none !important;
    pointer-events: none !important;
  `;

  // HUD telemetry banner
  const hud = document.createElement('div');
  hud.style.cssText = `
    position: absolute !important;
    background: #141519 !important;
    color: #f3f4f6 !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
    font-size: 11px !important;
    letter-spacing: 0.05em !important;
    padding: 6px 12px !important;
    border-radius: 4px !important;
    border: 1px solid #2b2d35 !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5) !important;
    white-space: nowrap !important;
    pointer-events: auto !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  `;
  box.appendChild(hud);
  root.appendChild(box);

  // Initial helper pill at top center
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: absolute !important;
    top: 24px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: #141519 !important;
    color: #f3f4f6 !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace !important;
    font-size: 12px !important;
    padding: 8px 16px !important;
    border-radius: 6px !important;
    border: 1px solid #ff6b35 !important;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7) !important;
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    pointer-events: none !important;
  `;
  banner.innerHTML = `
    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff6b35;"></span>
    <span style="font-weight:600;color:#ff6b35;">SPROCKET REGION</span>
    <span style="color:#9ca3af;">//</span>
    <span>Click & Drag to select area &nbsp;•&nbsp; <kbd style="background:#262830;padding:2px 6px;border-radius:3px;">Esc</kbd> Cancel</span>
  `;
  root.appendChild(banner);

  function updateView(rect) {
    const cutout = svg.querySelector('#sprocket-cutout');
    cutout.setAttribute('x', rect.x);
    cutout.setAttribute('y', rect.y);
    cutout.setAttribute('width', rect.width);
    cutout.setAttribute('height', rect.height);

    box.style.display = 'block';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    // Position HUD above or inside
    if (rect.y > 36) {
      hud.style.top = '-32px';
      hud.style.bottom = 'auto';
    } else {
      hud.style.top = 'auto';
      hud.style.bottom = '-32px';
    }

    hud.innerHTML = `
      <span style="color:#ff6b35;font-weight:600;">${rect.width} × ${rect.height} px</span>
      <span style="color:#6b7280;">|</span>
      <span>[Enter] Capture &nbsp; [Esc] Cancel</span>
    `;
  }

  function cleanup() {
    window.removeEventListener('keydown', onKeyDown);
    root.remove();
  }

  function commitSelection() {
    if (currentRect.width < 10 || currentRect.height < 10) {
      cleanup();
      return;
    }

    const payload = {
      action: 'SPROCKET_REGION_SELECTED',
      rect: {
        x: currentRect.x,
        y: currentRect.y,
        width: currentRect.width,
        height: currentRect.height,
        dpr: window.devicePixelRatio || 1
      },
      title: document.title || 'Untitled',
      url: window.location.href
    };

    cleanup();
    chrome.runtime.sendMessage(payload);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // Left click only
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentRect = { x: startX, y: startY, width: 0, height: 0 };
    banner.style.display = 'none';
  }

  function onMouseMove(e) {
    if (!isDragging) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    currentRect = { x, y, width, height };
    updateView(currentRect);
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    isDragging = false;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
    } else if (e.key === 'Enter') {
      commitSelection();
    }
  }

  root.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);

  document.body.appendChild(root);
})();
