import { createArrow, attachArrowControls, setArrowHeadPoint, syncArrowGeometry } from './arrow.js';

/* ==========================================================================
   Constants
   ========================================================================== */

const WATERMARK_TEXT = 'made with escriboapp.com';
const BRAND = '#FF007F';
const STORE_KEY = 'escribo.settings';
const AREA_PAD = 22;          // #area padding, keep in sync with styles.css
const ZOOM_STEP = 1.25;
const MAX_ZOOM_STEPS = 8;

const SOLID_NAMES = ['Ink', 'Sand', 'Slate', 'Blush'];
const GRAD_NAMES = ['Dusk', 'Rose', 'Sky', 'Mint'];

const DEFAULTS = {
  palette: ['#FF007F', '#FF3B30', '#FFB300', '#12B76A', '#2E7DFF', '#15151A'],
  defaultIdx: 0,
  solidBg: ['#101014', '#EFE7DC', '#3A4354', '#F7D6E4'],
  gradBg: [
    { a: '#2B3242', b: '#12151D' },
    { a: '#FFD9E8', b: '#FF9CC6' },
    { a: '#C6E2FF', b: '#7FAEFF' },
    { a: '#D9F5E8', b: '#8AD6B8' }
  ],
  theme: 'dark',
  watermark: true,
  backdrop: 0,   // fill preset: 0 none, 1-4 solid, 5-8 gradient
  pad: 0         // margin, % of the output width
};

const EMOJIS = ['🔥', '👍', '👎', '🎉', '⚠️', '✅', '❌', '💡',
                '🤔', '😍', '😭', '💀', '🚀', '⭐', '🙈', '🫠'];

const HINTS = {
  select: 'Click an annotation to move or resize it',
  arrow: 'Drag to draw an arrow',
  rect: 'Drag to draw a box',
  mark: 'Drag to highlight a region',
  text: 'Click anywhere to add a label',
  emoji: 'Pick an emoji, then click to place it',
  crop: 'Drag the handles, then apply'
};

const KEYMAP = { s: 'select', a: 'arrow', b: 'rect', m: 'mark', t: 'text', e: 'emoji', c: 'crop' };

const RATIOS = [
  { id: 'orig', label: 'Orig', v: null, hint: 'Match the screenshot' },
  { id: '16:9', label: '16:9', v: 16 / 9, hint: 'Slides, video, Twitter' },
  { id: '4:3', label: '4:3', v: 4 / 3, hint: 'Docs and older displays' },
  { id: '1:1', label: '1:1', v: 1, hint: 'Square — social posts' },
  { id: '9:16', label: '9:16', v: 9 / 16, hint: 'Portrait — stories' }
];
const SCALES = [
  { label: '½×', k: 0.5 },
  { label: '1×', k: 1 },
  { label: '2×', k: 2 }
];
const NONE_CHIP = 'linear-gradient(135deg,var(--sunken) 44%,var(--muted) 44%,var(--muted) 56%,var(--sunken) 56%)';
const UI_FONT = '-apple-system, "Segoe UI", Cantarell, Ubuntu, system-ui, sans-serif';

/* ==========================================================================
   Settings (persisted)
   ========================================================================== */

function loadSettings() {
  const s = { ...DEFAULTS, gradBg: DEFAULTS.gradBg.map(g => ({ ...g })) };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw) Object.assign(s, raw);
    else {
      // Carry over the standalone watermark flag used before the redesign.
      const legacy = localStorage.getItem('watermark');
      if (legacy !== null) s.watermark = legacy === 'true';
    }
  } catch (err) {
    console.warn('Could not read saved settings', err);
  }
  return s;
}

const settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not save settings', err);
  }
}

/* ==========================================================================
   Session state
   ========================================================================== */

const ui = {
  tool: 'arrow',
  colorIdx: settings.defaultIdx,
  zoom: 0,
  prefsTab: 'annotate',
  pendingEmoji: null,
  editingText: false,
  ratio: 'orig',      // output aspect ratio, per session
  outScale: 1,        // export scale when no explicit width is set
  outW: null          // explicit export width, or null to follow outScale
};

let img = null;        // HTMLImageElement holding the full-resolution source
let imgW = 0;
let imgH = 0;
let crop = null;       // { x, y, w, h } in image pixels while cropping

const $ = (sel) => document.querySelector(sel);
const el = {
  area: $('#area'),
  stage: $('#stage'),
  backdrop: $('#backdrop'),
  shot: $('#shot'),
  shotImg: $('#shot-img'),
  watermark: $('#watermark'),
  empty: $('#empty'),
  hint: $('#hint'),
  titleName: $('#title-name'),
  titleDims: $('#title-dims'),
  palette: $('#palette'),
  emojiPicker: $('#emoji-picker'),
  cropLayer: $('#crop-layer'),
  cropBox: $('#crop-box'),
  cropBar: $('#crop-bar'),
  cropSize: $('#crop-size'),
  zoomFit: $('#zoom-fit'),
  toast: $('#toast'),
  prefs: $('#prefs'),
  backdropPop: $('#backdrop-pop'),
  backdropBtn: $('#backdrop-btn'),
  backdropChip: $('#backdrop-chip'),
  undo: $('#undo'),
  redo: $('#redo'),
  ratioBtn: $('#ratio-btn'),
  ratioPop: $('#ratio-pop'),
  ratioLabel: $('#ratio-label'),
  ratioNote: $('#ratio-note'),
  ratioSeg: $('#ratio-seg'),
  scaleSeg: $('#scale-seg'),
  outW: $('#out-w'),
  outH: $('#out-h'),
  copyCaret: $('#copy-caret'),
  copyMenu: $('#copy-menu')
};

const isDesktop = !!window.electronAPI;
document.body.classList.toggle('is-desktop', isDesktop);

// Window chrome follows the OS; on the web there is no chrome, so the layout
// falls back to the plain one and only the modifier-key labels adapt.
const platform = (isDesktop && window.electronAPI.platform) || 'linux';
document.documentElement.dataset.platform = platform;
const isMac = platform === 'darwin' || (!isDesktop && /Mac/.test(navigator.platform));
const MOD = isMac ? '⌘' : 'Ctrl+';
const MOD_MENU = isMac ? '⌘' : 'Ctrl ';

/* ==========================================================================
   Canvas
   ========================================================================== */

const canvas = new fabric.Canvas('canvas', {
  selection: true,
  preserveObjectStacking: true,
  uniformScaling: false,
  width: 0,
  height: 0
});

canvas.extraProps = ['selectable', 'editable', 'escTool', 'globalCompositeOperation', 'arrowUnit'];

// Undo rebuilds objects from JSON, so what is drawn must not depend on state
// the JSON cannot carry. The per-object raster cache is one such thing (the
// arrow tool edits points without ever invalidating it), and coordinates
// rounded to two decimals are another — enough to nudge a rotated, ×7-scaled
// arrow by a visible pixel. Direct rendering is cheap at this object count,
// and together these make every undo round trip pixel-exact.
fabric.Object.prototype.objectCaching = false;
fabric.Object.NUM_FRACTION_DIGITS = 6;

fabric.Rect.prototype._controlsVisibility = { mt: false, mb: false, ml: false, mr: false };
fabric.Polygon.prototype._controlsVisibility = {
  tl: false, tr: false, bl: false, br: false, mt: false, mb: false, ml: true, mr: false
};
fabric.Rect.prototype.rx = 2;
fabric.Rect.prototype.ry = 2;

/** One "unit" is a pixel as it would look on a 900px-wide render, so annotation
 *  weights stay proportional whatever the screenshot's resolution is. */
const unit = () => Math.max(1, imgW / 900);
const color = () => settings.palette[ui.colorIdx] || settings.palette[0];
const backdropOn = () => settings.backdrop !== 0;
const hasImage = () => !!img;

/* ==========================================================================
   Layout — the output box (ratio + padding) with the shot fitted inside
   ========================================================================== */

function backdropCss(index = settings.backdrop) {
  if (index === 0) return 'transparent';
  if (index <= 4) return settings.solidBg[index - 1];
  const g = settings.gradBg[index - 5];
  return `linear-gradient(135deg,${g.a} 0%,${g.b} 100%)`;
}

/** Padding is a percentage of the output width on all four sides. */
function padFraction() {
  return settings.pad / 100;
}

function currentRatio() {
  return RATIOS.find((r) => r.id === ui.ratio) || RATIOS[0];
}

/**
 * Geometry of the composed output at 1×, in image pixels: the box, its
 * padding, and where the shot sits in it. "Orig" wraps the screenshot in a
 * uniform margin and adds no canvas; a fixed ratio fits the screenshot inside
 * the padded box and leaves the rest as extra canvas.
 */
function naturalLayout() {
  const f = padFraction();
  const R = currentRatio();

  if (!R.v) {
    const outW = imgW / (1 - 2 * f);
    const pad = f * outW;
    return { outW, outH: imgH + 2 * pad, pad, shotX: pad, shotY: pad };
  }

  // Ratio of the box left once padding is taken off each side.
  const availRatio = (1 - 2 * f) / (1 / R.v - 2 * f);
  const heightBound = availRatio >= imgW / imgH;
  const outW = heightBound ? imgH / (1 / R.v - 2 * f) : imgW / (1 - 2 * f);
  const outH = outW / R.v;
  const pad = f * outW;
  return {
    outW,
    outH,
    pad,
    shotX: pad + (outW - 2 * pad - imgW) / 2,
    shotY: pad + (outH - 2 * pad - imgH) / 2
  };
}

function fitScale(layout = naturalLayout()) {
  const availW = Math.max(1, el.area.clientWidth - AREA_PAD * 2);
  const availH = Math.max(1, el.area.clientHeight - AREA_PAD * 2);
  return Math.min(availW / layout.outW, availH / layout.outH, 1);
}

function currentScale(layout = naturalLayout()) {
  return fitScale(layout) * Math.pow(ZOOM_STEP, ui.zoom);
}

function relayout() {
  if (!hasImage()) return;

  const L = naturalLayout();
  const k = currentScale(L);
  const stageW = Math.max(1, Math.round(L.outW * k));
  const stageH = Math.max(1, Math.round(L.outH * k));
  const shotW = Math.max(1, Math.round(imgW * k));
  const shotH = Math.max(1, Math.round(imgH * k));
  const shotX = Math.round(L.shotX * k);
  const shotY = Math.round(L.shotY * k);

  // The canvas spans the whole output so annotations can run into the margin.
  // Image space is offset to the shot, so they stay anchored to the screenshot
  // however the margin or ratio changes.
  canvas.setDimensions({ width: stageW, height: stageH });
  canvas.setViewportTransform([k, 0, 0, k, shotX, shotY]);

  el.stage.style.width = stageW + 'px';
  el.stage.style.height = stageH + 'px';
  el.backdrop.style.background = backdropCss();

  el.shot.style.left = shotX + 'px';
  el.shot.style.top = shotY + 'px';
  el.shot.style.width = shotW + 'px';
  el.shot.style.height = shotH + 'px';
  el.shot.style.borderRadius = settings.pad > 0 ? shotW * 0.012 + 'px' : '0px';
  el.shot.style.boxShadow = backdropOn() && settings.pad > 0 ? '0 10px 34px rgba(0,0,0,.32)' : 'none';

  // Watermark: bottom-right of the whole output, sized and inset off its width.
  el.watermark.style.setProperty('--wm-size', stageW * 0.0125 + 'px');
  el.watermark.style.setProperty('--wm-inset', stageW * 0.013 + 'px');

  // The crop layer lives in #stage, so give it the shot's exact box.
  el.cropLayer.style.left = shotX + 'px';
  el.cropLayer.style.top = shotY + 'px';
  el.cropLayer.style.width = shotW + 'px';
  el.cropLayer.style.height = shotH + 'px';

  el.zoomFit.textContent = ui.zoom === 0 ? 'Fit' : Math.round(k * 100) + '%';
  if (crop) renderCropBox();
  syncRatioPop(L);
  canvas.requestRenderAll();
}

// Relayout on the next frame: it resizes #stage, which is inside the observed
// area, and doing that during delivery makes Chromium complain about a loop.
let relayoutFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(relayoutFrame);
  relayoutFrame = requestAnimationFrame(relayout);
}).observe(el.area);

/* ==========================================================================
   Loading images
   ========================================================================== */

function setSource(image, name) {
  img = image;
  imgW = image.naturalWidth;
  imgH = image.naturalHeight;

  canvas.clear();
  el.shotImg.src = image.src;
  el.stage.classList.add('ready');
  el.empty.classList.add('hidden');

  el.titleName.textContent = name || 'Untitled';
  el.titleDims.textContent = `${imgW} × ${imgH}`;
  document.title = `${name || 'Untitled'} — escribo`;

  ui.zoom = 0;
  ui.outW = null;
  relayout();
  updateHint();
  canvas.clearHistory();
  resetHistoryBaseline();
  updateHistoryButtons();
}

function loadDataURL(dataUrl, name) {
  const image = new Image();
  image.onload = () => setSource(image, name);
  image.onerror = () => toast('Could not read that image');
  image.src = dataUrl;
}

function loadBlob(blob, name) {
  const reader = new FileReader();
  reader.onload = (e) => loadDataURL(e.target.result, name);
  reader.readAsDataURL(blob);
}

function loadFromQueryParam() {
  const filePath = new URLSearchParams(window.location.search).get('file');
  if (!filePath || !window.electronAPI) return;

  window.electronAPI.getFileContent(filePath).then((response) => {
    if (!response || !response.success) {
      console.error('Error loading file:', response && response.error);
      return;
    }
    const name = filePath === 'app:clipboard'
      ? 'Clipboard image'
      : filePath.split(/[/\\]/).pop();
    loadDataURL(`data:${response.mimeType};base64,${response.content}`, name);
  });
}

/* ==========================================================================
   Tools
   ========================================================================== */

function setTool(tool) {
  if (ui.tool === 'crop' && tool !== 'crop') exitCrop();
  ui.tool = tool;
  if (tool !== 'emoji') ui.pendingEmoji = null;

  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === tool));
  });

  const selecting = tool === 'select';
  canvas.selection = selecting;
  canvas.forEachObject((o) => { o.selectable = selecting; o.evented = selecting; });
  if (!selecting && !ui.editingText) canvas.discardActiveObject();
  canvas.defaultCursor = selecting ? 'default' : 'crosshair';
  canvas.hoverCursor = selecting ? 'move' : 'crosshair';

  el.emojiPicker.hidden = tool !== 'emoji';
  if (tool === 'crop') enterCrop();

  updateHint();
  canvas.requestRenderAll();
}

function updateHint() {
  if (!hasImage()) {
    el.hint.textContent = 'Drop a screenshot here, or paste with Ctrl+V';
    return;
  }
  if (ui.editingText) {
    el.hint.textContent = `Type the label — Esc or ${MOD}Enter when done`;
    return;
  }
  if (ui.tool === 'emoji' && ui.pendingEmoji) {
    el.hint.textContent = `Click to place ${ui.pendingEmoji}`;
    return;
  }
  el.hint.textContent = HINTS[ui.tool] || '';
}

/* --- Drawing -------------------------------------------------------------- */

let drawing = null;
let origin = { x: 0, y: 0 };

canvas.on('mouse:down', (opt) => {
  if (!hasImage() || ui.tool === 'crop') return;
  const p = canvas.getPointer(opt.e);
  origin = { x: p.x, y: p.y };
  const u = unit();

  if (ui.tool === 'text') {
    // A click on a label, or while one is being edited, belongs to that label.
    if (ui.editingText || opt.target) return;
    const text = new fabric.Textbox('text', {
      left: p.x,
      top: p.y,
      escTool: 'text',
      fontFamily: 'sans-serif',
      fontSize: 22 * u,
      fill: color(),
      stroke: '#ffffff',
      strokeWidth: 2 * u,
      paintFirst: 'stroke',
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 2 * u, offsetX: 2 * u, offsetY: 2 * u }),
      fontWeight: '900',
      width: 250 * u
    });
    beginHistoryEdit();
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    // The label is placed; typing continues, but the tool is done.
    setTool('select');
  } else if (ui.tool === 'emoji') {
    if (!ui.pendingEmoji) return;
    const emoji = new fabric.IText(ui.pendingEmoji, {
      left: p.x,
      top: p.y,
      originX: 'center',
      originY: 'center',
      escTool: 'emoji',
      fontFamily: 'sans-serif',
      fontSize: 100 * u,
      editable: false
    });
    canvas.add(emoji);
    ui.pendingEmoji = null;
    setTool('select');
  } else if (ui.tool === 'rect') {
    beginHistoryEdit();
    drawing = new fabric.Rect({
      left: p.x,
      top: p.y,
      originX: 'left',
      originY: 'top',
      width: 0,
      height: 0,
      escTool: 'rect',
      fill: 'rgba(255,255,255,0)',
      stroke: color(),
      strokeWidth: 5 * u,
      hasBorders: false,
      strokeUniform: true
    });
    canvas.add(drawing);
  } else if (ui.tool === 'mark') {
    beginHistoryEdit();
    drawing = new fabric.Rect({
      left: p.x,
      top: p.y,
      originX: 'left',
      originY: 'top',
      width: 0,
      height: 0,
      escTool: 'mark',
      fill: color() + '55',
      strokeWidth: 0,
      rx: 2 * u,
      ry: 2 * u,
      hasBorders: false,
      globalCompositeOperation: 'multiply'
    });
    canvas.add(drawing);
  } else if (ui.tool === 'arrow') {
    beginHistoryEdit();
    drawing = createArrow(p.x, p.y, { color: color(), unit: u });
    canvas.add(drawing);
  }
  canvas.requestRenderAll();
});

canvas.on('mouse:move', (opt) => {
  if (!drawing) return;
  const p = canvas.getPointer(opt.e);

  if (ui.tool === 'rect' || ui.tool === 'mark') {
    drawing.set({
      left: Math.min(p.x, origin.x),
      top: Math.min(p.y, origin.y),
      width: Math.abs(p.x - origin.x),
      height: Math.abs(p.y - origin.y)
    });
  } else if (ui.tool === 'arrow') {
    setArrowHeadPoint(drawing, p.x, p.y);
  }
  canvas.requestRenderAll();
});

canvas.on('mouse:up', () => {
  if (!drawing) return;
  const made = drawing;
  drawing = null;

  // A click without a drag leaves a zero-size shape behind — drop it, and
  // discard the pending snapshot with it.
  if (made.escTool !== 'arrow' && (made.width < 2 || made.height < 2)) {
    canvas.remove(made);
    abandonHistoryEdit();
    canvas.requestRenderAll();
    return;
  }

  // Measure the finished arrow before the snapshot so undo restores it exactly.
  if (made.escTool === 'arrow') syncArrowGeometry(made);
  commitHistoryEdit();
  setTool('select');
  canvas.requestRenderAll();
});

let textBeforeEdit = '';

canvas.on('text:editing:entered', (opt) => {
  ui.editingText = true;
  textBeforeEdit = (opt && opt.target && opt.target.text) || '';
  updateHint();
});

canvas.on('text:editing:exited', (opt) => {
  ui.editingText = false;
  const target = (opt && opt.target) || canvas.getActiveObject();
  const empty = target && target.type === 'textbox' && !target.text.trim();
  if (empty) canvas.remove(target);

  if (historyPending) {
    // A brand new label: record it, unless it was abandoned blank.
    if (empty) abandonHistoryEdit();
    else commitHistoryEdit();
  } else if (target && target.text !== textBeforeEdit) {
    // Retyping an existing label is a change worth undoing.
    canvas.fire('object:modified');
  }

  // Finishing a label leaves nothing selected, like every other tool — unless
  // this exit was caused by clicking something else, which fabric selects next.
  setTimeout(() => {
    if (canvas.getActiveObject() === target) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
  }, 0);
  updateHint();
});
canvas.on('object:added', updateHistoryButtons);
canvas.on('object:removed', updateHistoryButtons);
canvas.on('object:modified', (opt) => {
  // Dragging the head control reshapes the arrow too. fabric-history has
  // already snapshotted by now, so re-baseline against the measured object.
  if (opt && opt.target && opt.target.escTool === 'arrow') {
    syncArrowGeometry(opt.target);
    resetHistoryBaseline();
  }
  updateHistoryButtons();
});

function updateHistoryButtons() {
  el.undo.disabled = !canvas.canUndo();
  el.redo.disabled = !canvas.canRedo();
}

/** Objects that come back from JSON are plain fabric types; give arrows their
 *  head-drag control back. */
function restoreArrowControls() {
  canvas.getObjects().forEach((o) => {
    if (o.escTool === 'arrow') attachArrowControls(o);
  });
}

canvas.on('history:undo', restoreArrowControls);
canvas.on('history:redo', restoreArrowControls);

/* --- History snapshots ----------------------------------------------------
 * fabric-history snapshots the canvas when an object is added, but shapes are
 * added empty on mouse:down and sized during the drag — so the snapshot would
 * capture a half-drawn shape and undo would restore it at zero size. These
 * defer the snapshot until the shape is actually finished.
 */
let historyPending = false;

function beginHistoryEdit() {
  if (historyPending) return;
  historyPending = true;
  canvas.historyProcessing = true;
}

function commitHistoryEdit() {
  if (!historyPending) return;
  historyPending = false;
  canvas.historyProcessing = false;
  canvas._historySaveAction();
  updateHistoryButtons();
}

/** Ends a suppressed edit without recording it — for a shape we threw away. */
function abandonHistoryEdit() {
  if (!historyPending) return;
  historyPending = false;
  canvas.historyProcessing = false;
}

/** Re-baselines the snapshot after the canvas changes outside an edit. */
function resetHistoryBaseline() {
  canvas.historyNextState = canvas._historyNext();
}

/* ==========================================================================
   Colour palette
   ========================================================================== */

function applyColorToSelection(hex) {
  const objects = canvas.getActiveObjects();
  if (!objects.length) return;
  objects.forEach((o) => {
    if (o.escTool === 'rect') o.set('stroke', hex);
    else if (o.escTool === 'mark') o.set('fill', hex + '55');
    else if (o.escTool === 'emoji') { /* emoji keep their own colours */ }
    else o.set('fill', hex);
  });
  canvas.requestRenderAll();
  canvas.fire('object:modified');
}

function renderPalette() {
  el.palette.innerHTML = '';
  settings.palette.forEach((hex, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.style.background = hex;
    btn.title = hex.toUpperCase();
    btn.setAttribute('aria-label', `Colour ${hex.toUpperCase()}`);
    btn.setAttribute('aria-pressed', String(ui.colorIdx === i));
    btn.addEventListener('click', () => {
      ui.colorIdx = i;
      renderPalette();
      applyColorToSelection(hex);
    });
    el.palette.appendChild(btn);
  });
}

/* ==========================================================================
   Emoji picker
   ========================================================================== */

function renderEmojiPicker() {
  el.emojiPicker.innerHTML = '';
  EMOJIS.forEach((char) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = char;
    btn.addEventListener('click', () => {
      ui.pendingEmoji = char;
      el.emojiPicker.hidden = true;
      updateHint();
    });
    el.emojiPicker.appendChild(btn);
  });
}

/* ==========================================================================
   Crop
   ========================================================================== */

const CROP_INSET = 0.1;

function enterCrop() {
  if (!hasImage()) return;
  // Start inset rather than full-bleed: the handles are then plainly visible and
  // there is margin left to drag out a fresh region.
  crop = {
    x: imgW * CROP_INSET,
    y: imgH * CROP_INSET,
    w: imgW * (1 - CROP_INSET * 2),
    h: imgH * (1 - CROP_INSET * 2)
  };
  el.cropLayer.hidden = false;
  el.cropBar.hidden = false;
  renderCropBox();
}

function exitCrop() {
  crop = null;
  el.cropLayer.hidden = true;
  el.cropBar.hidden = true;
}

function renderCropBox() {
  if (!crop) return;
  const s = canvas.getZoom();
  el.cropBox.style.left = crop.x * s + 'px';
  el.cropBox.style.top = crop.y * s + 'px';
  el.cropBox.style.width = crop.w * s + 'px';
  el.cropBox.style.height = crop.h * s + 'px';
  el.cropSize.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
}

(function wireCrop() {
  let drag = null;

  const toImage = (e) => {
    const rect = el.cropLayer.getBoundingClientRect();
    const s = canvas.getZoom();
    return {
      x: clamp((e.clientX - rect.left) / s, 0, imgW),
      y: clamp((e.clientY - rect.top) / s, 0, imgH)
    };
  };

  el.cropLayer.addEventListener('pointerdown', (e) => {
    if (!crop) return;
    const handle = e.target.dataset.handle;
    const start = toImage(e);
    el.cropLayer.setPointerCapture(e.pointerId);

    if (handle) drag = { kind: 'resize', handle, box: { ...crop } };
    else if (e.target === el.cropBox) drag = { kind: 'move', start, box: { ...crop } };
    else drag = { kind: 'new', start };
    e.preventDefault();
  });

  el.cropLayer.addEventListener('pointermove', (e) => {
    if (!drag || !crop) return;
    const p = toImage(e);

    if (drag.kind === 'new') {
      crop = {
        x: Math.min(p.x, drag.start.x),
        y: Math.min(p.y, drag.start.y),
        w: Math.abs(p.x - drag.start.x),
        h: Math.abs(p.y - drag.start.y)
      };
    } else if (drag.kind === 'move') {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      crop.x = clamp(drag.box.x + dx, 0, imgW - drag.box.w);
      crop.y = clamp(drag.box.y + dy, 0, imgH - drag.box.h);
    } else {
      const b = drag.box;
      const left = drag.handle.includes('w') ? p.x : b.x;
      const top = drag.handle.includes('n') ? p.y : b.y;
      const right = drag.handle.includes('e') ? p.x : b.x + b.w;
      const bottom = drag.handle.includes('s') ? p.y : b.y + b.h;
      crop = {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        w: Math.abs(right - left),
        h: Math.abs(bottom - top)
      };
    }
    renderCropBox();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    // A stray click shouldn't wipe the selection out.
    if (crop && (crop.w < 8 || crop.h < 8)) {
      enterCrop();
    }
  };

  el.cropLayer.addEventListener('pointerup', endDrag);
  el.cropLayer.addEventListener('pointercancel', endDrag);
})();

function applyCrop() {
  if (!crop || !hasImage()) return;
  const x = Math.round(crop.x);
  const y = Math.round(crop.y);
  const w = Math.max(1, Math.round(crop.w));
  const h = Math.max(1, Math.round(crop.h));

  if (w === imgW && h === imgH && x === 0 && y === 0) {
    setTool('select');
    return;
  }

  const cut = document.createElement('canvas');
  cut.width = w;
  cut.height = h;
  cut.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);

  canvas.getObjects().forEach((o) => {
    o.set({ left: o.left - x, top: o.top - y });
    o.setCoords();
  });

  const cropped = new Image();
  cropped.onload = () => {
    img = cropped;
    imgW = w;
    imgH = h;
    el.shotImg.src = cropped.src;
    el.titleDims.textContent = `${w} × ${h}`;
    ui.zoom = 0;
    exitCrop();
    setTool('select');
    relayout();
    // Coordinates moved with the crop, so earlier history entries no longer
    // apply — drop them and re-baseline against the shifted objects.
    canvas.clearHistory();
    resetHistoryBaseline();
    updateHistoryButtons();
    toast(`Cropped to ${w} × ${h}`);
  };
  cropped.onerror = () => toast('Could not apply the crop');
  cropped.src = cut.toDataURL('image/png');
}

/* ==========================================================================
   Export — fill + shot + annotations + watermark, at the chosen size
   ========================================================================== */

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Factor between the natural layout (shot at native resolution) and the PNG.
 *  Scales are applied exactly — 1× is lossless and 2× an integer upscale —
 *  and only an explicit width makes it fractional. */
function exportScale(layout = naturalLayout()) {
  if (ui.outW == null) return ui.outScale;
  return clamp(Math.round(ui.outW), 240, 8000) / layout.outW;
}

function exportWidth(layout = naturalLayout()) {
  return Math.max(1, Math.round(layout.outW * exportScale(layout)));
}

/** Bottom-right of the output, sized and inset off its width, so it lands in
 *  the same corner whether or not there is padding or extra canvas. */
function drawWatermark(ctx, outW, outH) {
  const size = outW * 0.0125;
  const inset = outW * 0.013;
  const padX = size * 0.65;
  const padY = size * 0.3;
  const gap = size * 0.4;
  const icon = size * 0.95;
  const label = `600 ${size}px ${UI_FONT}`;

  ctx.save();
  ctx.font = label;
  const textW = ctx.measureText(WATERMARK_TEXT).width;
  const boxW = padX * 2 + icon + gap + textW;
  const boxH = padY * 2 + Math.max(icon, size);
  const bx = outW - inset - boxW;
  const by = outH - inset - boxH;

  ctx.shadowColor = 'rgba(0,0,0,.12)';
  ctx.shadowBlur = size * 0.3;
  ctx.shadowOffsetY = size * 0.1;
  ctx.fillStyle = 'rgba(255,255,255,.86)';
  roundRectPath(ctx, bx, by, boxW, boxH, size * 0.45);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const cx = bx + padX + icon / 2;
  const cy = by + boxH / 2;
  ctx.fillStyle = BRAND;
  ctx.beginPath();
  ctx.arc(cx, cy, icon / 2, 0, Math.PI * 2);
  ctx.fill();

  // Same glyph maths as the .mark rule in styles.css: 1.3245 makes the "e"'s
  // ink half the circle's diameter, and the offsets recentre it.
  const glyph = icon * 1.3245;
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 ${glyph}px Cookie, cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('e', cx - glyph * 0.03375, cy - glyph * 0.06375);

  ctx.fillStyle = '#7c7c88';
  ctx.font = label;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(WATERMARK_TEXT, bx + padX + icon + gap, cy);
  ctx.restore();
}

/** Renders the annotations at `k` times native resolution, independent of the
 *  on-screen zoom. */
/** Renders the annotation layer for the whole output at `k` times its natural
 *  size, independent of the on-screen zoom. Image space is offset to the shot,
 *  so marks that run into the margin come out where they were drawn. */
function renderAnnotations(k, layout) {
  const vpt = canvas.viewportTransform.slice();
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  // An active selection re-parents its objects, which would throw the offscreen
  // render's geometry off — drop it before measuring.
  canvas.discardActiveObject();
  canvas.setDimensions({ width: Math.round(layout.outW), height: Math.round(layout.outH) });
  canvas.setViewportTransform([1, 0, 0, 1, layout.shotX, layout.shotY]);
  const out = canvas.toCanvasElement(k);
  canvas.setDimensions({ width, height });
  canvas.setViewportTransform(vpt);
  canvas.requestRenderAll();
  return out;
}

async function compose() {
  if (!hasImage()) return null;
  if (settings.watermark && document.fonts) {
    try {
      await document.fonts.load(`400 ${Math.round(imgW * 0.01)}px Cookie`);
    } catch (err) {
      console.warn('Cookie font unavailable for the watermark', err);
    }
  }

  const L = naturalLayout();
  const k = exportScale(L);
  const outW = exportWidth(L);
  const outH = Math.max(1, Math.round(L.outH * k));
  const shot = { x: L.shotX * k, y: L.shotY * k, w: imgW * k, h: imgH * k };
  const radius = settings.pad > 0 ? shot.w * 0.012 : 0;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');

  // Margins and extra canvas take the fill; without one they stay transparent.
  if (backdropOn()) {
    const index = settings.backdrop;
    if (index <= 4) {
      ctx.fillStyle = settings.solidBg[index - 1];
    } else {
      const g = settings.gradBg[index - 5];
      const grad = ctx.createLinearGradient(0, 0, outW, outH);
      grad.addColorStop(0, g.a);
      grad.addColorStop(1, g.b);
      ctx.fillStyle = grad;
    }
    ctx.fillRect(0, 0, outW, outH);

    if (settings.pad > 0) {
      const u = unit() * k;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.32)';
      ctx.shadowBlur = 34 * u;
      ctx.shadowOffsetY = 10 * u;
      ctx.fillStyle = '#000';
      roundRectPath(ctx, shot.x, shot.y, shot.w, shot.h, radius);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  roundRectPath(ctx, shot.x, shot.y, shot.w, shot.h, radius);
  ctx.clip();
  ctx.drawImage(img, shot.x, shot.y, shot.w, shot.h);
  ctx.restore();

  // Annotations go over everything, margin included.
  ctx.drawImage(renderAnnotations(k, L), 0, 0, outW, outH);

  if (settings.watermark) drawWatermark(ctx, outW, outH);

  return out.toDataURL('image/png');
}

function exportName() {
  const base = (el.titleName.textContent || 'escribo').replace(/\.[^.]+$/, '');
  return `${base || 'escribo'}-annotated.png`;
}

function flashLabel(button, text) {
  const label = button.querySelector('.label');
  if (!label || label.dataset.busy) return;
  const original = label.textContent;
  label.dataset.busy = '1';
  label.textContent = text;
  setTimeout(() => {
    label.textContent = original;
    delete label.dataset.busy;
  }, 1400);
}

async function copyToClipboard() {
  const dataUrl = await compose();
  if (!dataUrl) {
    toast('Nothing to copy yet');
    return false;
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    flashLabel($('#copy'), 'Copied');
    toast('Copied to clipboard');
    return true;
  } catch (err) {
    console.error('Clipboard write failed', err);
    toast('Could not copy the image');
    return false;
  }
}

/** Copy, then dismiss the window — the quick way to hand a shot on. */
async function copyAndClose() {
  closeCopyMenu();
  const copied = await copyToClipboard();
  if (!copied || !isDesktop || !window.electronAPI.window) return;
  flashLabel($('#copy'), 'Closing…');
  setTimeout(() => window.electronAPI.window('close'), 350);
}

async function saveToDisk() {
  const dataUrl = await compose();
  if (!dataUrl) return toast('Nothing to save yet');

  if (window.electronAPI && window.electronAPI.saveImage) {
    const result = await window.electronAPI.saveImage(dataUrl, exportName());
    if (result && result.success) {
      flashLabel($('#save'), 'Saved');
      toast('Saved');
    } else if (result && result.error) {
      toast('Could not save the image');
    }
    return;
  }

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = exportName();
  link.click();
  flashLabel($('#save'), 'Saved');
}

/* ==========================================================================
   Status bar — padding & fill, aspect ratio & export size, theme, zoom
   ========================================================================== */

function padNote() {
  if (settings.pad === 0) return 'No margin around the screenshot.';
  return backdropOn() ? 'Margin uses the fill below.' : 'Margin stays transparent in the PNG.';
}

function ratioNote(R) {
  if (!R.v) return 'Matches the screenshot — no extra canvas.';
  return backdropOn() ? 'Extra canvas is filled with the chosen fill.' : 'Extra canvas stays transparent in the PNG.';
}

/** Builds the fill chips once. Selecting one must not replace these nodes: the
 *  click target would detach mid-dispatch and the popover would read it as a
 *  click outside itself and close. syncPaddingUI() updates them in place. */
function renderBackdropChips() {
  const solids = $('#solid-chips');
  const grads = $('#grad-chips');
  solids.innerHTML = '';
  grads.innerHTML = '';

  const addChip = (index, parent) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.backdrop = String(index);
    btn.title = index === 0 ? 'None' : index <= 4 ? SOLID_NAMES[index - 1] : GRAD_NAMES[index - 5];
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => pickFill(index));
    parent.appendChild(btn);
  };

  [0, 1, 2, 3, 4].forEach((i) => addChip(i, solids));
  [5, 6, 7, 8].forEach((i) => addChip(i, grads));
  syncPaddingUI();
}

function pickFill(index) {
  settings.backdrop = index;
  // A fill with no margin has nowhere to show on "Orig" — give it some.
  if (index !== 0 && settings.pad === 0) settings.pad = 6;
  saveSettings();
  syncPaddingUI();
  relayout();
}

function setPad(value) {
  settings.pad = clamp(Math.round(Number(value) || 0), 0, 18);
  saveSettings();
  syncPaddingUI();
  relayout();
}

function syncPaddingUI() {
  document.querySelectorAll('#backdrop-pop .chip').forEach((btn) => {
    const index = Number(btn.dataset.backdrop);
    btn.style.background = index === 0 ? NONE_CHIP : backdropCss(index);
    btn.setAttribute('aria-pressed', String(settings.backdrop === index));
  });
  document.querySelectorAll('#pad-range, #pad-range-prefs').forEach((input) => { input.value = settings.pad; });
  document.querySelectorAll('.pad-value').forEach((span) => { span.textContent = settings.pad + '%'; });
  document.querySelectorAll('.pad-note').forEach((note) => { note.textContent = padNote(); });

  el.backdropChip.style.background = backdropOn() ? backdropCss() : NONE_CHIP;
  el.backdropBtn.classList.toggle('on', backdropOn() || settings.pad > 0);
  if (hasImage()) syncRatioPop();
}

/** Builds the ratio and scale pickers once; syncRatioPop() keeps them current. */
function renderRatioPop() {
  el.ratioSeg.innerHTML = '';
  RATIOS.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.ratio = r.id;
    btn.textContent = r.label;
    btn.title = r.hint;
    btn.addEventListener('click', () => {
      ui.ratio = r.id;
      relayout();
    });
    el.ratioSeg.appendChild(btn);
  });

  el.scaleSeg.innerHTML = '';
  SCALES.forEach((sc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.scale = String(sc.k);
    btn.textContent = sc.label;
    btn.addEventListener('click', () => {
      ui.outScale = sc.k;
      ui.outW = null;
      syncRatioPop();
    });
    el.scaleSeg.appendChild(btn);
  });
}

function syncRatioPop(layout) {
  const R = currentRatio();
  el.ratioLabel.textContent = R.label;
  el.ratioBtn.classList.toggle('on', !!R.v);
  el.ratioNote.textContent = ratioNote(R);
  el.ratioSeg.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.ratio === R.id));
  });

  if (!hasImage()) {
    el.outW.value = '';
    el.outH.textContent = '—';
    return;
  }

  const L = layout || naturalLayout();
  const outW = exportWidth(L);
  el.scaleSeg.querySelectorAll('button').forEach((btn) => {
    const k = Number(btn.dataset.scale);
    btn.title = Math.round(L.outW * k) + 'px wide';
    btn.setAttribute('aria-pressed', String(ui.outW == null && ui.outScale === k));
  });
  if (document.activeElement !== el.outW) el.outW.value = outW;
  el.outH.textContent = Math.max(1, Math.round((L.outH * outW) / L.outW));
}

function setTheme(theme) {
  settings.theme = theme;
  document.documentElement.dataset.theme = theme;
  $('#theme-label').textContent = theme === 'light' ? 'Light' : 'Dark';
  saveSettings();
}

function setZoom(step) {
  ui.zoom = clamp(step, 0, MAX_ZOOM_STEPS);
  relayout();
}

/* ==========================================================================
   Preferences
   ========================================================================== */

function renderPrefs() {
  const paletteRows = $('#palette-rows');
  paletteRows.innerHTML = '';
  settings.palette.forEach((hex, i) => {
    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <input type="color" value="${hex}" aria-label="Palette colour ${i + 1}">
      <span class="hex">${hex.toUpperCase()}</span>
      <button class="star-btn" title="Arm by default" aria-label="Make default"
              aria-pressed="${settings.defaultIdx === i}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.283.95l-3.523 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"></path></svg>
      </button>`;
    row.querySelector('input').addEventListener('input', (e) => {
      settings.palette[i] = e.target.value;
      row.querySelector('.hex').textContent = e.target.value.toUpperCase();
      saveSettings();
      renderPalette();
    });
    row.querySelector('.star-btn').addEventListener('click', () => {
      settings.defaultIdx = i;
      ui.colorIdx = i;
      saveSettings();
      renderPrefs();
      renderPalette();
    });
    paletteRows.appendChild(row);
  });

  const solidRows = $('#solid-rows');
  solidRows.innerHTML = '';
  settings.solidBg.forEach((hex, i) => {
    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <input type="color" value="${hex}" aria-label="${SOLID_NAMES[i]} backdrop">
      <span class="hex">${SOLID_NAMES[i]}</span>`;
    row.querySelector('input').addEventListener('input', (e) => {
      settings.solidBg[i] = e.target.value;
      saveSettings();
      syncPaddingUI();
      relayout();
    });
    solidRows.appendChild(row);
  });

  const gradRows = $('#grad-rows');
  gradRows.innerHTML = '';
  settings.gradBg.forEach((g, i) => {
    const row = document.createElement('div');
    row.className = 'pref-row grad';
    row.innerHTML = `
      <input type="color" value="${g.a}" aria-label="${GRAD_NAMES[i]} start">
      <span class="grad-name">${GRAD_NAMES[i]}</span>
      <span class="grad-preview"></span>
      <input type="color" value="${g.b}" aria-label="${GRAD_NAMES[i]} end">`;
    const preview = row.querySelector('.grad-preview');
    const paint = () => { preview.style.background = backdropCss(5 + i); };
    paint();
    const [start, end] = row.querySelectorAll('input');
    start.addEventListener('input', (e) => {
      settings.gradBg[i].a = e.target.value;
      paint();
      saveSettings();
      syncPaddingUI();
      relayout();
    });
    end.addEventListener('input', (e) => {
      settings.gradBg[i].b = e.target.value;
      paint();
      saveSettings();
      syncPaddingUI();
      relayout();
    });
    gradRows.appendChild(row);
  });
}

function setPrefsTab(tab) {
  ui.prefsTab = tab;
  document.querySelectorAll('.prefs-tab').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  $('#tab-annotate').hidden = tab !== 'annotate';
  $('#tab-backdrop').hidden = tab !== 'backdrop';
}

function openPrefs() {
  closeBackdropPop();
  renderPrefs();
  el.prefs.hidden = false;
}

function closePrefs() {
  el.prefs.hidden = true;
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

/* ==========================================================================
   Wiring
   ========================================================================== */

document.querySelectorAll('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    // Emoji opens a picker, so its button also closes it again.
    setTool(tool === 'emoji' && ui.tool === 'emoji' ? 'select' : tool);
  });
});

// Buttons must not keep keyboard focus after a click: the next hotkey pressed
// would light the button up with a focus ring, and a focused slider or field
// would swallow the key instead.
['#toolbar', '#statusbar', '#titlebar'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) btn.blur();
  });
});
document.querySelectorAll('input[type="range"]').forEach((input) => {
  input.addEventListener('change', () => input.blur());
});

const emojiToolBtn = document.querySelector('.tool-btn[data-tool="emoji"]');

el.undo.addEventListener('click', () => { canvas.undo(() => updateHistoryButtons()); });
el.redo.addEventListener('click', () => { canvas.redo(() => updateHistoryButtons()); });
$('#copy').addEventListener('click', copyToClipboard);
$('#save').addEventListener('click', saveToDisk);
$('#prefs-open').addEventListener('click', openPrefs);
$('#colours-btn').addEventListener('click', openPrefs);
$('#prefs-close').addEventListener('click', closePrefs);
$('#prefs-done').addEventListener('click', closePrefs);
el.prefs.addEventListener('click', (e) => { if (e.target === el.prefs) closePrefs(); });
document.querySelectorAll('.prefs-tab').forEach((btn) => {
  btn.addEventListener('click', () => setPrefsTab(btn.dataset.tab));
});

$('#prefs-reset').addEventListener('click', () => {
  settings.palette = DEFAULTS.palette.slice();
  settings.defaultIdx = DEFAULTS.defaultIdx;
  settings.solidBg = DEFAULTS.solidBg.slice();
  settings.gradBg = DEFAULTS.gradBg.map((g) => ({ ...g }));
  ui.colorIdx = DEFAULTS.defaultIdx;
  saveSettings();
  renderPrefs();
  renderPalette();
  syncPaddingUI();
  relayout();
});

/* --- Popovers ------------------------------------------------------------
 * Each stays open while you work in it — picking fills, dragging padding,
 * typing a width. Only a click outside, its own button again, or Escape
 * closes it, and opening one closes the others. composedPath() is fixed at
 * dispatch, so it reports the true origin even if a handler replaced the
 * clicked node.
 */
const POPOVERS = [
  { name: 'backdrop', pop: el.backdropPop, btn: el.backdropBtn },
  { name: 'ratio', pop: el.ratioPop, btn: el.ratioBtn },
  { name: 'copy', pop: el.copyMenu, btn: el.copyCaret }
];

function closePopovers(except) {
  POPOVERS.forEach((p) => {
    if (p.name === except) return;
    p.pop.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
  });
}

function togglePopover(name) {
  const p = POPOVERS.find((x) => x.name === name);
  const open = p.pop.hidden;
  closePopovers(name);
  p.pop.hidden = !open;
  p.btn.setAttribute('aria-expanded', String(open));
}

function closeBackdropPop() { closePopovers('__none__'); }
function closeCopyMenu() { closePopovers('__none__'); }

el.backdropBtn.addEventListener('click', () => togglePopover('backdrop'));
el.ratioBtn.addEventListener('click', () => togglePopover('ratio'));
el.copyCaret.addEventListener('click', () => togglePopover('copy'));

document.addEventListener('click', (e) => {
  const path = e.composedPath();
  POPOVERS.forEach((p) => {
    if (p.pop.hidden || path.includes(p.pop) || path.includes(p.btn)) return;
    p.pop.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
  });
  // The emoji picker closes on a click away too; with nothing picked, that
  // also means the tool is no longer wanted.
  if (!el.emojiPicker.hidden && !path.includes(el.emojiPicker) && !path.includes(emojiToolBtn)) {
    setTool('select');
  }
});

document.querySelectorAll('#pad-range, #pad-range-prefs').forEach((input) => {
  input.addEventListener('input', (e) => setPad(e.target.value));
});

el.outW.addEventListener('change', (e) => {
  ui.outW = clamp(Math.round(Number(e.target.value) || 0), 240, 8000);
  syncRatioPop();
  e.target.blur();
});

$('#copy-menu-copy').addEventListener('click', () => {
  closeCopyMenu();
  copyToClipboard();
});
$('#copy-menu-close').addEventListener('click', copyAndClose);

const wmToggle = $('#wm-toggle');
wmToggle.addEventListener('change', () => {
  settings.watermark = wmToggle.checked;
  document.body.classList.toggle('no-watermark', !settings.watermark);
  saveSettings();
});

$('#zoom-in').addEventListener('click', () => setZoom(ui.zoom + 1));
$('#zoom-out').addEventListener('click', () => setZoom(ui.zoom - 1));
el.zoomFit.addEventListener('click', () => setZoom(0));
$('#theme-btn').addEventListener('click', () => setTheme(settings.theme === 'light' ? 'dark' : 'light'));

$('#crop-cancel').addEventListener('click', () => setTool('select'));
$('#crop-apply').addEventListener('click', applyCrop);

$('#file-open').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', function () {
  if (this.files && this.files[0]) loadBlob(this.files[0], this.files[0].name);
  this.value = null;
});

if (isDesktop && window.electronAPI.window) {
  $('#win-min').addEventListener('click', () => window.electronAPI.window('minimize'));
  $('#win-max').addEventListener('click', () => window.electronAPI.window('maximize'));
  $('#win-close').addEventListener('click', () => window.electronAPI.window('close'));
}

/* --- Drag and drop -------------------------------------------------------- */

['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
  el.area.addEventListener(name, (e) => { e.preventDefault(); e.stopPropagation(); });
});
el.area.addEventListener('dragenter', () => el.area.classList.add('dragging'));
el.area.addEventListener('dragover', () => el.area.classList.add('dragging'));
el.area.addEventListener('dragleave', () => el.area.classList.remove('dragging'));
el.area.addEventListener('drop', (e) => {
  el.area.classList.remove('dragging');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadBlob(file, file.name);
});

/* --- Keyboard ------------------------------------------------------------- */

function typingInField(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (!el.prefs.hidden) return closePrefs();
    if (POPOVERS.some((p) => !p.pop.hidden)) return closePopovers('__none__');
    if (ui.tool === 'crop') return setTool('select');
    if (ui.tool === 'emoji') return setTool('select');
    return;
  }

  if (ui.editingText) {
    if (mod && e.key === 'Enter') {
      const textbox = canvas.getActiveObject();
      if (textbox && textbox.exitEditing) textbox.exitEditing();
      setTool('select');
    }
    return;
  }

  if (mod && e.key === ',') { e.preventDefault(); return openPrefs(); }

  if (typingInField(e.target) || !el.prefs.hidden) return;

  if (mod) {
    const key = e.key.toLowerCase();
    if (key === 'c') {
      e.preventDefault();
      if (e.shiftKey) copyAndClose();
      else copyToClipboard();
      return;
    }
    if (key === 's') { e.preventDefault(); saveToDisk(); return; }
    if (key === 'd') { e.preventDefault(); duplicateSelection(); return; }
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) canvas.redo(() => updateHistoryButtons());
      else canvas.undo(() => updateHistoryButtons());
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      setTool('select');
      const all = canvas.getObjects();
      if (all.length) {
        canvas.setActiveObject(new fabric.ActiveSelection(all, { canvas }));
        canvas.requestRenderAll();
      }
      return;
    }
    if (key === 'v') { pasteFromClipboard(); return; }
    if (key === '0') { e.preventDefault(); setZoom(0); return; }
    if (key === '=' || key === '+') { e.preventDefault(); setZoom(ui.zoom + 1); return; }
    if (key === '-') { e.preventDefault(); setZoom(ui.zoom - 1); return; }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const active = canvas.getActiveObjects();
    if (active.length) {
      canvas.remove(...active);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
    return;
  }

  const tool = KEYMAP[e.key.toLowerCase()];
  if (tool && hasImage()) setTool(tool);
});

function duplicateSelection() {
  const active = canvas.getActiveObject();
  if (!active) return;
  active.clone((clone) => {
    clone.set({ left: clone.left + 12 * unit(), top: clone.top + 12 * unit(), evented: true });
    if (clone.escTool === 'arrow') attachArrowControls(clone);
    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
  }, canvas.extraProps);
}

function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) return;
  navigator.clipboard.read().then((items) => {
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      item.getType(type).then((blob) => loadBlob(blob, 'Clipboard image'));
      return;
    }
  }).catch((err) => {
    console.warn('Nothing readable in the clipboard', err);
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

setTheme(settings.theme);
wmToggle.checked = settings.watermark;
document.body.classList.toggle('no-watermark', !settings.watermark);
renderPalette();
renderEmojiPicker();
renderRatioPop();
renderBackdropChips();
setPrefsTab('annotate');

// Shortcut labels follow the platform's modifier key.
$('#prefs-open').title = `Preferences — ${MOD},`;
$('#copy').title = `Copy to clipboard — ${MOD}C`;
$('#save').title = `Save to disk — ${MOD}S`;
el.undo.title = `Undo — ${MOD}Z`;
el.redo.title = `Redo — ${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'}`;
$('#copy-key').textContent = `${MOD_MENU}C`;
$('#copy-close-key').textContent = `⇧${MOD_MENU}C`;
setTool('arrow');
updateHistoryButtons();
loadFromQueryParam();
