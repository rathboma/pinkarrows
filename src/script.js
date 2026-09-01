import { createArrow, setArrowHeadPoint } from './arrow.js';

/* ==========================================================================
   Constants
   ========================================================================== */

const WATERMARK_TEXT = 'escribo.app';
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
  backdrop: 0,
  pad: 6
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

const KEYMAP = { s: 'select', a: 'arrow', r: 'rect', h: 'mark', t: 'text', e: 'emoji', c: 'crop' };
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
  editingText: false
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
  redo: $('#redo')
};

const isDesktop = !!window.electronAPI;
document.body.classList.toggle('is-desktop', isDesktop);

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

canvas.extraProps = ['selectable', 'editable', 'escTool', 'globalCompositeOperation'];

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
   Layout — fit the shot (plus backdrop) into the canvas area
   ========================================================================== */

function backdropCss(index = settings.backdrop) {
  if (index === 0) return 'transparent';
  if (index <= 4) return settings.solidBg[index - 1];
  const g = settings.gradBg[index - 5];
  return `linear-gradient(135deg,${g.a} 0%,${g.b} 100%)`;
}

/** Padding is a percentage of the composed width, exactly as CSS resolves it. */
function padFraction() {
  return backdropOn() ? settings.pad / 100 : 0;
}

function fitScale() {
  const availW = Math.max(1, el.area.clientWidth - AREA_PAD * 2);
  const availH = Math.max(1, el.area.clientHeight - AREA_PAD * 2);
  const p = padFraction();
  const k = 1 / (1 - 2 * p);
  return Math.min(availW / (imgW * k), availH / (imgH + 2 * p * k * imgW), 1);
}

function currentScale() {
  return fitScale() * Math.pow(ZOOM_STEP, ui.zoom);
}

function relayout() {
  if (!hasImage()) return;

  const scale = currentScale();
  const shotW = Math.max(1, Math.round(imgW * scale));
  const shotH = Math.max(1, Math.round(imgH * scale));

  canvas.setZoom(scale);
  canvas.setDimensions({ width: shotW, height: shotH });

  el.shot.style.width = shotW + 'px';
  el.shot.style.height = shotH + 'px';

  const p = padFraction();
  const padPx = p > 0 ? Math.round((p * shotW) / (1 - 2 * p)) : 0;
  el.backdrop.style.padding = padPx + 'px';
  el.backdrop.style.background = backdropCss();
  el.shot.style.borderRadius = backdropOn() ? shotW * 0.012 + 'px' : '0px';
  el.stage.classList.toggle('has-backdrop', backdropOn());

  el.watermark.style.setProperty('--wm-size', shotW * 0.0125 + 'px');

  // The crop layer lives in #stage, so give it the shot's exact box.
  el.cropLayer.style.left = padPx + 'px';
  el.cropLayer.style.top = padPx + 'px';
  el.cropLayer.style.width = shotW + 'px';
  el.cropLayer.style.height = shotH + 'px';

  el.zoomFit.textContent = ui.zoom === 0 ? 'Fit' : Math.round(scale * 100) + '%';
  if (crop) renderCropBox();
  canvas.requestRenderAll();
}

new ResizeObserver(() => relayout()).observe(el.area);

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
  relayout();
  updateHint();
  canvas.clearHistory();
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
    if (opt.target && opt.target.selectable) return;
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
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
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
    canvas.setActiveObject(emoji);
  } else if (ui.tool === 'rect') {
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

  // A click without a drag leaves a zero-size shape behind — drop it.
  if (made.escTool !== 'arrow' && (made.width < 2 || made.height < 2)) {
    canvas.remove(made);
    canvas.requestRenderAll();
    return;
  }

  setTool('select');
  canvas.setActiveObject(made);
  canvas.requestRenderAll();
});

canvas.on('text:editing:entered', () => { ui.editingText = true; });
canvas.on('text:editing:exited', () => {
  ui.editingText = false;
  const active = canvas.getActiveObject();
  if (active && active.type === 'textbox' && !active.text.trim()) canvas.remove(active);
});
canvas.on('object:added', updateHistoryButtons);
canvas.on('object:removed', updateHistoryButtons);
canvas.on('object:modified', updateHistoryButtons);

function updateHistoryButtons() {
  el.undo.disabled = !canvas.canUndo();
  el.redo.disabled = !canvas.canRedo();
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
    // Coordinates moved with the crop, so earlier history entries no longer apply.
    canvas.clearHistory();
    updateHistoryButtons();
    toast(`Cropped to ${w} × ${h}`);
  };
  cropped.onerror = () => toast('Could not apply the crop');
  cropped.src = cut.toDataURL('image/png');
}

/* ==========================================================================
   Export — backdrop + shot + annotations + watermark
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

function drawWatermark(ctx, x, y, w, h) {
  const size = w * 0.0125;
  const padX = size * 0.6;
  const padY = size * 0.26;
  const gap = size * 0.35;
  const icon = size * 0.9;
  const label = `600 ${size}px ${UI_FONT}`;

  ctx.save();
  ctx.font = label;
  const textW = ctx.measureText(WATERMARK_TEXT).width;
  const boxW = padX * 2 + icon + gap + textW;
  const boxH = padY * 2 + Math.max(icon, size);
  const bx = x + w - w * 0.011 - boxW;
  const by = y + h - h * 0.014 - boxH;

  ctx.fillStyle = 'rgba(255,255,255,.82)';
  roundRectPath(ctx, bx, by, boxW, boxH, size * 0.43);
  ctx.fill();

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

  ctx.fillStyle = '#8a8a96';
  ctx.font = label;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(WATERMARK_TEXT, bx + padX + icon + gap, cy);
  ctx.restore();
}

/** Renders annotations at full resolution, independent of the on-screen zoom. */
function renderAnnotations() {
  const zoom = canvas.getZoom();
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  // An active selection re-parents its objects, which would throw the offscreen
  // render's geometry off — drop it before measuring.
  canvas.discardActiveObject();
  canvas.setZoom(1);
  canvas.setDimensions({ width: imgW, height: imgH });
  const out = canvas.toCanvasElement(1);
  canvas.setZoom(zoom);
  canvas.setDimensions({ width, height });
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

  const p = padFraction();
  const padPx = p > 0 ? Math.round((p * imgW) / (1 - 2 * p)) : 0;
  const out = document.createElement('canvas');
  out.width = imgW + padPx * 2;
  out.height = imgH + padPx * 2;

  const ctx = out.getContext('2d');
  const u = unit();
  const radius = backdropOn() ? imgW * 0.012 : 0;

  if (backdropOn()) {
    const index = settings.backdrop;
    if (index <= 4) {
      ctx.fillStyle = settings.solidBg[index - 1];
    } else {
      const g = settings.gradBg[index - 5];
      const grad = ctx.createLinearGradient(0, 0, out.width, out.height);
      grad.addColorStop(0, g.a);
      grad.addColorStop(1, g.b);
      ctx.fillStyle = grad;
    }
    ctx.fillRect(0, 0, out.width, out.height);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.32)';
    ctx.shadowBlur = 34 * u;
    ctx.shadowOffsetY = 10 * u;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, padPx, padPx, imgW, imgH, radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRectPath(ctx, padPx, padPx, imgW, imgH, radius);
  ctx.clip();
  ctx.drawImage(img, padPx, padPx, imgW, imgH);
  ctx.drawImage(renderAnnotations(), padPx, padPx, imgW, imgH);
  if (settings.watermark) drawWatermark(ctx, padPx, padPx, imgW, imgH);
  ctx.restore();

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
  if (!dataUrl) return toast('Nothing to copy yet');
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    flashLabel($('#copy'), 'Copied');
    toast('Copied to clipboard');
  } catch (err) {
    console.error('Clipboard write failed', err);
    toast('Could not copy the image');
  }
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
   Status bar — backdrop, watermark, zoom, theme
   ========================================================================== */

function renderBackdropChips() {
  const solids = $('#solid-chips');
  const grads = $('#grad-chips');
  solids.innerHTML = '';
  grads.innerHTML = '';

  const addChip = (index, parent) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.style.background = index === 0 ? NONE_CHIP : backdropCss(index);
    btn.title = index === 0 ? 'None' : index <= 4 ? SOLID_NAMES[index - 1] : GRAD_NAMES[index - 5];
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(settings.backdrop === index));
    btn.addEventListener('click', () => {
      settings.backdrop = index;
      saveSettings();
      renderBackdropChips();
      syncBackdropButton();
      relayout();
    });
    parent.appendChild(btn);
  };

  [0, 1, 2, 3, 4].forEach((i) => addChip(i, solids));
  [5, 6, 7, 8].forEach((i) => addChip(i, grads));

  $('#pad-range').value = settings.pad;
  $('#pad-value').textContent = backdropOn() ? settings.pad + '%' : 'Off';
}

function syncBackdropButton() {
  el.backdropChip.style.background = backdropOn() ? backdropCss() : NONE_CHIP;
  el.backdropBtn.classList.toggle('on', backdropOn());
  $('#pad-value').textContent = backdropOn() ? settings.pad + '%' : 'Off';
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
      renderBackdropChips();
      syncBackdropButton();
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
      renderBackdropChips();
      syncBackdropButton();
      relayout();
    });
    end.addEventListener('input', (e) => {
      settings.gradBg[i].b = e.target.value;
      paint();
      saveSettings();
      renderBackdropChips();
      syncBackdropButton();
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
  el.backdropPop.hidden = true;
  el.backdropBtn.setAttribute('aria-expanded', 'false');
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
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

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
  renderBackdropChips();
  syncBackdropButton();
  relayout();
});

el.backdropBtn.addEventListener('click', () => {
  const open = el.backdropPop.hidden;
  el.backdropPop.hidden = !open;
  el.backdropBtn.setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', (e) => {
  if (!el.backdropPop.hidden && !e.target.closest('.popover-anchor')) {
    el.backdropPop.hidden = true;
    el.backdropBtn.setAttribute('aria-expanded', 'false');
  }
});

$('#pad-range').addEventListener('input', (e) => {
  settings.pad = Number(e.target.value);
  // Nudging padding while the backdrop is off implies wanting one.
  if (!backdropOn() && settings.pad > 0) settings.backdrop = 5;
  saveSettings();
  renderBackdropChips();
  syncBackdropButton();
  relayout();
});

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
    if (!el.backdropPop.hidden) {
      el.backdropPop.hidden = true;
      el.backdropBtn.setAttribute('aria-expanded', 'false');
      return;
    }
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
    if (key === 'c') { e.preventDefault(); copyToClipboard(); return; }
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
renderBackdropChips();
syncBackdropButton();
setPrefsTab('annotate');
setTool('arrow');
updateHistoryButtons();
loadFromQueryParam();
