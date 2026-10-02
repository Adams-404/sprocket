/**
 * Sprocket - Darkroom Studio Viewer & Annotation Controller
 * Stitches captured viewport frames, coordinates lossless clipboard export,
 * file downloads, and tactical markup tools.
 */

import { generateFilename, formatBytes, formatDimensions } from '../utils/format.js';
import { playShutterSound } from '../utils/audio.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const metaTitle = document.getElementById('meta-title');
  const metaDimensions = document.getElementById('meta-dimensions');
  const metaSize = document.getElementById('meta-size');
  const metaMode = document.getElementById('meta-mode');

  const btnCopyClipboard = document.getElementById('btn-copy-clipboard');
  const btnDownloadPng = document.getElementById('btn-download-png');
  const btnDownloadJpg = document.getElementById('btn-download-jpg');

  const canvasWorkspace = document.getElementById('canvas-workspace');
  const canvasStage = document.getElementById('canvas-stage');
  const outputCanvas = document.getElementById('output-canvas');
  const drawCanvas = document.getElementById('draw-canvas');

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoom100 = document.getElementById('btn-zoom-100');
  const zoomReadout = document.getElementById('zoom-readout');

  const toastElement = document.getElementById('studio-toast');
  const toastMsg = document.getElementById('toast-msg');

  const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
  const colorSwatches = document.querySelectorAll('.color-swatch');
  const strokeButtons = document.querySelectorAll('.stroke-btn');
  const btnUndo = document.getElementById('btn-undo');
  const btnReset = document.getElementById('btn-reset');

  const outCtx = outputCanvas.getContext('2d');
  const drawCtx = drawCanvas.getContext('2d');

  // State
  let currentCapture = null;
  let zoomLevel = 1.0;
  let activeTool = 'select'; // 'select', 'rect', 'arrow', 'pen', 'redact', 'text', 'crop'
  let currentColor = '#ff6b35';
  let currentLineWidth = 4;
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let undoStack = [];
  let toastTimer = null;
  let soundEnabled = true;

  // Preferences
  const prefs = await chrome.storage.local.get(['sprocket_sound']);
  if (prefs.sprocket_sound !== undefined) {
    soundEnabled = prefs.sprocket_sound;
  }

  // 1. Parse Capture ID from Query Parameters
  const urlParams = new URLSearchParams(window.location.search);
  const captureId = urlParams.get('id');

  if (!captureId) {
    showToast('No capture ID specified', 'error');
    metaTitle.textContent = 'Error: Capture ID not found.';
    return;
  }

  // 2. Fetch Capture Record from Storage
  const record = await chrome.storage.local.get(captureId);
  currentCapture = record[captureId];

  if (!currentCapture) {
    showToast('Capture session expired or missing', 'error');
    metaTitle.textContent = 'Capture not found.';
    return;
  }

  // 3. Render Capture to Output Canvas
  await renderCapture(currentCapture);
  pushUndoState();

  /**
   * Stitches or renders the capture onto the primary output canvas.
   */
  async function renderCapture(capture) {
    metaTitle.textContent = capture.telemetry?.title || 'Untitled Capture';
    metaTitle.title = capture.telemetry?.url || capture.telemetry?.title || '';
    metaMode.textContent = capture.mode.toUpperCase();

    if (capture.mode === 'full') {
      await stitchFullPage(capture);
    } else if (capture.mode === 'region') {
      await renderCroppedRegion(capture);
    } else {
      await renderSingleImage(capture.dataUrl);
    }

    // Synchronize drawing canvas overlay dimensions
    drawCanvas.width = outputCanvas.width;
    drawCanvas.height = outputCanvas.height;
    drawCanvas.style.width = `${outputCanvas.width}px`;
    drawCanvas.style.height = `${outputCanvas.height}px`;

    // Metadata telemetry
    const dpr = capture.telemetry?.dpr || 1;
    metaDimensions.textContent = formatDimensions(outputCanvas.width, outputCanvas.height, dpr);

    outputCanvas.toBlob((blob) => {
      if (blob) {
        metaSize.textContent = formatBytes(blob.size);
      }
    }, 'image/png');

    // Auto-fit initial zoom if very tall
    fitZoomToWorkspace();
    showToast('STITCH EXPOSURE COMPLETE');
  }

  /**
   * Slices stitcher: loads all slice frames and draws them at exact offsets.
   */
  async function stitchFullPage(capture) {
    const { slices, telemetry } = capture;
    const dpr = telemetry.dpr || 1;

    // Calculate total canvas width and height
    const canvasWidth = Math.round(telemetry.totalWidth * dpr);
    const canvasHeight = Math.round(telemetry.totalHeight * dpr);

    outputCanvas.width = canvasWidth;
    outputCanvas.height = canvasHeight;

    // High quality rendering
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';

    // Pre-decode all frames
    const loadedSlices = await Promise.all(
      slices.map((slice) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ img, descriptor: slice.descriptor });
          img.onerror = reject;
          img.src = slice.dataUrl;
        });
      })
    );

    // Draw slices in sequence
    for (const item of loadedSlices) {
      const d = item.descriptor;
      outCtx.drawImage(
        item.img,
        d.sourceX,
        d.sourceY,
        d.sourceWidth,
        d.sourceHeight,
        d.destX,
        d.destY,
        d.destWidth,
        d.destHeight
      );
    }
  }

  /**
   * Cropped region renderer.
   */
  async function renderCroppedRegion(capture) {
    const { dataUrl, cropRect } = capture;
    const img = await loadImage(dataUrl);

    const dpr = cropRect.dpr || 1;
    const sx = Math.round(cropRect.x * dpr);
    const sy = Math.round(cropRect.y * dpr);
    const sw = Math.round(cropRect.width * dpr);
    const sh = Math.round(cropRect.height * dpr);

    outputCanvas.width = sw;
    outputCanvas.height = sh;

    outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  /**
   * Single image viewport renderer.
   */
  async function renderSingleImage(dataUrl) {
    const img = await loadImage(dataUrl);
    outputCanvas.width = img.naturalWidth;
    outputCanvas.height = img.naturalHeight;
    outCtx.drawImage(img, 0, 0);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // --- Zoom Controls ---
  function updateZoom(newZoom) {
    zoomLevel = Math.max(0.1, Math.min(3.0, newZoom));
    canvasStage.style.transform = `scale(${zoomLevel})`;
    zoomReadout.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  function fitZoomToWorkspace() {
    const containerW = canvasWorkspace.clientWidth - 80;
    const containerH = canvasWorkspace.clientHeight - 80;
    const scaleX = containerW / outputCanvas.width;
    const scaleY = containerH / outputCanvas.height;

    // For tall full-page captures, fit comfortably by width with a ceiling of 1.0
    const fit = Math.min(scaleX, 1.0);
    updateZoom(Math.max(0.2, fit));
  }

  btnZoomIn.addEventListener('click', () => updateZoom(zoomLevel + 0.15));
  btnZoomOut.addEventListener('click', () => updateZoom(zoomLevel - 0.15));
  btnZoom100.addEventListener('click', () => updateZoom(1.0));
  btnZoomFit.addEventListener('click', fitZoomToWorkspace);

  // Ctrl / Cmd + Wheel zoom
  canvasWorkspace.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      updateZoom(zoomLevel + delta);
    }
  }, { passive: false });

  // --- Feedback Toast ---
  function showToast(message) {
    toastMsg.textContent = message;
    toastElement.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElement.classList.remove('visible');
    }, 2800);
  }

  // --- Flatten Canvas (Output + Annotations) ---
  function getFlattenedCanvas() {
    const flat = document.createElement('canvas');
    flat.width = outputCanvas.width;
    flat.height = outputCanvas.height;
    const ctx = flat.getContext('2d');
    ctx.drawImage(outputCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    return flat;
  }

  // --- Export Actions ---

  // 1. Copy to Clipboard
  btnCopyClipboard.addEventListener('click', async () => {
    try {
      const flat = getFlattenedCanvas();
      flat.toBlob(async (blob) => {
        if (!blob) throw new Error('Blob generation failed');
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        playShutterSound({ enabled: soundEnabled });
        showToast('✓ COPIED LOSSLESS PNG TO CLIPBOARD');
      }, 'image/png');
    } catch (err) {
      console.error('Clipboard copy error:', err);
      showToast('Clipboard copy failed. Try Save PNG.');
    }
  });

  // 2. Download PNG
  btnDownloadPng.addEventListener('click', () => {
    const flat = getFlattenedCanvas();
    const filename = generateFilename({
      title: currentCapture.telemetry?.title,
      url: currentCapture.telemetry?.url,
      mode: currentCapture.mode,
      format: 'png'
    });

    flat.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, filename);
      playShutterSound({ enabled: soundEnabled });
      showToast(`✓ SAVED ${filename}`);
    }, 'image/png');
  });

  // 3. Download JPG
  btnDownloadJpg.addEventListener('click', () => {
    const flat = getFlattenedCanvas();
    const filename = generateFilename({
      title: currentCapture.telemetry?.title,
      url: currentCapture.telemetry?.url,
      mode: currentCapture.mode,
      format: 'jpeg'
    });

    flat.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, filename);
      playShutterSound({ enabled: soundEnabled });
      showToast(`✓ SAVED ${filename}`);
    }, 'image/jpeg', 0.92);
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // --- Annotation & Markup Tools ---

  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTool = btn.dataset.tool;

      if (activeTool === 'select') {
        drawCanvas.style.pointerEvents = 'none';
        canvasWorkspace.style.cursor = 'default';
      } else {
        drawCanvas.style.pointerEvents = 'auto';
        drawCanvas.style.cursor = 'crosshair';
      }
    });
  });

  colorSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach((s) => s.classList.remove('active'));
      swatch.classList.add('active');
      currentColor = swatch.dataset.color;
    });
  });

  strokeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      strokeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentLineWidth = parseInt(btn.dataset.width, 10);
    });
  });

  function pushUndoState() {
    undoStack.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
    if (undoStack.length > 20) undoStack.shift();
  }

  btnUndo.addEventListener('click', () => {
    if (undoStack.length > 1) {
      undoStack.pop(); // Remove current
      const previous = undoStack[undoStack.length - 1];
      drawCtx.putImageData(previous, 0, 0);
      showToast('UNDO');
    } else if (undoStack.length === 1) {
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      showToast('CANVAS RESET');
    }
  });

  btnReset.addEventListener('click', () => {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    pushUndoState();
    showToast('ALL MARKUP CLEARED');
  });

  // Canvas Mouse Coordinates relative to canvas pixels
  function getCanvasCoords(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  drawCanvas.addEventListener('mousedown', (e) => {
    if (activeTool === 'select') return;
    isDrawing = true;
    const pos = getCanvasCoords(e);
    startX = pos.x;
    startY = pos.y;

    if (activeTool === 'pen') {
      drawCtx.beginPath();
      drawCtx.moveTo(startX, startY);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const pos = getCanvasCoords(e);

    if (activeTool === 'pen') {
      drawCtx.strokeStyle = currentColor;
      drawCtx.lineWidth = currentLineWidth;
      drawCtx.lineCap = 'round';
      drawCtx.lineJoin = 'round';
      drawCtx.lineTo(pos.x, pos.y);
      drawCtx.stroke();
    } else if (activeTool === 'rect' || activeTool === 'redact' || activeTool === 'arrow') {
      // Re-render preview over saved snapshot
      const snapshot = undoStack[undoStack.length - 1];
      if (snapshot) drawCtx.putImageData(snapshot, 0, 0);

      const width = pos.x - startX;
      const height = pos.y - startY;

      if (activeTool === 'rect') {
        drawCtx.strokeStyle = currentColor;
        drawCtx.lineWidth = currentLineWidth;
        drawCtx.strokeRect(startX, startY, width, height);
      } else if (activeTool === 'redact') {
        // Black redaction box
        drawCtx.fillStyle = '#000000';
        drawCtx.fillRect(startX, startY, width, height);
      } else if (activeTool === 'arrow') {
        drawArrow(drawCtx, startX, startY, pos.x, pos.y, currentColor, currentLineWidth);
      }
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;

    if (activeTool === 'text') {
      const pos = getCanvasCoords(e);
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Type note and press Enter...';
      input.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        z-index: 1000;
        background: #14161c;
        color: ${currentColor};
        border: 1px solid ${currentColor};
        font-family: ui-monospace, monospace;
        font-size: ${Math.max(14, currentLineWidth * 3.5)}px;
        font-weight: bold;
        padding: 4px 8px;
        border-radius: 4px;
        outline: none;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      `;
      document.body.appendChild(input);
      input.focus();

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const val = input.value.trim();
        if (val) {
          drawCtx.font = `bold ${Math.max(16, currentLineWidth * 4)}px ui-monospace, monospace`;
          drawCtx.fillStyle = currentColor;
          drawCtx.fillText(val, pos.x, pos.y);
          pushUndoState();
        }
        input.remove();
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') commit();
        if (ke.key === 'Escape') {
          committed = true;
          input.remove();
        }
      });
      input.addEventListener('blur', commit);
      return;
    }

    pushUndoState();
  });

  function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
    const headLen = Math.max(12, width * 3);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';

    // Shaft
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLen * Math.cos(angle - Math.PI / 6),
      toY - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - headLen * Math.cos(angle + Math.PI / 6),
      toY - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  // Keyboard Shortcuts in Viewer
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      btnCopyClipboard.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      btnDownloadPng.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      btnUndo.click();
    } else if (e.key === 'v' || e.key === 'V') {
      document.getElementById('tool-select').click();
    } else if (e.key === 'r' || e.key === 'R') {
      document.getElementById('tool-rect').click();
    } else if (e.key === 'a' || e.key === 'A') {
      document.getElementById('tool-arrow').click();
    } else if (e.key === 'p' || e.key === 'P') {
      document.getElementById('tool-pen').click();
    } else if (e.key === 'x' || e.key === 'X') {
      document.getElementById('tool-redact').click();
    } else if (e.key === 't' || e.key === 'T') {
      document.getElementById('tool-text').click();
    }
  });
});
