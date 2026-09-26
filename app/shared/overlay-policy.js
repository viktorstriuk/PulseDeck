'use strict';

// One authority for preview visibility and input; never infer either from window focus.
function overlayPolicy(config, context = {}) {
  const preview = !!context.previewRequested && !!context.mainVisible && !context.mainMinimized;
  const clickThrough = preview && context.previewOverride == null
    ? false
    : preview && typeof context.previewOverride === 'boolean'
      ? context.previewOverride
      : !!config.clickThroughWhenMinimized; // Kept as a migration-compatible settings key.
  const visible = preview || config.mode === 'persistent' ||
    (config.mode === 'popup' && !!context.popupActive) || !!context.helpActive;
  return { preview, visible, clickThrough, toggleVisible: config.showClickThroughToggle !== false };
}

function pointInRegions(point, bounds, regions, zoom = 1) {
  if (!point || !bounds || !Array.isArray(regions) || ![point.x,point.y,bounds.x,bounds.y].every(Number.isFinite) || !Number.isFinite(zoom) || zoom <= 0) return false;
  const x = (point.x - bounds.x) / zoom, y = (point.y - bounds.y) / zoom;
  return regions.some(r => [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.width > 0 && r.height > 0 && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

// Accept progress bars of arbitrary player width, while bounding IPC work.
function sanitizeHitRegions(regions) {
  return (Array.isArray(regions) ? regions : []).slice(0, 64).filter(r =>
    r && ['x','y','width','height'].every(k => Number.isFinite(r[k])) &&
    r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 &&
    r.x + r.width <= 16384 && r.y + r.height <= 16384)
    .map(({ x,y,width,height,kind }) => ({ x,y,width,height, ...(kind === 'resize' ? { kind } : {}) }));
}

module.exports = { overlayPolicy, pointInRegions, sanitizeHitRegions };
