/**
 * Sprocket - Stitching & Coordinate Engine
 * Pure math and slice calculations for pixel-perfect vertical scroll stitching.
 */

/**
 * @typedef {Object} SliceDescriptor
 * @property {number} index - 0-based frame index
 * @property {number} scrollY - CSS vertical scroll position to position window
 * @property {number} sourceX - X crop origin in captured slice (device pixels)
 * @property {number} sourceY - Y crop origin in captured slice (device pixels)
 * @property {number} sourceWidth - Width to copy from source slice (device pixels)
 * @property {number} sourceHeight - Height to copy from source slice (device pixels)
 * @property {number} destX - X coordinate on stitched canvas (device pixels)
 * @property {number} destY - Y coordinate on stitched canvas (device pixels)
 * @property {number} destWidth - Rendered width on canvas (device pixels)
 * @property {number} destHeight - Rendered height on canvas (device pixels)
 */

/**
 * Computes the exact slice coordinates for stitching a full page.
 * Handles fractional remainders, devicePixelRatio scaling, and viewport overlap.
 *
 * @param {Object} metrics
 * @param {number} metrics.totalWidth - Total page width in CSS pixels
 * @param {number} metrics.totalHeight - Total page height in CSS pixels
 * @param {number} metrics.viewportWidth - Viewport client width in CSS pixels
 * @param {number} metrics.viewportHeight - Viewport client height in CSS pixels
 * @param {number} [metrics.dpr=1] - Device pixel ratio (e.g. 1.0, 2.0 for Retina)
 * @returns {SliceDescriptor[]} Array of slice descriptors
 */
export function calculateSlices({
  totalWidth,
  totalHeight,
  viewportWidth,
  viewportHeight,
  dpr = 1
}) {
  if (totalWidth <= 0 || totalHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error('Invalid dimensions provided to calculateSlices');
  }

  const slices = [];
  const dprVal = Math.max(1, dpr);

  // If the page fits in a single viewport
  if (totalHeight <= viewportHeight) {
    slices.push({
      index: 0,
      scrollY: 0,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: Math.round(totalWidth * dprVal),
      sourceHeight: Math.round(totalHeight * dprVal),
      destX: 0,
      destY: 0,
      destWidth: Math.round(totalWidth * dprVal),
      destHeight: Math.round(totalHeight * dprVal)
    });
    return slices;
  }

  // Multi-frame page
  let currentY = 0;
  let index = 0;

  while (currentY < totalHeight) {
    const remainingHeight = totalHeight - currentY;

    if (remainingHeight >= viewportHeight) {
      // Standard full-height slice
      slices.push({
        index,
        scrollY: currentY,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: Math.round(totalWidth * dprVal),
        sourceHeight: Math.round(viewportHeight * dprVal),
        destX: 0,
        destY: Math.round(currentY * dprVal),
        destWidth: Math.round(totalWidth * dprVal),
        destHeight: Math.round(viewportHeight * dprVal)
      });
      currentY += viewportHeight;
    } else {
      // Last frame: remaining height is less than one viewport.
      // When scrolling, the browser will clamp scroll to (totalHeight - viewportHeight).
      // So the top of the viewport will overlap what we already captured.
      // We only want to crop the bottom `remainingHeight` portion from the frame!
      const scrollPos = totalHeight - viewportHeight;
      const cropTopOffsetCss = viewportHeight - remainingHeight;

      slices.push({
        index,
        scrollY: scrollPos,
        sourceX: 0,
        sourceY: Math.round(cropTopOffsetCss * dprVal),
        sourceWidth: Math.round(totalWidth * dprVal),
        sourceHeight: Math.round(remainingHeight * dprVal),
        destX: 0,
        destY: Math.round(currentY * dprVal),
        destWidth: Math.round(totalWidth * dprVal),
        destHeight: Math.round(remainingHeight * dprVal)
      });
      currentY += remainingHeight;
    }

    index++;
  }

  return slices;
}

/**
 * Clamps and sanitizes a bounding box selection within image boundaries.
 *
 * @param {Object} box - User selection in CSS pixels or image coordinates
 * @param {number} box.x
 * @param {number} box.y
 * @param {number} box.width
 * @param {number} box.height
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {number} [dpr=1]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function clampBoundingBox(box, maxWidth, maxHeight, dpr = 1) {
  // Normalize negative width/height (dragged top-left)
  let x = box.width < 0 ? box.x + box.width : box.x;
  let y = box.height < 0 ? box.y + box.height : box.y;
  let width = Math.abs(box.width);
  let height = Math.abs(box.height);

  // Apply DPR
  x = Math.round(x * dpr);
  y = Math.round(y * dpr);
  width = Math.round(width * dpr);
  height = Math.round(height * dpr);

  // Clamp within bounds
  const clampedX = Math.max(0, Math.min(x, maxWidth - 1));
  const clampedY = Math.max(0, Math.min(y, maxHeight - 1));
  const clampedWidth = Math.max(1, Math.min(width, maxWidth - clampedX));
  const clampedHeight = Math.max(1, Math.min(height, maxHeight - clampedY));

  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight
  };
}
