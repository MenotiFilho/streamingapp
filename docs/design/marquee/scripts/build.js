// Builds the component library of the mockup. Run through scripts/build.sh (openpencil eval).
//
// Every component is a real Figma component (variants combined into a set, text and
// boolean properties declared on it). A use of one is an instance, with one exception:
// figlens draws an instance's text from its main component, because OpenPencil never
// stores glyphs for an override. So a use whose text differs is detached, and keeps the
// component's name. KEEP_LINKS=1 keeps every use linked, for opening the file in Figma.
const fs = await import('node:fs');
const D = '/d';
const KEEP = typeof process !== 'undefined' && process.env.KEEP_LINKS === '1';
const meta = JSON.parse(fs.readFileSync(`${D}/assets/meta.json`, 'utf8'));
const T = meta.titles;
const FAM = 'Figtree';
const WEIGHT = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' };
for (const s of Object.values(WEIGHT)) await figma.loadFontAsync({ family: FAM, style: s });

// ---------- tokens ----------
const C = {
  canvas: '#0A0B0F', surface: '#14161D', surface2: '#1E212A', surface3: '#2A2E39', sheet: '#101218',
  white: '#FFFFFF', ink: '#0A0B0F', accent: '#C4A7E7',
  imdb: '#F5C518', ok: '#3DD68C', warn: '#FFB224', danger: '#FF5C66',
};
const A = { muted: 0.72, faint: 0.5, line: 0.12, glass: 0.14 };
const rgb = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const solid = (h, o = 1) => [{ type: 'SOLID', color: rgb(h), opacity: o }];

// ---------- primitives ----------
function place(parent, n, o) {
  if (parent) parent.appendChild(n);
  n.x = o.x || 0; n.y = o.y || 0;
  if (o.name) n.name = o.name;
  return n;
}
function look(n, o) {
  n.fills = o.fill ? solid(o.fill, o.o ?? 1) : [];
  n.clipsContent = o.clip ?? false;
  if (o.r) n.cornerRadius = o.r;
  if (o.stroke) { n.strokes = solid(o.stroke, o.so ?? 1); n.strokeWeight = o.sw || 1; n.strokeAlign = o.sa || 'INSIDE'; }
  const fx = [];
  if (o.shadow) fx.push({ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: o.shadowA ?? 0.55 }, offset: { x: 0, y: o.shadow }, radius: o.shadow * 2.2, spread: 0, visible: true, blendMode: 'NORMAL' });
  if (o.blur) fx.push({ type: 'BACKGROUND_BLUR', radius: o.blur, visible: true });
  if (fx.length) n.effects = fx;
  return n;
}
function box(parent, o) {
  const n = figma.createFrame();
  n.resize(o.w, o.h);
  look(n, o);
  return place(parent, n, o);
}
// horizontal auto layout, hugging its content unless given a width
function hug(n, o) {
  n.layoutMode = 'HORIZONTAL';
  n.itemSpacing = o.gap ?? 10;
  n.paddingLeft = n.paddingRight = o.px ?? 0;
  n.paddingTop = n.paddingBottom = 0;
  n.counterAxisAlignItems = 'CENTER';
  n.primaryAxisAlignItems = o.justify || 'CENTER';
  n.resize(o.w || 100, o.h);
  n.counterAxisSizingMode = 'FIXED';
  n.primaryAxisSizingMode = o.w ? 'FIXED' : 'AUTO';
  return n;
}
function row(parent, o) {
  const n = figma.createFrame();
  look(n, o);
  place(parent, n, o);
  return hug(n, o);
}
function rect(parent, o) {
  const n = figma.createRectangle();
  n.resize(Math.max(o.w, 0.01), o.h);
  n.fills = o.fills || solid(o.fill || C.white, o.o ?? 1);
  if (o.r) n.cornerRadius = o.r;
  if (o.stroke) { n.strokes = solid(o.stroke, o.so ?? 1); n.strokeWeight = o.sw || 1; n.strokeAlign = o.sa || 'INSIDE'; }
  return place(parent, n, o);
}
// dir = the side where stop 0 sits
function grad(parent, o) {
  const m = { left: [[1, 0, 0], [0, 1, 0]], right: [[-1, 0, 1], [0, -1, 1]], top: [[0, 1, 0], [-1, 0, 1]], bottom: [[0, -1, 1], [1, 0, 0]] }[o.dir];
  const col = rgb(o.color || C.canvas);
  return rect(parent, { ...o, name: o.name || 'Scrim', fills: [{ type: 'GRADIENT_LINEAR', gradientTransform: m, gradientStops: o.stops.map(([position, a]) => ({ position, color: { ...col, a } })) }] });
}
const hashes = {};
function hashOf(file) {
  if (!hashes[file]) hashes[file] = figma.createImage(new Uint8Array(fs.readFileSync(`${D}/assets/${file}`))).hash;
  return hashes[file];
}
const imageFill = (asset, mode = 'FILL') => [{ type: 'IMAGE', scaleMode: mode, imageHash: hashOf(asset.file) }];
function image(parent, asset, o) {
  return rect(parent, { ...o, name: o.name || 'Art', fills: imageFill(asset, o.mode) });
}
// a wordmark fitted inside maxW x maxH, anchored at its bottom-left
function logoBox(asset, maxW, maxH) {
  const k = Math.min(maxW / asset.w, maxH / asset.h);
  return { w: Math.round(asset.w * k), h: Math.round(asset.h * k) };
}
function logo(parent, asset, o) {
  const { w, h } = logoBox(asset, o.maxW, o.maxH);
  return image(parent, asset, { name: 'Logo', mode: 'FIT', x: o.x, y: o.bottom - h, w, h });
}
function text(parent, str, o = {}) {
  const t = figma.createText();
  t.fontName = { family: FAM, style: WEIGHT[o.weight || 500] };
  t.fontSize = o.size || 20;
  t.lineHeight = { unit: 'PIXELS', value: o.lh || Math.round((o.size || 20) * 1.35) };
  if (o.ls) t.letterSpacing = { unit: 'PIXELS', value: o.ls };
  t.characters = str;
  t.fills = solid(o.color || C.white, o.o ?? 1);
  place(parent, t, { ...o, name: o.name || str.slice(0, 24) });
  if (o.w) {
    // the height is not reflowed here, so set it from the single-line width
    const lines = Math.max(1, Math.ceil(t.width / o.w));
    t.textAutoResize = 'HEIGHT';
    t.resize(o.w, lines * t.lineHeight.value);
    if (o.align) t.textAlignHorizontal = o.align;
  } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}
const cut = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n)).replace(/[,.;:]$/, '') + '…');

// ---------- icons: one component per glyph, Phosphor, filled outlines ----------
const PH = {
  'house': 'house', 'compass': 'compass', 'search': 'magnifying-glass', 'library': 'books', 'puzzle': 'puzzle-piece',
  'settings': 'gear-six', 'play': 'play', 'pause': 'pause', 'info': 'info', 'arrow-left': 'arrow-left', 'x': 'x',
  'list-video': 'queue', 'check': 'check', 'triangle-alert': 'warning', 'captions': 'closed-captioning',
  'audio-lines': 'waveform', 'gauge': 'gauge', 'chapters': 'list-numbers', 'maximize': 'corners-out',
  'volume-2': 'speaker-high', 'rotate-ccw': 'arrow-counter-clockwise', 'rotate-cw': 'arrow-clockwise',
  'skip-forward': 'skip-forward', 'sliders-horizontal': 'sliders-horizontal', 'users': 'users', 'disk': 'hard-drive',
  'globe': 'globe-simple', 'picture': 'monitor', 'caret-right': 'caret-right', 'plus': 'plus', 'bookmark': 'bookmark-simple',
  'film': 'film-slate', 'arrow-clockwise': 'arrow-clockwise', 'wifi-x': 'wifi-x', 'device': 'device-mobile',
  'skip-back': 'skip-back', 'stop': 'stop', 'caret-down': 'caret-down', 'signal': 'cell-signal-full', 'wifi': 'wifi-high',
  'battery': 'battery-full', 'episodes': 'stack', 'mute': 'speaker-x', 'host': 'television-simple',
  'download': 'download-simple', 'key': 'key', 'arrow-up': 'arrow-up', 'arrow-down': 'arrow-down', 'trash': 'trash',
  'handle': 'dots-six-vertical', 'minus-circle': 'minus-circle', 'ring': 'circle', 'notch': 'circle-notch', 'stats': 'pulse', 'minus': 'minus',
};
const CORE = '/d/tools/node_modules/@open-pencil/core/dist';
const { graphOf } = await import(`${CORE}/figma-api/graph.js`);
const { regenerateFillGeometry } = await import(`${CORE}/vector/fill-geometry.js`);
// OpenPencil leaves a new vector's outline implicit; the file must store it, or
// readers other than OpenPencil draw the vector as its box.
function storeOutline(v) {
  const fillGeometry = regenerateFillGeometry(v.vectorNetwork, [{ windingRule: 'NONZERO', commandsBlob: new Uint8Array() }]);
  graphOf(v).updateNode(v.id, { fillGeometry });
}
const ICONS = {};
// A glyph is known by its outline: inside an instance a nested icon names no main
// component of its own, so detachDeep tells a glyph by this signature.
const SIGS = new Map();
function glyphSig(v) {
  const net = v.vectorNetwork, w = v.width || 1, h = v.height || 1;
  const pts = net.vertices.slice(0, 10).map((p) => `${Math.round((p.x / w) * 50)},${Math.round((p.y / h) * 50)}`);
  return `${net.vertices.length}/${net.segments.length}/${pts.join(';')}`;
}
let iconHome = null; // the sheet the icon components live on
function iconComponent(name, weight) {
  const key = weight === 'regular' ? name : `${name}-${weight}`;
  if (ICONS[key]) return ICONS[key];
  const ph = PH[name];
  const file = weight === 'regular' ? ph : `${ph}-${weight}`;
  const svg = fs.readFileSync(`${D}/tools/node_modules/@phosphor-icons/core/assets/${weight}/${file}.svg`, 'utf8')
    .replace('<svg ', '<svg width="24" height="24" ').replace(/currentColor/g, C.white);
  const g = figma.createNodeFromSvg(svg);
  const c = figma.createComponent();
  c.name = `icon/${key}`; c.resize(24, 24); c.fills = [];
  const n = Object.keys(ICONS).length, col = n % 12, line = Math.floor(n / 12);
  place(iconHome.frame, c, { x: 80 + col * 148 + 46, y: 220 + line * 140 });
  text(iconHome.frame, key, { x: 80 + col * 148, y: 220 + line * 140 + 44, w: 116, size: 13, o: A.faint, align: 'CENTER' });
  for (const v of [...g.children]) { storeOutline(v); c.appendChild(v); v.constraints = { horizontal: 'SCALE', vertical: 'SCALE' }; }
  g.remove();
  ICONS[key] = c;
  SIGS.set(glyphSig(c.findOne((k) => k.type === 'VECTOR')), c);
  return c;
}
function tint(n, color, o = 1) {
  for (const v of n.findAll((k) => k.type === 'VECTOR')) v.fills = solid(color, o);
}
function icon(parent, name, o = {}) {
  const size = o.size || 24, weight = o.filled ? 'fill' : o.bold ? 'bold' : 'regular';
  const n = iconComponent(name, weight).createInstance();
  place(parent, n, { x: o.x, y: o.y, name: o.name || 'Icon' });
  n.resize(size, size);
  tint(n, o.color || C.white, o.o ?? 1);
  return n;
}
// swaps the glyph of an icon instance, keeping its size and colour
function swapIcon(n, name, o = {}) {
  const v = n.findOne((k) => k.type === 'VECTOR'), fill = v && v.fills[0], w = n.width, label = n.name;
  n.swapComponent(iconComponent(name, o.filled ? 'fill' : o.bold ? 'bold' : 'regular'));
  n.name = label;
  n.resize(w, w);
  if (fill) for (const k of n.findAll((q) => q.type === 'VECTOR')) k.fills = [fill];
}

// ---------- component machinery ----------
const props = (name) => Object.fromEntries(name.split(', ').map((p) => p.split('=')));
const ANCHOR = new Map(); // set id -> how a non-rest state sits on the rest footprint
function variantOf(set, want = {}) {
  if (set.type === 'COMPONENT') return set;
  const defs = set.componentPropertyDefinitions;
  const all = {};
  for (const [k, d] of Object.entries(defs)) if (d.type === 'VARIANT') all[k] = d.defaultValue;
  Object.assign(all, want);
  const hit = set.children.find((c) => Object.entries(props(c.name)).every(([k, v]) => all[k] === v));
  if (!hit) throw new Error(`${set.name}: no variant ${JSON.stringify(all)}`);
  return hit;
}
const pathOf = (root, node) => { const p = []; for (let k = node; k !== root; k = k.parent) p.unshift(k.parent.children.indexOf(k)); return p; };
const at = (root, path) => path.reduce((k, i) => k && k.children && k.children[i], root);
// Detaching drops the glyph swaps of the icons inside, so each icon's glyph, size
// and colour is noted by its place in the tree first and put back after.
function detachDeep(n) {
  const icons = n.findAll((k) => k.type === 'INSTANCE' && k.children.length > 0 && k.children.every((q) => q.type === 'VECTOR')).map((k) => {
    const v = k.children[0];
    return { path: pathOf(n, k), main: SIGS.get(glyphSig(v)), w: k.width, fill: v.fills[0] };
  }).filter((i) => i.main);
  const f = n.type === 'INSTANCE' ? n.detachInstance() : n;
  for (;;) {
    const inner = f.findOne((k) => k.type === 'INSTANCE' && !!k.findOne((t) => t.type === 'TEXT'));
    if (!inner) break;
    inner.detachInstance();
  }
  for (const { path, main, w, fill } of icons) {
    const k = at(f, path);
    if (!k || k.type !== 'INSTANCE') continue;
    const name = k.name;
    k.swapComponent(main);
    k.name = name;
    k.resize(w, w);
    if (fill) for (const q of k.findAll((v) => v.type === 'VECTOR')) q.fills = [fill];
  }
  return f;
}
const layer = (n, name) => n.findOne((k) => k.name === name);
// An instance of `set` with the variant `want`. o.x/o.y place the rest footprint, so a
// focused (larger) card lands centred where the resting one would.
function use(parent, set, want = {}, o = {}) {
  const main = variantOf(set, want);
  let n = main.createInstance();
  parent.appendChild(n);
  let x = o.x || 0, y = o.y || 0;
  const anchor = set.type === 'COMPONENT_SET' && ANCHOR.get(set.id);
  if (anchor && want.state && want.state !== 'rest') {
    const rest = variantOf(set, { ...want, state: 'rest' });
    x -= (main.width - rest.width) / 2;
    y -= anchor === 'bottom' ? main.height - rest.height : (main.height - rest.height) / 2;
  }
  n.x = x; n.y = y;
  const texts = Object.entries(o.text || {});
  // a logo of another shape moves inside its box, and an instance cannot move a layer
  if ((texts.length && !KEEP) || o.logo) {
    n = detachDeep(n);
    n.name = `${set.name} · ${main.name}`;
  }
  for (const [k, v] of texts) {
    const t = layer(n, k);
    if (!t) throw new Error(`${set.name}: no text layer ${k}`);
    t.characters = v;
  }
  for (const [k, asset] of Object.entries(o.image || {})) layer(n, k).fills = imageFill(asset, k === 'Logo' ? 'FIT' : 'FILL');
  for (const [k, [asset, maxW, maxH]] of Object.entries(o.logo || {})) {
    const l = layer(n, k), bottom = l.y + l.height, { w, h } = logoBox(asset, maxW, maxH);
    l.fills = imageFill(asset, 'FIT'); l.resize(w, h); l.y = bottom - h;
  }
  for (const k of o.hide || []) layer(n, k).visible = false;
  for (const k of o.show || []) layer(n, k).visible = true;
  for (const [k, ic] of Object.entries(o.icon || {})) {
    const l = layer(n, k);
    if (!l) throw new Error(`${set.name}: no icon layer ${k}`);
    swapIcon(l, ...[].concat(ic));
  }
  if (o.name) n.name = o.name;
  if (o.edit) {
    try { o.edit(n); } catch (e) {
      // with KEEP_LINKS an instance refuses some edits (moving a layer); detach that one use
      if (!KEEP || n.type !== 'INSTANCE') throw e;
      const name = n.name;
      n = detachDeep(n); n.name = name;
      o.edit(n);
    }
  }
  return n;
}

// ---------- sheets ----------
const SHEET_W = 1920;
function sheet(page, i, name, title, note) {
  const frame = box(page, { name, x: i * 2040, y: 0, w: SHEET_W, h: 400, fill: C.canvas });
  text(frame, title, { x: 80, y: 56, size: 48, weight: 800 });
  const n = note && text(frame, note, { x: 80, y: 124, w: 1400, size: 19, lh: 28, o: A.muted });
  return { frame, x: 80, y: n ? 124 + n.height + 64 : 160, rowH: 0 };
}
function finish(sh) {
  const right = Math.max(...sh.frame.children.map((k) => k.x + k.width));
  sh.frame.resize(Math.max(SHEET_W, right + 80), sh.y + sh.rowH + 80);
}
// sheets side by side, 120 apart, whatever their widths
function lineUp(page) {
  let x = 0;
  for (const f of page.children) { f.x = x; f.y = 0; x += f.width + 120; }
}
// lays variants out in a grid and combines them into one set, placed on the sheet with
// a heading and a caption over every variant
function variants(sh, name, entries, o = {}) {
  const comps = entries.map((e) => {
    const c = figma.createComponent();
    sh.frame.appendChild(c);
    c.name = Object.entries(e.p).map(([k, v]) => `${k}=${v}`).join(', ');
    c.fills = []; c.clipsContent = false;
    e.build(c, e.p);
    return c;
  });
  const set = figma.combineAsVariants(comps, sh.frame);
  set.name = name;
  look(set, { fill: C.sheet, r: 20, stroke: C.white, so: 0.08 });
  const cols = o.cols || comps.length, pad = 40, gap = o.gap ?? 56, vgap = o.vgap ?? gap, cap = 30;
  const colW = [], rowH = [];
  comps.forEach((c, i) => {
    const j = i % cols, r = Math.floor(i / cols);
    colW[j] = Math.max(colW[j] || 0, c.width); rowH[r] = Math.max(rowH[r] || 0, c.height);
  });
  comps.forEach((c, i) => {
    const j = i % cols, r = Math.floor(i / cols);
    c.x = pad + colW.slice(0, j).reduce((a, b) => a + b, 0) + j * gap;
    c.y = pad + cap + rowH.slice(0, r).reduce((a, b) => a + b, 0) + r * (vgap + cap);
  });
  set.resize(pad * 2 + colW.reduce((a, b) => a + b, 0) + (cols - 1) * gap, pad * 2 + rowH.reduce((a, b) => a + b, 0) + rowH.length * cap + (rowH.length - 1) * vgap);
  for (const [k, d] of Object.entries(o.text || {})) {
    const key = set.addComponentProperty(k, 'TEXT', d);
    for (const c of comps) { const t = layer(c, k); if (t) t.componentPropertyReferences = { characters: key }; }
  }
  for (const [k, d] of Object.entries(o.bool || {})) {
    const key = set.addComponentProperty(k, 'BOOLEAN', d);
    for (const c of comps) { const t = layer(c, k); if (t) { t.componentPropertyReferences = { visible: key }; t.visible = d; } }
  }
  if (o.anchor) ANCHOR.set(set.id, o.anchor);
  shelve(sh, set, name, o.note, o.newRow);
  for (const c of comps) text(sh.frame, Object.values(props(c.name)).join(' · '), { x: set.x + c.x, y: set.y + c.y - 26, size: 13, weight: 600, o: A.faint });
  return set;
}
// a single component, no variants
function single(sh, name, w, h, build, o = {}) {
  const c = figma.createComponent();
  sh.frame.appendChild(c);
  c.name = name; c.resize(w, h); c.fills = []; c.clipsContent = o.clip ?? false;
  build(c);
  for (const [k, d] of Object.entries(o.text || {})) {
    const key = c.addComponentProperty(k, 'TEXT', d);
    const t = layer(c, k); if (t) t.componentPropertyReferences = { characters: key };
  }
  for (const [k, d] of Object.entries(o.bool || {})) {
    const key = c.addComponentProperty(k, 'BOOLEAN', d);
    const t = layer(c, k); if (t) { t.componentPropertyReferences = { visible: key }; t.visible = d; }
  }
  shelve(sh, c, name, o.note, o.newRow);
  return c;
}
function shelve(sh, node, name, note, newRow) {
  const colW = Math.max(node.width, note ? 360 : 0);
  if (newRow || (sh.x > 80 && sh.x + colW > SHEET_W - 80)) { sh.y += sh.rowH + 72; sh.x = 80; sh.rowH = 0; }
  const h = text(sh.frame, name, { x: sh.x, y: sh.y, size: 22, weight: 800 });
  const n = note && text(sh.frame, note, { x: sh.x, y: sh.y + 30, w: colW, size: 15, lh: 21, o: A.faint });
  const head = n ? 30 + n.height + 14 : 40;
  node.x = sh.x; node.y = sh.y + head;
  sh.x += Math.max(colW, h.width) + 72;
  sh.rowH = Math.max(sh.rowH, node.height + head);
}

function example(sh, set, want, o, label, note) {
  const n = use(sh.frame, set, want, o);
  shelve(sh, n, label, note);
  return n;
}

// ---------- data ----------
const ids = (list) => list.map((i) => T[i]);
const MOVIES = ids(meta.movies), SERIES = ids(meta.series);
const DUNE = T.tt15239678, SEV = T.tt11280740, TLOU = T.tt3581920, SPIDER = T.tt9362722;

// ---------- pages ----------
const pageF = figma.currentPage;
pageF.name = 'Foundations';
for (const c of [...pageF.children]) c.remove();
const pageC = figma.createPage();
pageC.name = 'Components';

iconHome = sheet(pageC, 0, 'C0 Icons', 'Icons', 'One component per glyph, from Phosphor. A use is an instance: resize it, recolour its vector, or swap it for another glyph.');

// ============ C1 Actions ============
const s1 = sheet(pageC, 1, 'C1 Actions', 'Actions',
  'White is focus: whatever has focus turns white with ink content. Lavender is the primary action at rest, progress and selection. Glass (white at 14%) is everything else.');

const KIND_REST = { primary: [C.accent, 1, C.ink], secondary: [C.white, A.glass, C.white], ghost: [C.white, 0, C.white], danger: [C.danger, 1, C.white] };
const SIZE = { L: { h: 60, px: 30, size: 20, is: 22 }, M: { h: 48, px: 22, size: 17, is: 18 } };
function paint(c, kind, state) {
  const [fill, o, ink] = state === 'focus' ? [C.white, 1, C.ink] : KIND_REST[kind];
  look(c, { fill, o, r: c.height / 2, ...(state === 'focus' ? { shadow: 16, shadowA: 0.45 } : {}) });
  return ink;
}
const BUTTON = variants(s1, 'Button',
  ['primary', 'secondary', 'ghost', 'danger'].flatMap((kind) => ['L', 'M'].flatMap((size) => ['rest', 'focus'].map((state) => ({
    p: { kind, size, state },
    build(c) {
      const z = SIZE[size];
      hug(c, { h: z.h, px: z.px, gap: 12 });
      const ink = paint(c, kind, state);
      icon(c, 'play', { size: z.is, color: ink, filled: true });
      text(c, 'Watch now', { name: 'Label', size: z.size, weight: 700, color: ink });
    },
  })))),
  { cols: 4, text: { Label: 'Watch now' }, bool: { Icon: true }, note: 'Label and Icon are properties; swap the icon instance for another glyph.' });

const ISIZE = { XL: [80, 34], L: [56, 26], M: [48, 22] };
const ICON_BUTTON = variants(s1, 'Icon button',
  ['primary', 'secondary', 'ghost'].flatMap((kind) => ['XL', 'L', 'M'].flatMap((size) => ['rest', 'focus'].map((state) => ({
    p: { kind, size, state },
    build(c) {
      const [d, is] = ISIZE[size];
      c.resize(d, d);
      const ink = paint(c, kind, state);
      icon(c, 'play', { size: is, color: ink, filled: true, x: (d - is) / 2, y: (d - is) / 2 });
    },
  })))),
  { cols: 6, gap: 120, vgap: 48, newRow: true, note: 'Back, close, transport, player menus. Swap the icon.' });

const CHIP = variants(s1, 'Chip',
  ['off', 'on'].flatMap((selected) => ['rest', 'focus'].map((state) => ({
    p: { selected, state },
    build(c) {
      hug(c, { h: 46, px: 22, gap: 8 });
      const focus = state === 'focus', on = selected === 'on';
      look(c, focus ? { fill: C.white, r: 23, shadow: 12, shadowA: 0.4 } : on ? { fill: C.accent, r: 23 } : { fill: C.white, o: 0.1, r: 23 });
      const ink = focus || on ? C.ink : C.white;
      if (on) icon(c, 'check', { name: 'Check', size: 18, color: ink, bold: true });
      text(c, 'Season 2', { name: 'Label', size: 18, weight: on || focus ? 700 : 600, color: ink });
    },
  }))),
  { cols: 4, text: { Label: 'Season 2' }, newRow: true, note: 'Filters and season pickers. Selected is lavender; focus is white whether selected or not.' });

const BADGE_TONE = { neutral: [C.white, A.glass, C.white], accent: [C.accent, 1, C.ink], imdb: [C.imdb, 1, C.ink], danger: [C.danger, 0.2, C.danger] };
const BADGE = variants(s1, 'Badge',
  Object.keys(BADGE_TONE).map((tone) => ({
    p: { tone },
    build(c) {
      const [fill, o, ink] = BADGE_TONE[tone];
      hug(c, { h: 28, px: 10 });
      look(c, { fill, o, r: 6 });
      text(c, { neutral: 'DOLBY VISION', accent: 'UP NEXT', imdb: 'IMDb', danger: 'OFFLINE' }[tone], { name: 'Label', size: 14, weight: 700, color: ink, ls: 0.4 });
    },
  })),
  { text: { Label: 'DOLBY VISION' }, note: 'Stream facts, tags and states.' });
finish(s1);

// ============ C2 Navigation ============
const s2 = sheet(pageC, 2, 'C2 Navigation', 'Navigation',
  'The rail sits on the left over the picture. At rest it shows icons only; when focus enters it, it widens to show labels. Active is lavender, focus is white.');
const BRAND = single(s2, 'Brand mark', 48, 48, (c) => {
  look(c, { fill: C.accent, r: 14 });
  icon(c, 'play', { size: 24, x: 13, y: 12, color: C.ink, filled: true });
});
const NAV_ITEM = variants(s2, 'Nav item',
  ['off', 'on'].flatMap((expanded) => ['rest', 'active', 'focus'].map((state) => ({
    p: { expanded, state },
    build(c) {
      const focus = state === 'focus', active = state === 'active', wide = expanded === 'on';
      const ink = focus ? C.ink : active ? C.accent : C.white, o = focus || active ? 1 : 0.65;
      if (wide) {
        hug(c, { w: 280, h: 56, px: 18, gap: 16, justify: 'MIN' });
        look(c, focus ? { fill: C.white, r: 28, shadow: 12, shadowA: 0.4 } : active ? { fill: C.accent, o: 0.16, r: 28 } : { r: 28 });
        icon(c, 'house', { size: 26, color: ink, o, filled: active || focus });
        text(c, 'Home', { name: 'Label', size: 20, weight: 700, color: focus ? C.ink : C.white, o: focus || active ? 1 : 0.72 });
      } else {
        c.resize(56, 56);
        look(c, focus ? { fill: C.white, r: 28, shadow: 12, shadowA: 0.4 } : active ? { fill: C.accent, o: 0.16, r: 28 } : { r: 28 });
        icon(c, 'house', { size: 26, x: 15, y: 15, color: ink, o, filled: active || focus });
      }
    },
  }))),
  { cols: 3, text: { Label: 'Home' }, note: 'Swap the icon for the destination.' });
const NAV = [['house', 'Home'], ['compass', 'Discover'], ['search', 'Search'], ['library', 'Library'], ['puzzle', 'Addons'], ['settings', 'Settings']];
const RAIL = variants(s2, 'Nav rail',
  ['off', 'on'].map((expanded) => ({
    p: { expanded },
    build(c) {
      const wide = expanded === 'on';
      if (wide) {
        // open, it dims the whole screen and stands on a near-opaque panel
        c.resize(1920, 1080);
        rect(c, { name: 'Dim', w: 1920, h: 1080, fill: C.canvas, o: 0.55 });
        rect(c, { name: 'Panel', w: 360, h: 1080, fill: C.canvas });
        grad(c, { dir: 'left', x: 360, w: 260, h: 1080, stops: [[0, 1], [1, 0]] });
      } else {
        c.resize(160, 1080);
        grad(c, { dir: 'left', w: 160, h: 1080, stops: [[0, 0.85], [0.5, 0.55], [1, 0]] });
      }
      use(c, BRAND, {}, { x: 36, y: 40 });
      NAV.forEach(([ic, label], i) => {
        const state = i === 0 ? 'active' : wide && i === 1 ? 'focus' : 'rest';
        use(c, NAV_ITEM, { expanded, state }, {
          x: 32, y: 300 + i * 80, name: `Nav/${label}`,
          icon: { Icon: [ic, { filled: state !== 'rest' }] },
          ...(wide && i ? { text: { Label: label } } : {}),
        });
      });
      text(c, '21:42', { name: 'Clock', x: 38, y: 1010, size: 17, weight: 600, o: A.faint });
    },
  })),
  { newRow: true, note: 'Collapsed while focus is in the content; expanded while focus is in the rail, dimming the screen behind it.' });
const TICKS = variants(s2, 'Hero ticks',
  [1, 2, 3, 4, 5].map((n) => ({
    p: { active: String(n) },
    build(c) {
      hug(c, { h: 8, gap: 8 });
      for (let i = 1; i <= 5; i++) {
        const p = box(c, { name: `Tick ${i}`, w: i === n ? 44 : 8, h: 8, r: 4, fill: C.white, o: 0.28, clip: true });
        if (i === n) rect(p, { name: 'Elapsed', w: 26, h: 8, r: 4 });
      }
    },
  })),
  { cols: 1, gap: 24, note: 'Which of the five featured titles the hero shows; the bar fills until it rotates.' });
finish(s2);

// ============ C3 Cards ============
const s3 = sheet(pageC, 3, 'C3 Cards', 'Cards',
  'Artwork carries the screen. Focus scales a card up (8% for posters, 7% for wide cards) and draws a white outline and a shadow; captions sit under the card, never on it.');
function card(c, w, h, focus, k) {
  const fw = focus ? Math.round(w * k) : w, fh = focus ? Math.round(h * k) : h;
  c.resize(fw, fh);
  look(c, { fill: C.surface2, r: 16, clip: true, ...(focus ? { stroke: C.white, sw: 4, sa: 'OUTSIDE', shadow: 24 } : {}) });
  return [fw, fh];
}
const POSTER = variants(s3, 'Poster',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const [fw, fh] = card(c, 208, 312, state === 'focus', 1.08);
      image(c, MOVIES[0].poster, { w: fw, h: fh });
      rect(c, { name: 'Progress track', x: 14, y: fh - 14, w: fw - 28, h: 5, r: 3, o: 0.28 });
      rect(c, { name: 'Progress', x: 14, y: fh - 14, w: (fw - 28) * 0.4, h: 5, r: 3, fill: C.accent });
      const k = box(c, { name: 'Watched', x: fw - 48, y: 12, w: 36, h: 36, r: 18, fill: C.ink, o: 0.72 });
      icon(k, 'check', { size: 20, x: 8, y: 8, color: C.accent, bold: true });
    },
  })),
  { anchor: 'center', bool: { Watched: false, Progress: false, 'Progress track': false }, note: 'Catalog rows. Watched and Progress are off by default.' });
example(s3, POSTER, { state: 'rest' }, { image: { Art: MOVIES[3].poster }, show: ['Progress', 'Progress track'] }, 'In use', 'Progress on.');
example(s3, POSTER, { state: 'rest' }, { image: { Art: MOVIES[6].poster }, show: ['Watched'] }, ' ', 'Watched on.');
const WIDE = variants(s3, 'Wide card',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const [fw, fh] = card(c, 400, 225, state === 'focus', 1.07);
      image(c, SPIDER.background, { w: fw, h: fh });
      grad(c, { dir: 'bottom', y: fh * 0.35, w: fw, h: fh * 0.65, stops: [[0, 0.95], [1, 0]] });
      logo(c, SPIDER.logo, { x: 20, bottom: fh - 28, maxW: fw * 0.45, maxH: fh * 0.3 });
      use(c, BADGE, { tone: 'accent' }, { x: 14, y: 14, name: 'Up next' });
      rect(c, { name: 'Progress track', x: 20, y: fh - 14, w: fw - 40, h: 5, r: 3, o: 0.28 });
      rect(c, { name: 'Progress', x: 20, y: fh - 14, w: (fw - 40) * 0.4, h: 5, r: 3, fill: C.accent });
    },
  })),
  { anchor: 'center', newRow: true, bool: { 'Up next': false }, note: 'Continue watching. The art is a backdrop with the title\'s logo, or an episode still.' });
example(s3, WIDE, { state: 'rest' }, { image: { Art: SERIES[1].background }, logo: { Logo: [SERIES[1].logo, 180, 68] }, show: ['Up next'], edit: (n) => layer(n, 'Progress').resize(1, 5) }, 'In use', 'Up next on, with another title\'s art and logo.');
const CAPTION = single(s3, 'Card caption', 400, 56, (c) => {
  text(c, 'Spider-Man: Across the Spider-Verse', { name: 'Title', w: 400, size: 19, weight: 700, lh: 26 });
  text(c, '1 h 51 min left', { name: 'Note', y: 28, size: 16, o: A.faint });
}, { text: { Title: 'Spider-Man: Across the Spider-Verse', Note: '1 h 51 min left' }, note: 'Under a wide card or an episode.' });
const EPISODE = variants(s3, 'Episode card',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus';
      const [fw, fh] = card(c, 408, 230, focus, 1.06);
      image(c, SEV.episodes[2].still, { w: fw, h: fh });
      const k = box(c, { name: 'Watched', x: fw - 52, y: 14, w: 38, h: 38, r: 19, fill: C.ink, o: 0.72 });
      icon(k, 'check', { size: 22, x: 8, y: 8, color: C.ok, bold: true });
      if (focus) {
        const p = box(c, { name: 'Play', x: fw / 2 - 32, y: fh / 2 - 32, w: 64, h: 64, r: 32, fill: C.white });
        icon(p, 'play', { size: 28, x: 20, y: 18, color: C.ink, filled: true });
      }
      rect(c, { name: 'Progress track', x: 18, y: fh - 18, w: fw - 36, h: 5, r: 3, o: 0.3 });
      rect(c, { name: 'Progress', x: 18, y: fh - 18, w: (fw - 36) * 0.38, h: 5, r: 3, fill: C.accent });
    },
  })),
  { anchor: 'center', newRow: true, bool: { Watched: false, Progress: false, 'Progress track': false }, note: 'An episode still; focus adds the play mark.' });
example(s3, EPISODE, { state: 'rest' }, { image: { Art: SEV.episodes[0].still }, show: ['Watched'] }, 'In use', 'Watched on.');
const epText = (v, n) => cut(v.overview || v.description || '', n);
const EP_CAPTION = single(s3, 'Episode caption', 408, 136, (c) => {
  text(c, 'EPISODE 3', { name: 'Number', size: 14, weight: 700, color: C.accent, ls: 1.2 });
  text(c, SEV.episodes[2].name, { name: 'Title', y: 24, w: 408, size: 21, weight: 700, lh: 28 });
  text(c, '31 Jan 2025 · 46 min', { name: 'Note', y: 58, size: 16, o: A.faint });
  text(c, epText(SEV.episodes[2], 96), { name: 'Description', y: 88, w: 408, size: 16, lh: 22, o: A.muted });
}, { text: { Number: 'EPISODE 3', Title: SEV.episodes[2].name, Note: '31 Jan 2025 · 46 min', Description: epText(SEV.episodes[2], 96) }, note: 'Number, name, date and the episode\'s own description, two lines at most.' });
const ROW_HEAD = single(s3, 'Row header', 520, 40, (c) => {
  hug(c, { w: 520, h: 40, gap: 16, justify: 'MIN' });
  text(c, 'Popular movies', { name: 'Title', size: 28, weight: 700 });
  text(c, 'Cinemeta', { name: 'Source', size: 17, weight: 600, o: A.faint });
}, { text: { Title: 'Popular movies', Source: 'Cinemeta' }, bool: { Source: true }, note: 'Over every row; Source names the Addon the row comes from.' });
finish(s3);

// ============ C4 Hero ============
const s4 = sheet(pageC, 4, 'C4 Hero', 'Hero',
  'Home opens on the rotating hero: five featured titles, one every few seconds, focus on Watch now. When focus moves down into the rows the hero switches to Following focus: it shows the focused card\'s title, the backdrop moves to the right and the rows slide up under it. Going back up returns to Rotating.');
const META = single(s4, 'Meta line', 720, 30, (c) => {
  hug(c, { h: 30, gap: 14, justify: 'MIN' });
  use(c, BADGE, { tone: 'imdb' }, { name: 'IMDb badge' });
  text(c, '8.6', { name: 'Rating', size: 19, weight: 700 });
  for (const [k, v] of [['Year', '2024'], ['Runtime', '2h 47min'], ['Genres', 'Action, Drama, Sci-Fi']]) {
    rect(c, { name: `Dot ${k}`, w: 4, h: 4, r: 2, o: 0.4 });
    text(c, v, { name: k, size: 19, o: A.muted });
  }
}, { text: { Rating: '8.6', Year: '2024', Runtime: '2h 47min', Genres: 'Action, Drama, Sci-Fi' } });
const metaOf = (t) => ({ Rating: String(t.imdbRating || '–'), Year: (t.releaseInfo || '').replace('–', '–  ').trim(), Runtime: t.runtime || '', Genres: (t.genres || []).slice(0, 3).join(', ') });
const HERO = variants(s4, 'Hero',
  ['rotating', 'following'].map((mode) => ({
    p: { mode },
    build(c) {
      const t = mode === 'rotating' ? DUNE : TLOU, x = 168;
      if (mode === 'rotating') {
        c.resize(1920, 880); c.fills = solid(C.canvas); c.clipsContent = true;
        image(c, t.background, { name: 'Backdrop', w: 1920, h: 880 });
        grad(c, { dir: 'left', w: 1300, h: 880, stops: [[0, 0.94], [0.45, 0.7], [1, 0]] });
        grad(c, { dir: 'bottom', y: 360, w: 1920, h: 522, stops: [[0, 1], [0.25, 0.92], [1, 0]] });
        logo(c, t.logo, { x, bottom: 290, maxW: 560, maxH: 180 });
        use(c, META, {}, { x, y: 318, text: metaOf(t) });
        text(c, cut(t.description, 170), { name: 'Synopsis', x, y: 366, w: 700, size: 22, lh: 34, o: A.muted });
        const b = row(c, { name: 'Actions', x, y: 508, h: 60, gap: 14 });
        use(b, BUTTON, { kind: 'primary', size: 'L', state: 'focus' });
        use(b, BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { text: { Label: 'Details' }, icon: { Icon: 'info' } });
        use(c, TICKS, { active: '1' }, { x: 1720, y: 590 });
      } else {
        c.resize(1920, 810); c.fills = solid(C.canvas); c.clipsContent = true;
        image(c, t.background, { name: 'Backdrop', x: 480, w: 1440, h: 810 });
        grad(c, { dir: 'left', x: 480, w: 800, h: 810, stops: [[0, 1], [1, 0]] });
        grad(c, { dir: 'bottom', y: 360, w: 1920, h: 452, stops: [[0, 1], [0.12, 0.96], [1, 0]] });
        logo(c, t.logo, { x, bottom: 250, maxW: 520, maxH: 150 });
        use(c, META, {}, { x, y: 280, text: metaOf(t) });
        text(c, cut(t.description, 170), { name: 'Synopsis', x, y: 328, w: 680, size: 22, lh: 34, o: A.muted });
      }
    },
  })),
  { cols: 1, gap: 72, note: 'Rows start at y 636 under Rotating and at y 480 under Following.' });
finish(s4);

// ============ C5 Streams & panels ============
const s5 = sheet(pageC, 5, 'C5 Streams & panels', 'Streams & panels',
  'Panels slide over the screen they belong to. Rows inside a panel show focus as a lighter surface with a white outline, so a long list stays readable.');
const PANEL = variants(s5, 'Panel',
  ['side', 'floating'].map((placement) => ({
    p: { placement },
    build(c) {
      if (placement === 'side') {
        c.resize(936, 1032);
        look(c, { fill: C.surface, o: 0.9, r: 28, blur: 60, stroke: C.white, so: 0.08, clip: true, shadow: 30 });
        text(c, 'Streams', { name: 'Title', x: 44, y: 36, size: 36, weight: 800 });
        text(c, '4 from 2 Addons', { name: 'Subtitle', x: 44, y: 86, size: 17, o: A.faint });
        use(c, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 844, y: 40, icon: { Icon: 'x' } });
      } else {
        c.resize(840, 540);
        look(c, { fill: C.surface, o: 0.9, r: 24, blur: 50, stroke: C.white, so: 0.08, shadow: 24 });
      }
    },
  })),
  { text: { Title: 'Streams', Subtitle: '4 from 2 Addons' }, note: 'Side: the stream picker. Floating: player menus.' });
const GROUP = single(s5, 'Group label', 300, 20, (c) => {
  text(c, 'TORRENTIO', { name: 'Label', size: 14, weight: 800, o: A.faint, ls: 1.6 });
}, { text: { Label: 'TORRENTIO' }, newRow: true, note: 'Heads the Streams one Addon answered with.' });
const STREAM = variants(s5, 'Stream row',
  ['4K', 'HD'].flatMap((tier) => ['rest', 'focus'].map((state) => ({
    p: { tier, state },
    build(c) {
      const focus = state === 'focus';
      c.resize(848, 128);
      look(c, { fill: C.white, o: focus ? 0.14 : 0.055, r: 18, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
      const k = box(c, { name: 'Tier', x: 18, y: 18, w: 92, h: 92, r: 14, fill: tier === '4K' ? C.accent : C.surface3 });
      text(k, tier === '4K' ? '4K' : '1080p', { name: 'Quality', y: 30, w: 92, size: tier === '4K' ? 24 : 21, weight: 800, align: 'CENTER', color: tier === '4K' ? C.ink : C.white });
      text(c, 'Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.H.265', { name: 'Name', x: 132, y: 16, w: 620, size: 20, weight: 700 });
      const l2 = row(c, { name: 'Details', x: 132, y: 48, h: 24, gap: 7 });
      for (const [ic, v, n] of [['users', '214', 'Peers'], ['disk', '8.4 GB', 'Size'], ['globe', 'ThePirateBay', 'Source']]) {
        icon(l2, ic, { name: `${n} icon`, size: 18, o: 0.6 });
        text(l2, `${v}    `, { name: n, size: 16, o: A.muted });
      }
      const m = row(c, { name: 'Marks', x: 132, y: 82, h: 28, gap: 8 });
      use(m, BADGE, { tone: 'neutral' });
      use(m, BADGE, { tone: 'neutral' }, { text: { Label: 'ATMOS' } });
      use(m, BADGE, { tone: 'neutral' }, { text: { Label: 'HEVC' } });
      const go = box(c, { name: 'Play', x: 772, y: 36, w: 56, h: 56, r: 28, fill: C.white, o: focus ? 1 : 0.1 });
      icon(go, 'play', { size: 24, x: 17, y: 16, color: focus ? C.ink : C.white, filled: true });
    },
  }))),
  { cols: 2, gap: 40, text: { Name: 'Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.H.265', Peers: '214    ', Size: '8.4 GB    ', Source: 'ThePirateBay    ' }, newRow: true,
    note: 'One Stream. Tier is the resolution class; Marks are what the Stream\'s name declares (HDR, audio, codec).' });
const NOTICE = single(s5, 'Addon notice', 848, 76, (c) => {
  look(c, { fill: C.danger, o: 0.12, r: 18 });
  icon(c, 'triangle-alert', { size: 24, x: 24, y: 26, color: C.danger });
  text(c, 'MediaFusion did not answer', { name: 'Title', x: 64, y: 14, size: 18, weight: 700 });
  text(c, 'addon_unreachable', { name: 'Reason', x: 64, y: 42, size: 15, o: A.faint });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 680, y: 14, text: { Label: 'Try again' }, icon: { Icon: 'arrow-clockwise' } });
}, { text: { Title: 'MediaFusion did not answer', Reason: 'addon_unreachable' }, newRow: true, note: 'An Addon that failed, inside the list, with its reason.' });
const TRACK = variants(s5, 'Track option',
  ['off', 'on'].flatMap((selected) => ['rest', 'focus'].map((state) => ({
    p: { selected, state },
    build(c) {
      const focus = state === 'focus', on = selected === 'on';
      c.resize(372, 64);
      look(c, { fill: C.white, o: focus ? 0.14 : 0, r: 14, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
      text(c, 'Português (Brasil)', { name: 'Title', x: 18, y: 8, size: 19, weight: on ? 800 : 500 });
      text(c, 'In the file · SRT', { name: 'Detail', x: 18, y: 35, size: 14, o: A.faint });
      if (on) icon(c, 'check', { name: 'Check', size: 24, x: 326, y: 20, color: C.accent, bold: true });
    },
  }))),
  { cols: 4, gap: 32, text: { Title: 'Português (Brasil)', Detail: 'In the file · SRT' }, newRow: true, note: 'Subtitle and audio choices. Selected carries the lavender check.' });
finish(s5);

// ============ C6 Player ============
const s6 = sheet(pageC, 6, 'C6 Player', 'Player',
  'The on-screen display over the picture. It fades in on any input and out after a few idle seconds; focus starts on play/pause.');
const PLAYER_TOP = single(s6, 'Player top bar', 1920, 200, (c) => {
  grad(c, { dir: 'top', w: 1920, h: 200, color: '#000000', stops: [[0, 0.82], [1, 0]] });
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { x: 64, y: 52, icon: { Icon: 'arrow-left' } });
  text(c, 'Severance', { name: 'Title', x: 144, y: 48, size: 28, weight: 800 });
  text(c, 'S2 E3 · Who Is Alive?', { name: 'Subtitle', x: 144, y: 86, size: 18, o: A.muted });
  const q = row(c, { name: 'Stream facts', x: 1504, y: 66, h: 28, gap: 8 });
  use(q, BADGE, { tone: 'neutral' }, { text: { Label: '4K' } });
  use(q, BADGE, { tone: 'neutral' });
  use(q, BADGE, { tone: 'neutral' }, { text: { Label: 'ATMOS' } });
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { x: 1800, y: 52, icon: { Icon: 'x' } });
}, { text: { Title: 'Severance', Subtitle: 'S2 E3 · Who Is Alive?' }, note: 'Title, episode and what the Stream plays (resolution, HDR, audio).' });
const SEEK = variants(s6, 'Seek bar',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus', h = focus ? 228 : 32, ty = h - 16, th = focus ? 12 : 8;
      c.resize(1792, h);
      text(c, '17:52', { name: 'Elapsed', y: ty - 14, size: 20, weight: 700 });
      text(c, '−30:41', { name: 'Remaining', x: 1720, y: ty - 14, size: 20, weight: 700, o: A.muted });
      rect(c, { name: 'Track', x: 96, y: ty - th / 2, w: 1600, h: th, r: th / 2, o: 0.22 });
      rect(c, { name: 'Buffered', x: 96, y: ty - th / 2, w: 920, h: th, r: th / 2, o: 0.3 });
      rect(c, { name: 'Played', x: 96, y: ty - th / 2, w: 590, h: th, r: th / 2, fill: C.accent });
      for (const cx of [266, 576, 916, 1236, 1496]) rect(c, { name: 'Chapter', x: cx, y: ty - th / 2, w: 4, h: th, fill: C.ink, o: 0.85 });
      const ph = focus ? 32 : 24;
      rect(c, { name: 'Playhead', x: 686 - ph / 2, y: ty - ph / 2, w: ph, h: ph, r: ph / 2, ...(focus ? { stroke: C.accent, sw: 4 } : {}) });
      if (focus) {
        const p = box(c, { name: 'Preview', x: 686 - 144, y: 0, w: 288, h: 162, r: 14, clip: true, stroke: C.white, sw: 3, sa: 'OUTSIDE', shadow: 16 });
        image(p, SEV.episodes[2].still, { w: 288, h: 162 });
        const tl = row(p, { name: 'Time', x: 104, y: 124, h: 28, px: 10, r: 8, fill: C.ink, o: 0.8 });
        text(tl, '17:52', { size: 15, weight: 700 });
      }
    },
  })),
  { cols: 1, gap: 40, anchor: 'bottom', newRow: true, note: 'Focused, the bar thickens and shows the frame under the playhead; chapters are ink ticks.' });
const CONTROLS = variants(s6, 'Player controls',
  ['play', 'menu', 'details', 'none', 'picture', 'list-video', 'episodes', 'gauge', 'chapters'].map((focus) => ({
    p: { focus },
    build(c) {
      c.resize(1792, 80);
      const left = row(c, { name: 'Volume', y: 12, h: 56, gap: 16 });
      use(left, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { icon: { Icon: 'volume-2' } });
      const v = box(left, { name: 'Level', w: 160, h: 6, r: 3, fill: C.white, o: 0.22, clip: true });
      rect(v, { w: 112, h: 6, r: 3 });
      const mid = row(c, { name: 'Transport', x: 736, h: 80, gap: 28 });
      use(mid, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { icon: { Icon: 'rotate-ccw' } });
      use(mid, ICON_BUTTON, { kind: 'secondary', size: 'XL', state: focus === 'play' ? 'focus' : 'rest' }, { name: 'Play/pause', icon: { Icon: ['pause', { filled: true }] } });
      use(mid, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { icon: { Icon: 'rotate-cw' } });
      use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 1086, y: 16, text: { Label: 'Next episode' }, icon: { Icon: ['skip-forward', { filled: true }] } });
      const right = row(c, { name: 'Menus', x: 1274, y: 12, w: 518, h: 56, gap: 10, justify: 'MAX' });
      for (const ic of ['picture', 'captions', 'list-video', 'episodes', 'gauge', 'chapters', 'stats', 'maximize']) {
        const on = (focus === 'menu' && ic === 'captions') || (focus === 'details' && ic === 'stats') || focus === ic;
        use(right, ICON_BUTTON, { kind: 'ghost', size: 'L', state: on ? 'focus' : 'rest' }, { name: `Menu/${ic}`, icon: { Icon: ic } });
      }
    },
  })),
  { cols: 1, gap: 40, newRow: true, note: 'Volume, transport, next episode, and the menus: picture, subtitles & audio, streams, episodes, speed, chapters, details, full screen.' });
const UP_NEXT = single(s6, 'Up next card', 560, 372, (c) => {
  look(c, { fill: C.surface, o: 0.92, r: 24, blur: 50, stroke: C.white, so: 0.08, shadow: 30, clip: true });
  image(c, SEV.episodes[3].still, { w: 560, h: 220 });
  grad(c, { dir: 'bottom', y: 100, w: 560, h: 120, color: C.surface, stops: [[0, 1], [1, 0]] });
  text(c, 'UP NEXT IN 8', { name: 'Countdown label', x: 28, y: 182, size: 15, weight: 800, color: C.accent, ls: 1.4 });
  text(c, `S2 E4 · ${SEV.episodes[3].name}`, { name: 'Title', x: 28, y: 212, size: 26, weight: 800 });
  const b = row(c, { name: 'Actions', x: 28, y: 278, h: 60, gap: 14 });
  use(b, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { text: { Label: 'Play now' } });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'focus' }, { text: { Label: 'Cancel' }, hide: ['Icon'] });
  rect(c, { name: 'Countdown', y: 366, w: 336, h: 6, fill: C.accent });
}, { text: { Title: `S2 E4 · ${SEV.episodes[3].name}` }, newRow: true, note: 'Near the end of an episode; plays the next one when the bar runs out.' });

const SPINNER = single(s6, 'Spinner', 72, 72, (c) => {
  // the track and a third of a turn, as outlined ring shapes: SVG imported and stored
  const shape = (name, d, fill, o) => {
    const g = figma.createNodeFromSvg(`<svg width="72" height="72" viewBox="0 0 72 72"><path d="${d}" fill="${fill}" fill-opacity="${o}"/></svg>`);
    g.fills = []; g.name = name;
    g.children.forEach(storeOutline);
    c.appendChild(g);
  };
  shape('Track', 'M36 0 A36 36 0 0 1 36 72 A36 36 0 0 1 36 0 Z M36 6 A30 30 0 0 0 36 66 A30 30 0 0 0 36 6 Z', C.white, 0.18);
  shape('Arc', 'M36 0 A36 36 0 0 1 67.177 54 L61.981 51 A30 30 0 0 0 36 6 Z', C.accent, 1);
}, { newRow: true, note: 'All a Stream opening or Stalled shows over the picture; the Details menu says why.' });
const STAT = single(s6, 'Stat row', 352, 40, (c) => {
  text(c, 'Bitrate', { name: 'Label', y: 8, size: 17, o: A.muted });
  text(c, '38.4 Mb/s', { name: 'Value', y: 8, w: 352, size: 17, weight: 700, align: 'RIGHT' });
  rect(c, { name: 'Rule', y: 39, w: 352, h: 1, o: 0.08 });
}, { text: { Label: 'Bitrate', Value: '38.4 Mb/s' }, note: 'One line of the Details menu: the Torrent status and the Statistics.' });
const STEPPER = single(s6, 'Size stepper', 352, 48, (c) => {
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Smaller', icon: { Icon: 'minus' } });
  const k = (1.15 - 0.25) / 2.75;
  rect(c, { name: 'Track', x: 60, y: 21, w: 172, h: 6, r: 3, o: 0.22 });
  rect(c, { name: 'Level', x: 60, y: 21, w: 172 * k, h: 6, r: 3, fill: C.accent });
  rect(c, { name: 'Knob', x: 60 + 172 * k - 9, y: 15, w: 18, h: 18, r: 9 });
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 244, name: 'Larger', icon: { Icon: 'plus' } });
  const v = text(c, '115%', { name: 'Value', y: 13, size: 17, weight: 800 });
  v.x = 352 - v.width;
}, { text: { Value: '115%' }, newRow: true, note: 'Subtitle size, from 25% to 300% in steps of 5%: fine enough for any subtitle.' });
const SYNC = single(s6, 'Sync control', 352, 48, (c) => {
  hug(c, { h: 48, gap: 8, justify: 'MIN' });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: '−0.1 s' }, hide: ['Icon'], edit: (n) => { n.paddingLeft = n.paddingRight = 14; } });
  text(c, '+0.3 s', { name: 'Value', size: 17, weight: 800 });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: '+0.1 s' }, hide: ['Icon'], edit: (n) => { n.paddingLeft = n.paddingRight = 14; } });
  use(c, BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { text: { Label: 'Reset' }, hide: ['Icon'], edit: (n) => { n.paddingLeft = n.paddingRight = 12; } });
}, { note: 'Subtitle delay, a tenth of a second at a time.' });
const OPENING = variants(s6, 'Opening',
  ['logo', 'name'].map((kind) => ({
    p: { kind },
    build(c) {
      c.resize(640, 240);
      if (kind === 'logo') {
        const { w, h } = logoBox(SEV.logo, 600, 200), x = (640 - w) / 2, y = (240 - h) / 2;
        const dim = image(c, SEV.logo, { name: 'Logo dim', mode: 'FIT', x, y, w, h });
        dim.opacity = 0.22;
        const f = box(c, { name: 'Fill', x, y, w: Math.round(w * 0.45), h, clip: true });
        image(f, SEV.logo, { name: 'Logo', mode: 'FIT', w, h });
      } else {
        text(c, 'Severance', { name: 'Name', y: 64, w: 640, size: 64, weight: 800, align: 'CENTER' });
        rect(c, { name: 'Track', x: 140, y: 168, w: 360, h: 6, r: 3, o: 0.22 });
        rect(c, { name: 'Progress', x: 140, y: 168, w: 360 * 0.45, h: 6, r: 3, fill: C.accent });
      }
    },
  })),
  { cols: 1, gap: 40, newRow: true, note: 'While a Stream opens: the Title\'s logo fills in, its dim copy showing what is left; with no logo, the name over a bar.' });
const STILL = single(s6, 'Still watching card', 560, 288, (c) => {
  look(c, { fill: C.surface, o: 0.92, r: 24, blur: 50, stroke: C.white, so: 0.08, shadow: 30 });
  text(c, 'THREE EPISODES IN A ROW', { name: 'Overline', x: 28, y: 30, size: 15, weight: 800, color: C.accent, ls: 1.4 });
  text(c, 'Still watching?', { name: 'Title', x: 28, y: 60, size: 34, weight: 800 });
  text(c, `Next: S2 E5 · ${SEV.episodes[4].name}`, { name: 'Next', x: 28, y: 110, size: 18, o: A.muted });
  const b = row(c, { name: 'Actions', x: 28, y: 186, h: 60, gap: 14 });
  use(b, BUTTON, { kind: 'primary', size: 'L', state: 'focus' }, { text: { Label: 'Keep watching' } });
  use(b, BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { text: { Label: 'Stop' }, icon: { Icon: ['stop', { filled: true }] } });
}, { text: { Next: `Next: S2 E5 · ${SEV.episodes[4].name}` }, note: 'Autoplay holds here after three episodes nobody touched; only Keep watching moves on.' });
finish(s6);

// ============ C7 Forms & states ============
const s7 = sheet(pageC, 7, 'C7 Forms & states', 'Forms & states',
  'Search, Settings, Addons and the empty and failed states use these.');
const SEARCH = variants(s7, 'Search field',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus';
      hug(c, { w: 880, h: 72, px: 26, gap: 16, justify: 'MIN' });
      look(c, focus ? { fill: C.white, r: 36, shadow: 16, shadowA: 0.4 } : { fill: C.white, o: 0.1, r: 36 });
      icon(c, 'search', { size: 26, color: focus ? C.ink : C.white, o: focus ? 1 : 0.7 });
      text(c, 'Search movies and series', { name: 'Query', size: 22, weight: 500, color: focus ? C.ink : C.white, o: focus ? 0.55 : 0.6 });
    },
  })),
  { cols: 1, gap: 32, text: { Query: 'Search movies and series' }, note: 'A typed query replaces the placeholder at full opacity.' });
const SWITCH = variants(s7, 'Switch',
  ['off', 'on'].map((value) => ({
    p: { value },
    build(c) {
      c.resize(60, 34);
      look(c, { fill: value === 'on' ? C.accent : C.white, o: value === 'on' ? 1 : 0.22, r: 17 });
      rect(c, { name: 'Knob', x: value === 'on' ? 30 : 4, y: 4, w: 26, h: 26, r: 13, fill: value === 'on' ? C.ink : C.white });
    },
  })),
  { note: 'On is lavender.' });
const LIST_ROW = variants(s7, 'List row',
  ['value', 'switch'].flatMap((trailing) => ['rest', 'focus'].map((state) => ({
    p: { trailing, state },
    build(c) {
      const focus = state === 'focus';
      c.resize(880, 76);
      look(c, { fill: C.white, o: focus ? 0.14 : 0.055, r: 18, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
      icon(c, 'captions', { name: 'Icon', size: 26, x: 24, y: 25, o: 0.8 });
      text(c, trailing === 'value' ? 'Subtitle language' : 'Play the next episode', { name: 'Label', x: 72, y: 24, size: 20, weight: 600 });
      if (trailing === 'value') {
        const r = row(c, { name: 'Trailing', x: 600, y: 18, w: 256, h: 40, gap: 8, justify: 'MAX' });
        text(r, 'Português (Brasil)', { name: 'Value', size: 18, o: A.muted });
        icon(r, 'caret-right', { size: 20, o: 0.6 });
      } else use(c, SWITCH, { value: 'on' }, { x: 796, y: 21 });
    },
  }))),
  { cols: 2, gap: 32, text: { Label: 'Subtitle language', Value: 'Português (Brasil)' }, newRow: true, note: 'Settings and Addon options. A value row opens a list; a switch row toggles.' });
const ADDON = variants(s7, 'Addon row',
  ['ok', 'failed'].flatMap((health) => ['rest', 'focus', 'moving'].map((state) => ({
    p: { health, state },
    build(c) {
      const focus = state === 'focus', moving = state === 'moving', ok = health === 'ok';
      c.resize(880, 112);
      look(c, moving ? { fill: C.accent, o: 0.14, r: 18, stroke: C.accent, sw: 3, shadow: 20 } : { fill: C.white, o: focus ? 0.14 : 0.055, r: 18, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
      const k = box(c, { name: 'Logo', x: 18, y: 18, w: 76, h: 76, r: 16, fill: C.surface3 });
      icon(k, 'puzzle', { size: 34, x: 21, y: 21, o: 0.8 });
      text(c, ok ? 'Torrentio' : 'MediaFusion', { name: 'Name', x: 116, y: 20, size: 21, weight: 700 });
      text(c, ok ? 'Streams · movies, series' : 'Streams · movies, series, tv', { name: 'Resources', x: 116, y: 50, size: 16, o: A.muted });
      if (ok) text(c, 'v0.0.15 · torrentio.strem.fun', { name: 'Origin', x: 116, y: 74, size: 14, o: A.faint });
      else {
        const b = use(c, BADGE, { tone: 'danger' }, { x: 116, y: 72 });
        b.name = 'State';
      }
      if (moving) {
        icon(c, 'handle', { name: 'Handle', size: 28, x: 836, y: 42, color: C.accent });
        text(c, 'Up and down to move · OK to place', { name: 'Hint', x: 520, y: 44, w: 300, size: 16, weight: 700, color: C.accent, align: 'RIGHT' });
        return;
      }
      if (focus) {
        const a = row(c, { name: 'Actions', x: 520, y: 32, h: 48, gap: 8 });
        use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Details', icon: { Icon: 'info' } });
        use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Move up', icon: { Icon: 'arrow-up' } });
        use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Move down', icon: { Icon: 'arrow-down' } });
        use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Remove', icon: { Icon: 'trash' } });
      }
      use(c, SWITCH, { value: ok ? 'on' : 'off' }, { x: 796, y: 39 });
    },
  }))),
  { cols: 3, gap: 32, text: { Name: 'Torrentio', Resources: 'Streams · movies, series' }, newRow: true, note: 'An installed Addon: what it serves, where it lives, whether the Host reaches it. Focused, it offers details, move up, move down and remove; moving, it rides along until OK places it.' });
const DROPDOWN = variants(s7, 'Dropdown',
  ['rest', 'focus', 'open'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus', open = state === 'open';
      hug(c, { h: 46, px: 20, gap: 8 });
      look(c, focus ? { fill: C.white, r: 23, shadow: 12, shadowA: 0.4 } : open ? { fill: C.accent, o: 0.18, r: 23, stroke: C.accent, sw: 2 } : { fill: C.white, o: 0.1, r: 23 });
      const ink = focus ? C.ink : C.white;
      text(c, 'Genre', { name: 'Label', size: 16, weight: 600, color: ink, o: focus ? 0.6 : 0.6 });
      text(c, 'All genres', { name: 'Value', size: 18, weight: 700, color: open ? C.accent : ink });
      icon(c, 'caret-down', { name: 'Caret', size: 18, color: open ? C.accent : ink });
    },
  })),
  { cols: 3, gap: 40, text: { Label: 'Genre', Value: 'All genres' }, bool: { Label: true }, newRow: true, note: 'A filter that holds one value; open, its menu drops under it.' });
const DROP_MENU = single(s7, 'Dropdown menu', 300, 8 * 52 + 16, (c) => {
  look(c, { fill: C.surface, o: 0.97, r: 20, blur: 40, stroke: C.white, so: 0.08, shadow: 24 });
  ['All genres', 'Action', 'Adventure', 'Animation', 'Comedy', 'Drama', 'Sci-Fi', 'Thriller'].forEach((g, i) => {
    const on = i === 0, focus = i === 6;
    const r = box(c, { name: `Option/${g}`, x: 8, y: 8 + i * 52, w: 284, h: 48, r: 12, ...(focus ? { fill: C.white } : {}) });
    text(r, g, { name: 'Label', x: 16, y: 13, size: 17, weight: on || focus ? 700 : 500, color: focus ? C.ink : C.white });
    if (on) icon(r, 'check', { size: 20, x: 248, y: 14, color: C.accent, bold: true });
  });
}, { note: 'Selected carries the lavender check; focus is white.' });
const RANKED = variants(s7, 'Ranked row',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus';
      c.resize(880, 72);
      look(c, { fill: C.white, o: focus ? 0.14 : 0.055, r: 18, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
      const k = box(c, { name: 'Badge', x: 18, y: 16, w: 40, h: 40, r: 20, fill: C.accent });
      text(k, '1', { name: 'Rank', y: 8, w: 40, size: 18, weight: 800, color: C.ink, align: 'CENTER' });
      text(c, 'Português (Brasil)', { name: 'Label', x: 76, y: 22, size: 20, weight: 700 });
      const a = row(c, { name: 'Actions', x: 676, y: 12, h: 48, gap: 8 });
      use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Up', icon: { Icon: 'arrow-up' } });
      use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Down', icon: { Icon: 'arrow-down' } });
      use(a, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { name: 'Remove', icon: { Icon: 'x' } });
    },
  })),
  { cols: 1, gap: 24, text: { Label: 'Português (Brasil)' }, newRow: true, note: 'One of up to three languages, in the order the Host tries them.' });
const CONFIRM = single(s7, 'Confirm', 640, 300, (c) => {
  look(c, { fill: C.surface, o: 0.97, r: 28, blur: 50, stroke: C.white, so: 0.08, shadow: 30 });
  text(c, 'Remove MediaFusion?', { name: 'Title', x: 40, y: 40, size: 30, weight: 800 });
  text(c, 'Its Streams stop showing on every client. You can install it again from its URL.', { name: 'Body', x: 40, y: 92, w: 560, size: 18, lh: 27, o: A.muted });
  const b = row(c, { name: 'Actions', x: 40, y: 200, h: 60, gap: 14 });
  use(b, BUTTON, { kind: 'danger', size: 'L', state: 'rest' }, { text: { Label: 'Remove' }, icon: { Icon: 'trash' } });
  use(b, BUTTON, { kind: 'secondary', size: 'L', state: 'focus' }, { text: { Label: 'Cancel' }, hide: ['Icon'] });
}, { text: { Title: 'Remove MediaFusion?', Body: 'Its Streams stop showing on every client. You can install it again from its URL.' }, note: 'A Level that asks before anything is removed; focus starts on Cancel.' });
const EMPTY = single(s7, 'Empty state', 640, 360, (c) => {
  const k = box(c, { name: 'Glyph', x: 280, y: 0, w: 80, h: 80, r: 40, fill: C.white, o: 0.08 });
  icon(k, 'film', { size: 38, x: 21, y: 21, o: 0.8 });
  text(c, 'Nothing in your Library yet', { name: 'Title', y: 108, w: 640, size: 30, weight: 800, align: 'CENTER' });
  text(c, 'Titles you add or start watching show up here.', { name: 'Body', y: 156, w: 640, size: 20, lh: 30, o: A.muted, align: 'CENTER' });
  const b = row(c, { name: 'Action', x: 0, y: 228, w: 640, h: 60, gap: 0 });
  use(b, BUTTON, { kind: 'primary', size: 'L', state: 'focus' }, { text: { Label: 'Go to Discover' }, icon: { Icon: 'compass' } });
}, { text: { Title: 'Nothing in your Library yet', Body: 'Titles you add or start watching show up here.' }, newRow: true, note: 'Empty lists and failures that leave a screen with nothing to show.' });

const SCREEN_TITLE = single(s7, 'Screen title', 880, 84, (c) => {
  text(c, 'Discover', { name: 'Title', size: 44, weight: 800 });
  text(c, 'From TMDB', { name: 'Subtitle', y: 60, size: 18, o: A.muted });
}, { text: { Title: 'Discover', Subtitle: 'From TMDB' }, bool: { Subtitle: true }, newRow: true, note: 'Heads a destination; the subtitle says where its Titles come from.' });
const FIELD = variants(s7, 'Text field',
  ['rest', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      const focus = state === 'focus';
      c.resize(880, 104);
      text(c, 'Install an Addon', { name: 'Label', size: 16, weight: 700, o: A.muted });
      const f = box(c, { name: 'Field', y: 30, w: 880, h: 72, r: 18, fill: C.white, o: focus ? 1 : 0.08, ...(focus ? { shadow: 16, shadowA: 0.4 } : { stroke: C.white, so: 0.12 }) });
      text(f, 'Paste a manifest URL', { name: 'Value', x: 24, y: 23, size: 20, color: focus ? C.ink : C.white, o: 0.55 });
    },
  })),
  { cols: 1, gap: 32, text: { Label: 'Install an Addon', Value: 'Paste a manifest URL' }, note: 'A labelled input: a manifest URL, the TMDB key.' });
const CATEGORY = variants(s7, 'Category item',
  ['rest', 'active', 'focus'].map((state) => ({
    p: { state },
    build(c) {
      hug(c, { w: 360, h: 60, px: 24, gap: 14, justify: 'MIN' });
      look(c, state === 'focus' ? { fill: C.white, r: 30, shadow: 12, shadowA: 0.4 } : state === 'active' ? { fill: C.accent, o: 0.16, r: 30 } : { r: 30 });
      text(c, 'Preferences', { name: 'Label', size: 20, weight: 700, color: state === 'focus' ? C.ink : state === 'active' ? C.accent : C.white, o: state === 'rest' ? 0.72 : 1 });
    },
  })),
  { cols: 1, gap: 24, text: { Label: 'Preferences' }, note: 'The four Settings categories.' });
const DEVICE = single(s7, 'Device row', 880, 88, (c) => {
  look(c, { fill: C.white, o: 0.055, r: 18 });
  const k = box(c, { name: 'Glyph', x: 16, y: 16, w: 56, h: 56, r: 14, fill: C.surface3 });
  icon(k, 'device', { size: 28, x: 14, y: 14, o: 0.85 });
  text(c, 'Living-room phone', { name: 'Name', x: 92, y: 17, size: 20, weight: 700 });
  text(c, 'Paired 12 Nov 2026 · connected now', { name: 'Detail', x: 92, y: 48, size: 15, o: A.muted });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 762, y: 20, text: { Label: 'Revoke' }, hide: ['Icon'] });
}, { text: { Name: 'Living-room phone', Detail: 'Paired 12 Nov 2026 · connected now' }, newRow: true, note: 'One paired Device; revoking it stops it working and touches no other.' });
const PAIRING = single(s7, 'Pairing code', 880, 196, (c) => {
  look(c, { fill: C.white, o: 0.055, r: 24 });
  text(c, 'PAIRING CODE', { name: 'Overline', x: 32, y: 28, size: 14, weight: 800, o: A.faint, ls: 1.6 });
  const r = row(c, { name: 'Code', x: 32, y: 64, h: 84, gap: 12 });
  for (const ch of 'K7QX4M') {
    const b = box(r, { name: 'Cell', w: 64, h: 84, r: 14, fill: C.surface3 });
    text(b, ch, { name: 'Char', y: 18, w: 64, size: 40, weight: 800, align: 'CENTER' });
  }
  text(c, 'On the phone, open', { name: 'Hint', x: 540, y: 60, size: 16, o: A.muted });
  text(c, 'http://192.168.0.12:7878', { name: 'Address', x: 540, y: 86, size: 22, weight: 700, color: C.accent });
  text(c, 'and type this code. It works once, then changes.', { name: 'Note', x: 540, y: 122, w: 310, size: 15, o: A.faint });
}, { note: 'What a phone needs to pair: the address and the single-use code.' });
finish(s7);

// ============ C8 Remote (phone) ============
// The served Remote client at hand scale: the window's tokens and icons, 44 px
// targets, a pressed state instead of focus, and the surfaces only a phone has.
const s8 = sheet(pageC, 8, 'C8 Remote (phone)', 'Remote (phone)',
  'The Remote client in a phone: the same colours, type and icons at hand scale. Targets are at least 44 px; a finger gets a pressed state, not focus. The bottom index holds the six destinations; the strip over it shows what the Host is playing and opens the full remote.');
const PW = 390, PH_ = 844, G = 16; // phone width, height, gutter
const STATUS = single(s8, 'Status bar', PW, 47, (c) => {
  text(c, '21:42', { name: 'Time', x: 34, y: 15, size: 16, weight: 700 });
  const r = row(c, { name: 'Glyphs', x: 290, y: 16, h: 18, gap: 6 });
  icon(r, 'signal', { size: 17, filled: true });
  icon(r, 'wifi', { size: 17, filled: true });
  icon(r, 'battery', { size: 22, filled: true });
}, { note: 'Over every screen.' });
const TAB_ITEM = variants(s8, 'Tab item',
  ['rest', 'active', 'pressed'].map((state) => ({
    p: { state },
    build(c) {
      const on = state === 'active';
      c.resize(65, 64);
      if (on) rect(c, { name: 'Indicator', x: 6.5, y: 6, w: 52, h: 30, r: 15, fill: C.accent, o: 0.18 });
      if (state === 'pressed') rect(c, { name: 'Press', x: 6.5, y: 6, w: 52, h: 30, r: 15, fill: C.white, o: 0.12 });
      icon(c, 'house', { size: 24, x: 20.5, y: 9, color: on ? C.accent : C.white, o: on ? 1 : 0.62, filled: on });
      text(c, 'Home', { name: 'Label', y: 41, w: 65, size: 11, weight: on ? 800 : 600, align: 'CENTER', color: on ? C.accent : C.white, o: on ? 1 : 0.62 });
    },
  })),
  { text: { Label: 'Home' }, note: 'Active is lavender, with a pill behind the glyph.' });
const TAB_BAR = variants(s8, 'Tab bar',
  NAV.map(([, label]) => ({
    p: { active: label },
    build(c) {
      c.resize(PW, 98);
      look(c, { fill: C.surface, o: 0.94, blur: 30 });
      rect(c, { name: 'Hairline', w: PW, h: 1, o: 0.08 });
      NAV.forEach(([ic, l], i) => {
        const on = l === label;
        use(c, TAB_ITEM, { state: on ? 'active' : 'rest' }, { x: i * 65, y: 2, name: `Tab/${l}`, icon: { Icon: [ic, { filled: on }] }, ...(l !== 'Home' ? { text: { Label: l } } : {}) });
      });
      rect(c, { name: 'Home indicator', x: (PW - 134) / 2, y: 98 - 13, w: 134, h: 5, r: 3 });
    },
  })),
  { cols: 2, gap: 32, newRow: true, note: 'The six destinations; Remote devices is a Settings leaf, not a seventh. Includes the home-indicator safe area.' });
const STRIP = variants(s8, 'Now playing strip',
  ['on', 'off'].map((playing) => ({
    p: { playing },
    build(c) {
      c.resize(PW - 16, 64);
      look(c, { fill: C.surface3, o: 0.94, r: 16, blur: 30, clip: true, shadow: 12, shadowA: 0.4 });
      image(c, SEV.poster, { name: 'Poster', x: 10, y: 5, w: 36, h: 54, r: 6 });
      text(c, 'Severance', { name: 'Title', x: 60, y: 12, size: 15, weight: 700 });
      text(c, 'S2 E3 · 31 min left', { name: 'Note', x: 60, y: 33, size: 13, o: A.faint });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: 262, y: 8, name: 'Back 10s', icon: { Icon: 'rotate-ccw' } });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: 314, y: 8, name: 'Play/pause', icon: { Icon: [playing === 'on' ? 'pause' : 'play', { filled: true }] } });
      rect(c, { name: 'Track', y: 62, w: PW - 16, h: 2, o: 0.16 });
      rect(c, { name: 'Progress', y: 62, w: (PW - 16) * 0.38, h: 2, fill: C.accent });
    },
  })),
  { text: { Title: 'Severance', Note: 'S2 E3 · 31 min left' }, note: 'What the Host plays, over the index. A tap opens the full remote.' });
const P_HERO = single(s8, 'Hero · phone', PW, 520, (c) => {
  c.fills = solid(C.canvas); c.clipsContent = true;
  image(c, DUNE.background, { name: 'Backdrop', w: PW, h: 520 });
  grad(c, { dir: 'top', w: PW, h: 150, stops: [[0, 0.75], [1, 0]] });
  grad(c, { dir: 'bottom', y: 190, w: PW, h: 332, stops: [[0, 1], [0.4, 0.86], [1, 0]] });
  const { w, h } = logoBox(DUNE.logo, 250, 92);
  image(c, DUNE.logo, { name: 'Logo', mode: 'FIT', x: (PW - w) / 2, y: 340 - h, w, h });
  text(c, 'IMDb 8.4  ·  2024  ·  167 min  ·  Action, Drama', { name: 'Facts', y: 354, w: PW, size: 14, weight: 600, o: A.muted, align: 'CENTER' });
  const b = row(c, { name: 'Actions', x: G, y: 394, w: PW - 2 * G, h: 48, gap: 12 });
  use(b, BUTTON, { kind: 'primary', size: 'M', state: 'rest' });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: 'Details' }, icon: { Icon: 'info' } });
  use(c, TICKS, { active: '1' }, { x: (PW - 108) / 2, y: 466 });
}, { text: { Facts: 'IMDb 8.4  ·  2024  ·  167 min  ·  Action, Drama' }, newRow: true, note: 'The featured titles, one at a time: swipe sideways or wait. There is no focus to follow on a phone.' });
const P_POSTER = variants(s8, 'Poster · phone',
  ['rest', 'pressed'].map((state) => ({
    p: { state },
    build(c) {
      c.resize(116, 174);
      look(c, { fill: C.surface2, r: 12, clip: true });
      image(c, MOVIES[3].poster, { w: 116, h: 174 });
      if (state === 'pressed') rect(c, { name: 'Press', w: 116, h: 174, fill: C.ink, o: 0.35 });
    },
  })),
  { note: 'A pressed card darkens under the finger.' });
const P_WIDE = variants(s8, 'Wide card · phone',
  ['rest', 'pressed'].map((state) => ({
    p: { state },
    build(c) {
      c.resize(264, 149);
      look(c, { fill: C.surface2, r: 14, clip: true });
      image(c, SPIDER.background, { w: 264, h: 149 });
      grad(c, { dir: 'bottom', y: 50, w: 264, h: 99, stops: [[0, 0.95], [1, 0]] });
      logo(c, SPIDER.logo, { x: 14, bottom: 128, maxW: 120, maxH: 44 });
      use(c, BADGE, { tone: 'accent' }, { x: 10, y: 10, name: 'Up next' });
      rect(c, { name: 'Progress track', x: 14, y: 139, w: 236, h: 3, r: 2, o: 0.28 });
      rect(c, { name: 'Progress', x: 14, y: 139, w: 236 * 0.4, h: 3, r: 2, fill: C.accent });
      if (state === 'pressed') rect(c, { name: 'Press', w: 264, h: 149, fill: C.ink, o: 0.35 });
    },
  })),
  { bool: { 'Up next': false }, note: 'Continue watching at hand scale.' });
const P_CAPTION = single(s8, 'Card caption · phone', 264, 42, (c) => {
  text(c, 'Spider-Man: Across the Spider-Verse', { name: 'Title', w: 264, size: 15, weight: 700, lh: 20 });
  text(c, '1 h 51 min left', { name: 'Note', y: 22, size: 13, o: A.faint });
}, { text: { Title: 'Spider-Man: Across the Spider-Verse', Note: '1 h 51 min left' } });
const P_ROW_HEAD = single(s8, 'Row header · phone', 358, 28, (c) => {
  hug(c, { w: 358, h: 28, gap: 10, justify: 'MIN' });
  text(c, 'Popular movies', { name: 'Title', size: 20, weight: 800 });
  text(c, 'Cinemeta', { name: 'Source', size: 13, weight: 600, o: A.faint });
}, { text: { Title: 'Popular movies', Source: 'Cinemeta' }, bool: { Source: true } });
const P_SEEK = single(s8, 'Seek bar · phone', 358, 40, (c) => {
  rect(c, { name: 'Track', y: 6, w: 358, h: 6, r: 3, o: 0.22 });
  rect(c, { name: 'Buffered', y: 6, w: 210, h: 6, r: 3, o: 0.3 });
  rect(c, { name: 'Played', y: 6, w: 132, h: 6, r: 3, fill: C.accent });
  rect(c, { name: 'Playhead', x: 124, y: 1, w: 16, h: 16, r: 8 });
  text(c, '17:52', { name: 'Elapsed', y: 22, size: 13, weight: 700, o: A.muted });
  const r = text(c, '−30:41', { name: 'Remaining', y: 22, size: 13, weight: 700, o: A.muted });
  r.x = 358 - r.width;
}, { newRow: true, note: 'Drag the playhead; the Host seeks when the finger lifts.' });
const P_TRANSPORT = variants(s8, 'Transport · phone',
  ['on', 'off'].map((playing) => ({
    p: { playing },
    build(c) {
      hug(c, { w: 358, h: 80, gap: 0, justify: 'SPACE_BETWEEN' });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { name: 'Previous episode', icon: { Icon: ['skip-back', { filled: true }] } });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { name: 'Back 10s', icon: { Icon: 'rotate-ccw' } });
      use(c, ICON_BUTTON, { kind: 'primary', size: 'XL', state: 'rest' }, { name: 'Play/pause', icon: { Icon: [playing === 'on' ? 'pause' : 'play', { filled: true }] } });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { name: 'Forward 10s', icon: { Icon: 'rotate-cw' } });
      use(c, ICON_BUTTON, { kind: 'ghost', size: 'L', state: 'rest' }, { name: 'Next episode', icon: { Icon: ['skip-forward', { filled: true }] } });
    },
  })),
  { cols: 1, gap: 24, note: 'Previous and next episode, ten seconds either way, and play/pause in lavender.' });
const P_VOLUME = single(s8, 'Volume box', 358, 56, (c) => {
  look(c, { fill: C.white, o: 0.06, r: 16 });
  use(c, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: 4, y: 4, name: 'Mute', icon: { Icon: 'volume-2' } });
  rect(c, { name: 'Level track', x: 60, y: 25, w: 236, h: 6, r: 3, o: 0.22 });
  rect(c, { name: 'Level', x: 60, y: 25, w: 236 * 0.62, h: 6, r: 3 });
  rect(c, { name: 'Knob', x: 60 + 236 * 0.62 - 9, y: 19, w: 18, h: 18, r: 9 });
  text(c, '62', { name: 'Value', x: 312, y: 17, size: 16, weight: 700, o: A.muted });
}, { text: { Value: '62' }, note: 'Always on the remote: the Host\'s own volume, and mute.' });
const P_MENU = single(s8, 'Remote menus', 358, 76, (c) => {
  hug(c, { w: 358, h: 76, gap: 0, justify: 'SPACE_BETWEEN' });
  for (const [ic, label] of [['captions', 'Subtitles'], ['picture', 'Picture'], ['list-video', 'Streams'], ['episodes', 'Episodes'], ['gauge', 'Speed'], ['chapters', 'Chapters'], ['stats', 'Details']]) {
    const cell = box(c, { name: `Menu/${label}`, w: 51, h: 76 });
    const k = box(cell, { name: 'Disc', x: 3.5, y: 0, w: 44, h: 44, r: 22, fill: C.white, o: A.glass });
    icon(k, ic, { size: 22, x: 11, y: 11 });
    text(cell, label, { name: 'Label', y: 54, w: 51, size: 10.5, weight: 600, o: A.muted, align: 'CENTER' });
  }
}, { note: 'Seven menus; each opens the same bottom sheet.' });
const P_SWITCH_ROW = single(s8, 'Switch row · phone', 358, 52, (c) => {
  text(c, 'Play the next episode', { name: 'Label', y: 14, size: 16, weight: 600 });
  use(c, SWITCH, { value: 'on' }, { x: 298, y: 9 });
}, { text: { Label: 'Play the next episode' }, newRow: true, note: 'Autoplay, on the remote while an episode plays.' });
const P_SHEET = single(s8, 'Bottom sheet', PW, 640, (c) => {
  look(c, { fill: C.surface, o: 0.97, r: 28, blur: 40, stroke: C.white, so: 0.08, shadow: 30, clip: true });
  rect(c, { name: 'Grabber', x: (PW - 40) / 2, y: 10, w: 40, h: 5, r: 3, o: 0.3 });
  text(c, 'Audio & subtitles', { name: 'Title', x: G, y: 34, size: 22, weight: 800 });
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: PW - G - 48, y: 24, icon: { Icon: 'x' } });
}, { text: { Title: 'Audio & subtitles' }, note: 'The one drawer every remote menu opens; drag it down or close it.' });

const P_HEADER = single(s8, 'Header · phone', PW, 100, (c) => {
  look(c, { fill: C.canvas, o: 0.92, blur: 30 });
  rect(c, { name: 'Hairline', y: 99, w: PW, h: 1, o: 0.08 });
  use(c, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: 4, y: 48, name: 'Back', icon: { Icon: 'arrow-left' } });
  text(c, 'Streams', { name: 'Title', y: 52, w: PW, size: 17, weight: 800, align: 'CENTER' });
  text(c, 'Severance · S2 E3', { name: 'Subtitle', y: 74, w: PW, size: 12, o: A.faint, align: 'CENTER' });
}, { text: { Title: 'Streams', Subtitle: 'Severance · S2 E3' }, bool: { Subtitle: true }, newRow: true, note: 'A pushed level: Back and its name.' });
const P_STREAM = variants(s8, 'Stream row · phone',
  ['4K', 'HD'].map((tier) => ({
    p: { tier },
    build(c) {
      c.resize(358, 112);
      look(c, { fill: C.white, o: 0.055, r: 16 });
      const k = box(c, { name: 'Tier', x: 12, y: 12, w: 56, h: 56, r: 12, fill: tier === '4K' ? C.accent : C.surface3 });
      text(k, tier === '4K' ? '4K' : '1080p', { name: 'Quality', y: tier === '4K' ? 16 : 19, w: 56, size: tier === '4K' ? 18 : 14, weight: 800, align: 'CENTER', color: tier === '4K' ? C.ink : C.white });
      text(c, 'Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV', { name: 'Name', x: 80, y: 12, w: 266, size: 14, weight: 700, lh: 19 });
      text(c, '214 peers · 8.4 GB · ThePirateBay', { name: 'Details', x: 80, y: 52, w: 266, size: 12, o: A.muted });
      const m = row(c, { name: 'Marks', x: 80, y: 76, h: 28, gap: 6 });
      use(m, BADGE, { tone: 'neutral' });
      use(m, BADGE, { tone: 'neutral' }, { text: { Label: 'ATMOS' } });
    },
  })),
  { gap: 32, text: { Name: 'Severance.S02E03.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV', Details: '214 peers · 8.4 GB · ThePirateBay' }, note: 'A tap plays it on the Host.' });
const P_NOTICE = single(s8, 'Addon notice · phone', 358, 76, (c) => {
  look(c, { fill: C.danger, o: 0.12, r: 16 });
  icon(c, 'triangle-alert', { size: 22, x: 14, y: 27, color: C.danger });
  text(c, 'MediaFusion did not answer', { name: 'Title', x: 48, y: 16, size: 15, weight: 700 });
  text(c, 'addon_unreachable', { name: 'Reason', x: 48, y: 40, size: 13, o: A.faint });
  use(c, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 298, y: 14, name: 'Try again', icon: { Icon: 'arrow-clockwise' } });
}, { text: { Title: 'MediaFusion did not answer', Reason: 'addon_unreachable' } });
const P_EPISODE = single(s8, 'Episode row · phone', 358, 122, (c) => {
  const k = box(c, { name: 'Still', w: 132, h: 74, r: 10, clip: true, fill: C.surface2 });
  image(k, SEV.episodes[2].still, { name: 'Art', w: 132, h: 74 });
  rect(k, { name: 'Progress track', x: 8, y: 64, w: 116, h: 3, r: 2, o: 0.3 });
  rect(k, { name: 'Progress', x: 8, y: 64, w: 116 * 0.38, h: 3, r: 2, fill: C.accent });
  text(c, 'E3 · 46 min', { name: 'Number', x: 146, y: 4, size: 12, weight: 800, color: C.accent, ls: 0.6 });
  text(c, SEV.episodes[2].name, { name: 'Title', x: 146, y: 22, w: 212, size: 15, weight: 700, lh: 20 });
  text(c, '31 Jan 2025', { name: 'Note', x: 146, y: 48, size: 12, o: A.faint });
  text(c, epText(SEV.episodes[2], 84), { name: 'Description', y: 82, w: 358, size: 13, lh: 18, o: A.muted });
}, { text: { Number: 'E3 · 46 min', Title: SEV.episodes[2].name, Note: '31 Jan 2025', Description: epText(SEV.episodes[2], 84) }, bool: { 'Progress track': true, Progress: true }, note: 'The Title page lists episodes as rows on a phone.' });
const P_LIST = single(s8, 'List row · phone', 358, 60, (c) => {
  look(c, { fill: C.white, o: 0.055, r: 14 });
  icon(c, 'captions', { name: 'Icon', size: 22, x: 14, y: 19, o: 0.8 });
  text(c, 'Subtitle languages', { name: 'Label', x: 48, y: 19, size: 16, weight: 600 });
  const r = row(c, { name: 'Trailing', x: 196, y: 16, w: 150, h: 28, gap: 6, justify: 'MAX' });
  text(r, 'Português, English', { name: 'Value', size: 14, o: A.muted });
  icon(r, 'caret-right', { size: 16, o: 0.6 });
}, { text: { Label: 'Subtitle languages', Value: 'Português, English' }, newRow: true, note: 'Settings at hand scale.' });
const P_ADDON = single(s8, 'Addon row · phone', 358, 76, (c) => {
  look(c, { fill: C.white, o: 0.055, r: 16 });
  const k = box(c, { name: 'Logo', x: 12, y: 14, w: 48, h: 48, r: 12, fill: C.surface3 });
  icon(k, 'puzzle', { size: 24, x: 12, y: 12, o: 0.8 });
  text(c, 'Torrentio', { name: 'Name', x: 72, y: 15, size: 16, weight: 700 });
  text(c, 'Streams · movies, series', { name: 'Resources', x: 72, y: 39, size: 13, o: A.muted });
  use(c, SWITCH, { value: 'on' }, { x: 286, y: 21, name: 'Enabled' });
}, { text: { Name: 'Torrentio', Resources: 'Streams · movies, series' } });
const P_CODE = single(s8, 'Code input · phone', 358, 64, (c) => {
  hug(c, { w: 358, h: 64, gap: 0, justify: 'SPACE_BETWEEN' });
  ['K', '7', 'Q', 'X', '', ''].forEach((ch, i) => {
    const b = box(c, { name: `Cell ${i + 1}`, w: 52, h: 64, r: 12, fill: C.white, o: i === 4 ? 1 : 0.08 });
    if (ch) text(b, ch, { name: 'Char', y: 14, w: 52, size: 28, weight: 800, align: 'CENTER' });
    else if (i === 4) rect(b, { name: 'Caret', x: 25, y: 18, w: 2, h: 28, fill: C.ink });
  });
}, { note: 'The six-character pairing code, typed once.' });
finish(s8);
iconHome.frame.resize(SHEET_W, 220 + Math.ceil(Object.keys(ICONS).length / 12) * 140 + 40);
lineUp(pageC);

// ============ Foundations ============
{
  const s = box(pageF, { name: '00 Foundations', w: 1920, h: 1080, fill: C.canvas, clip: true });
  text(s, 'Foundations', { x: 80, y: 56, size: 56, weight: 800 });
  text(s, 'Figtree · near-black canvas · white is focus · lavender is the primary action, progress and selection', { x: 80, y: 134, size: 20, o: A.muted });
  text(s, 'Colour', { x: 80, y: 206, size: 24, weight: 800 });
  [['canvas', C.canvas], ['surface', C.surface], ['surface 2', C.surface2], ['surface 3', C.surface3], ['white', C.white], ['accent', C.accent], ['imdb', C.imdb], ['ok', C.ok], ['warn', C.warn], ['danger', C.danger]].forEach(([n, h], i) => {
    rect(s, { x: 80 + i * 176, y: 250, w: 152, h: 104, r: 14, fill: h, stroke: C.white, so: 0.14 });
    text(s, n, { x: 80 + i * 176, y: 366, size: 16, weight: 700 });
    text(s, h, { x: 80 + i * 176, y: 390, size: 14, o: A.faint });
  });
  text(s, 'Type', { x: 80, y: 452, size: 24, weight: 800 });
  let y = 498;
  [['Display 56 / 800', 56, 800], ['Heading 36 / 800', 36, 800], ['Row head 28 / 700', 28, 700], ['Body 22 / 500', 22, 500], ['Label 18 / 700', 18, 700], ['Caption 16 / 500', 16, 500]].forEach(([n, size, weight]) => { text(s, n, { x: 80, y, size, weight }); y += size * 1.35 + 18; });
  text(s, 'Focus', { x: 760, y: 452, size: 24, weight: 800 });
  text(s, 'Controls turn white. Cards scale up with a white outline. Rows in a panel get a lighter surface and a white outline.', { x: 760, y: 490, w: 1080, size: 17, lh: 25, o: A.muted });
  const b = row(s, { name: 'Buttons', x: 760, y: 560, h: 60, gap: 20 });
  use(b, BUTTON, { kind: 'primary', size: 'L', state: 'rest' });
  use(b, BUTTON, { kind: 'primary', size: 'L', state: 'focus' });
  use(b, BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { text: { Label: 'Details' }, icon: { Icon: 'info' } });
  use(b, ICON_BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { icon: { Icon: 'x' } });
  const ch = row(s, { name: 'Chips', x: 760, y: 650, h: 46, gap: 14 });
  use(ch, CHIP, { selected: 'on', state: 'rest' });
  use(ch, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(ch, CHIP, { selected: 'off', state: 'focus' }, { text: { Label: 'Specials' } });
  text(s, 'Radius 6 badge · 14 tile · 16 card · 24 panel · 28 side panel · pills are fully round. Spacing on an 8 px grid; screen margin 168 with the rail, 72 without.', { x: 760, y: 740, w: 1080, size: 17, lh: 25, o: A.muted });
}
// ============ Screens: built from the components only ============
const pageS = figma.createPage();
pageS.name = 'Screens';
// one row per area: the window's screens, then the phone's beside them
function screen(name, row, col) {
  return box(pageS, { name, x: col * 2040, y: row * 1240, w: 1920, h: 1080, fill: C.canvas, clip: true });
}
const X = 168; // content margin beside the rail
function hero(s, mode, t) {
  const base = mode === 'rotating' ? DUNE : TLOU;
  if (t === base) return use(s, HERO, { mode });
  const [maxW, maxH] = mode === 'rotating' ? [560, 180] : [520, 150];
  return use(s, HERO, { mode }, { text: { Synopsis: cut(t.description, 170), ...metaOf(t) }, image: { Backdrop: t.background }, logo: { Logo: [t.logo, maxW, maxH] } });
}
const CONTINUE = [
  [SEV, { art: SEV.episodes[2].still, progress: 0.38, note: 'S2 E3 · 31 min left' }],
  [TLOU, { progress: 0.72, note: 'S2 E4 · 16 min left' }],
  [SPIDER, { progress: 0.21, note: '1 h 51 min left' }],
  [SERIES[1], { progress: 0, note: 'S1 E5 · Up next', upNext: true }],
  [MOVIES[1], { progress: 0.55, note: '1 h 02 min left' }],
];
function continueRow(s, y, focusAt = -1) {
  use(s, ROW_HEAD, {}, { x: X, y, text: { Title: 'Continue watching' }, hide: ['Source'] });
  CONTINUE.forEach(([t, o], i) => {
    const x = X + i * 440, cy = y + 56, focus = i === focusAt, fw = focus ? 428 : 400, fh = focus ? 241 : 225;
    use(s, WIDE, { state: focus ? 'focus' : 'rest' }, {
      x, y: cy,
      image: { Art: o.art || t.background },
      ...(o.art ? { hide: ['Logo'] } : { logo: { Logo: [t.logo, fw * 0.45, fh * 0.3] } }),
      show: o.upNext ? ['Up next'] : [],
      edit: (n) => { const p = layer(n, 'Progress'); if (o.progress) p.resize((fw - 40) * o.progress, 5); else p.visible = false; },
    });
    use(s, CAPTION, {}, { x, y: cy + 225 + (focus ? 22 : 14), text: { Title: t.name, Note: o.note } });
  });
}
function posterRow(s, y, title, list, focusAt = -1) {
  use(s, ROW_HEAD, {}, { x: X, y, text: { Title: title } });
  list.forEach((t, i) => use(s, POSTER, { state: i === focusAt ? 'focus' : 'rest' }, { x: X + i * 236, y: y + 60, image: { Art: t.poster } }));
}
{
  const s = screen('01 Home · rotating hero', 0, 0);
  hero(s, 'rotating', DUNE);
  continueRow(s, 636);
  posterRow(s, 1000, 'Popular movies', MOVIES.slice(0, 8));
  use(s, RAIL, { expanded: 'off' });
}
{
  const s = screen('02 Home · following focus', 0, 1);
  hero(s, 'following', TLOU);
  continueRow(s, 480, 1);
  posterRow(s, 870, 'Popular movies', MOVIES.slice(0, 8));
  use(s, RAIL, { expanded: 'off' });
}
{
  const s = screen('03 Home · following, further down', 0, 2);
  hero(s, 'following', MOVIES[5]);
  posterRow(s, 480, 'Popular movies', MOVIES.slice(0, 8), 5);
  posterRow(s, 906, 'Popular series', SERIES.slice(0, 8));
  use(s, RAIL, { expanded: 'off' });
}
{
  const s = screen('04 Home · rail open', 0, 3);
  hero(s, 'rotating', DUNE);
  continueRow(s, 636);
  posterRow(s, 1000, 'Popular movies', MOVIES.slice(0, 8));
  use(s, RAIL, { expanded: 'on' });
}

// ---------- shared screen pieces ----------
// a collapsed rail with another destination active; switching a nested variant in
// place fails in OpenPencil, so each item is replaced by a fresh instance
function railFor(s, active) {
  const r = detachDeep(use(s, RAIL, { expanded: 'off' }));
  r.name = `Nav rail · ${active}`;
  for (const [ic, label] of NAV) {
    const n = layer(r, `Nav/${label}`), on = label === active;
    // a fresh instance of the right variant in the old one's place
    use(r, NAV_ITEM, { expanded: 'off', state: on ? 'active' : 'rest' }, { x: n.x, y: n.y, name: n.name, icon: { Icon: [ic, { filled: on }] } });
    n.remove();
  }
  return r;
}
function titleBase(s, t) {
  image(s, t.background, { name: 'Backdrop', w: 1920, h: 1080 });
  grad(s, { dir: 'left', w: 1400, h: 1080, stops: [[0, 0.95], [0.45, 0.72], [1, 0]] });
  grad(s, { dir: 'bottom', y: 400, w: 1920, h: 680, stops: [[0, 1], [0.35, 0.9], [1, 0]] });
}
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// an auto-layout button stretched to a width
const stretch = (w) => (n) => { n.primaryAxisSizingMode = 'FIXED'; n.resize(w, n.height); };
function pHeader(s, title, sub) {
  return use(s, P_HEADER, {}, { text: { Title: title, ...(sub ? { Subtitle: sub } : {}) }, ...(sub ? {} : { hide: ['Subtitle'] }) });
}
function pLarge(s, title, sub) {
  const top = box(s, { name: 'Header', w: PW, h: sub ? 116 : 100, fill: C.canvas, o: 0.92, blur: 30 });
  rect(top, { name: 'Hairline', y: top.height - 1, w: PW, h: 1, o: 0.08 });
  text(top, title, { name: 'Title', x: G, y: 50, size: 28, weight: 800 });
  if (sub) text(top, sub, { name: 'Subtitle', x: G, y: 88, size: 13, o: A.faint });
  return top;
}

// ---------- Title & Streams ----------
{
  const s = screen('05 Title · series', 1, 0);
  titleBase(s, SEV);
  use(s, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: X, y: 48, name: 'Back', icon: { Icon: 'arrow-left' } });
  logo(s, SEV.logo, { x: X, bottom: 248, maxW: 640, maxH: 150 });
  use(s, META, {}, { x: X, y: 278, text: metaOf(SEV) });
  text(s, cut(SEV.description, 190), { name: 'Synopsis', x: X, y: 326, w: 760, size: 22, lh: 34, o: A.muted });
  const b = row(s, { name: 'Actions', x: X, y: 466, h: 60, gap: 14 });
  use(b, BUTTON, { kind: 'primary', size: 'L', state: 'focus' }, { text: { Label: 'Resume S2 E3' } });
  use(b, BUTTON, { kind: 'secondary', size: 'L', state: 'rest' }, { text: { Label: 'Choose stream' }, icon: { Icon: 'list-video' } });
  const seasons = row(s, { name: 'Seasons', x: X, y: 586, h: 46, gap: 12 });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(seasons, CHIP, { selected: 'on', state: 'rest' });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Specials' } });
  SEV.episodes.slice(0, 5).forEach((v, i) => {
    const x = X + i * 440;
    use(s, EPISODE, { state: 'rest' }, { x, y: 668, image: { Art: v.still }, show: i < 2 ? ['Watched'] : i === 2 ? ['Progress', 'Progress track'] : [] });
    use(s, EP_CAPTION, {}, { x, y: 912, text: { Number: `EPISODE ${v.episode}`, Title: v.name, Note: day(v.released), Description: epText(v, 96) } });
  });
  railFor(s, 'Home');
}
{
  const s = screen('06 Streams', 1, 1);
  titleBase(s, SEV);
  logo(s, SEV.logo, { x: 120, bottom: 560, maxW: 640, maxH: 170 });
  text(s, 'Season 2 · Episode 3', { x: 120, y: 596, size: 20, weight: 700, color: C.accent });
  text(s, SEV.episodes[2].name, { x: 120, y: 628, size: 44, weight: 800 });
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.ink, o: 0.3 });
  use(s, PANEL, { placement: 'side' }, { x: 960, y: 24 });
  const px = 1004;
  const f = row(s, { name: 'Addon filter', x: px, y: 150, h: 46, gap: 10 });
  use(f, CHIP, { selected: 'on', state: 'rest' }, { text: { Label: 'All' } });
  for (const a of ['Torrentio', 'Comet', 'MediaFusion']) use(f, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: a } });
  use(s, GROUP, {}, { x: px, y: 226 });
  use(s, STREAM, { tier: '4K', state: 'focus' }, { x: px, y: 256 });
  use(s, STREAM, { tier: '4K', state: 'rest' }, { x: px, y: 396, text: { Name: 'Severance.S02E03.2160p.WEB.h265-ETHEL', Peers: '97    ', Size: '6.1 GB    ', Source: '1337x    ' } });
  use(s, STREAM, { tier: 'HD', state: 'rest' }, { x: px, y: 536, text: { Name: 'Severance.S02E03.1080p.ATVP.WEB-DL.DDP5.1.H.264-FLUX', Peers: '532    ', Size: '3.9 GB    ', Source: 'EZTV    ' } });
  use(s, GROUP, {}, { x: px, y: 690, text: { Label: 'COMET' } });
  use(s, STREAM, { tier: 'HD', state: 'rest' }, { x: px, y: 720, text: { Name: 'Severance S02E03 Who Is Alive 1080p HEVC x265', Peers: '–    ', Size: '1.8 GB    ', Source: 'Comet · direct    ' } });
  use(s, NOTICE, {}, { x: px, y: 874 });
}

// ---------- Player ----------
function film(s, still = SEV.episodes[2].still) {
  image(s, still, { name: 'Picture', w: 1920, h: 1080 });
}
function osd(s, focus) {
  grad(s, { dir: 'bottom', y: 600, w: 1920, h: 480, color: '#000000', stops: [[0, 0.92], [0.5, 0.6], [1, 0]] });
  use(s, PLAYER_TOP);
  use(s, SEEK, { state: focus === 'seek' ? 'focus' : 'rest' }, { x: 64, y: 880 });
  use(s, CONTROLS, { focus: focus === 'seek' ? 'none' : focus }, { x: 64, y: 954 });
}
function trackAt(s, x, y, title, detail, selected, focus) {
  use(s, TRACK, { selected: selected ? 'on' : 'off', state: focus ? 'focus' : 'rest' }, {
    x, y, text: { Title: title, Detail: detail },
    edit: (n) => { if (!detail) { layer(n, 'Title').y = 18; layer(n, 'Detail').visible = false; } },
  });
}
{
  const s = screen('07 Player · controls', 2, 0);
  film(s); osd(s, 'play');
}
{
  const s = screen('08 Player · audio & subtitles', 2, 1);
  film(s); osd(s, 'menu');
  const px = 1016, py = 316;
  use(s, PANEL, { placement: 'floating' }, { x: px, y: py });
  text(s, 'Subtitles', { x: px + 44, y: py + 30, size: 24, weight: 800 });
  [['Off', ''], ['Português (Brasil)', 'In the file · SRT'], ['English', 'In the file · SRT'], ['English SDH', 'In the file · PGS'], ['Español', 'OpenSubtitles v3']]
    .forEach(([a, b], i) => trackAt(s, px + 32, py + 80 + i * 72, a, b, i === 1, i === 1));
  rect(s, { name: 'Rule', x: px + 420, y: py + 28, w: 1, h: 484, o: A.line });
  text(s, 'Audio', { x: px + 456, y: py + 30, size: 24, weight: 800 });
  [['English', 'Dolby Digital+ Atmos · 5.1'], ['Português (Brasil)', 'Dolby Digital+ · 5.1'], ['Español', 'AAC · 2.0']]
    .forEach(([a, b], i) => trackAt(s, px + 444, py + 80 + i * 72, a, b, i === 0, false));
  text(s, 'Sync', { x: px + 456, y: py + 316, size: 17, weight: 700, o: A.muted });
  use(s, SYNC, {}, { x: px + 456, y: py + 344 });
  text(s, 'Size', { x: px + 456, y: py + 408, size: 17, weight: 700, o: A.muted });
  use(s, STEPPER, {}, { x: px + 456, y: py + 436 });
}
{
  const s = screen('09 Player · seeking', 2, 2);
  film(s); osd(s, 'seek');
}
{
  const s = screen('10 Player · up next', 2, 3);
  film(s);
  grad(s, { dir: 'bottom', y: 500, w: 1920, h: 580, color: '#000000', stops: [[0, 0.85], [1, 0]] });
  use(s, UP_NEXT, {}, { x: 1296, y: 644 });
}
function statsColumn(s, x, y, head, rows) {
  text(s, head, { x, y, size: 24, weight: 800 });
  rows.forEach(([a, b], i) => use(s, STAT, {}, { x, y: y + 52 + i * 48, text: { Label: a, Value: b } }));
}
{
  const s = screen('11 Player · opening', 2, 4);
  image(s, SEV.background, { name: 'Backdrop', w: 1920, h: 1080 });
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.canvas, o: 0.82 });
  use(s, OPENING, { kind: 'logo' }, { x: 640, y: 380 });
  osd(s, 'play');
}
{
  const s = screen('11b Player · opening, no logo', 2, 5);
  image(s, SEV.background, { name: 'Backdrop', w: 1920, h: 1080 });
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.canvas, o: 0.82 });
  use(s, OPENING, { kind: 'name' }, { x: 640, y: 380 });
  osd(s, 'play');
}
{
  const s = screen('12 Player · stalled, details', 2, 6);
  film(s);
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: '#000000', o: 0.3 });
  use(s, SPINNER, {}, { x: 924, y: 468 });
  osd(s, 'details');
  const px = 1016, py = 316;
  use(s, PANEL, { placement: 'floating' }, { x: px, y: py });
  statsColumn(s, px + 44, py + 30, 'Torrent', [['State', 'Waiting for data'], ['Engine', 'Fetching'], ['Peers', '2 connected'], ['Speed', '120 kB/s']]);
  rect(s, { name: 'Rule', x: px + 420, y: py + 28, w: 1, h: 484, o: A.line });
  statsColumn(s, px + 444, py + 30, 'Playback', [['Picture', '3840×2160 · DV'], ['Bitrate', '38.4 Mb/s'], ['Decoder', 'Hardware · d3d11va'], ['Dropped frames', '0'], ['Buffered', '1.4 s ahead']]);
}
{
  const s = screen('13 Player · still watching?', 2, 7);
  film(s, SEV.episodes[3].still);
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: '#000000', o: 0.45 });
  use(s, STILL, {}, { x: 1296, y: 728 });
}

// ---------- Player menus, open ----------
function menuPanel(s, focus, w = 840, x = 1016) {
  film(s); osd(s, focus);
  use(s, PANEL, { placement: 'floating' }, { x, y: 316, edit: (n) => n.resize(w, 540) });
  return [x, 316];
}
const option = (s, x, y, title, detail, selected, focus) => trackAt(s, x, y, title, detail || '', selected, focus);
{
  const s = screen('08b Player · picture', 2, 8);
  const [px, py] = menuPanel(s, 'picture');
  text(s, 'Aspect', { x: px + 44, y: py + 30, size: 24, weight: 800 });
  ['Source', '16:9', '4:3', '21:9'].forEach((a, i) => option(s, px + 32, py + 80 + i * 72, a, i === 0 ? 'The shape the Stream carries' : '', i === 0, i === 0));
  rect(s, { name: 'Rule', x: px + 420, y: py + 28, w: 1, h: 484, o: A.line });
  text(s, 'Crop', { x: px + 456, y: py + 30, size: 24, weight: 800 });
  ['Full frame', '16:9', '4:3', '21:9'].forEach((a, i) => option(s, px + 444, py + 80 + i * 72, a, '', i === 0, false));
  use(s, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: px + 456, y: py + 384, text: { Label: 'Autocrop' }, icon: { Icon: 'maximize' } });
  text(s, 'Autocrop finds the black bars and keeps the picture inside them.', { x: px + 456, y: py + 446, w: 340, size: 15, lh: 21, o: A.faint });
}
{
  const s = screen('08c Player · speed', 2, 9);
  const [px, py] = menuPanel(s, 'gauge', 420, 1436);
  text(s, 'Playback speed', { x: px + 44, y: py + 30, size: 24, weight: 800 });
  ['0.5×', '0.75×', '1× · Normal', '1.25×', '1.5×', '2×'].forEach((a, i) => option(s, px + 24, py + 80 + i * 68, a, '', i === 2, i === 3));
}
{
  const s = screen('08d Player · chapters', 2, 10);
  const [px, py] = menuPanel(s, 'chapters');
  text(s, 'Chapters', { x: px + 44, y: py + 30, size: 24, weight: 800 });
  const b = row(s, { name: 'Step', x: px + 500, y: py + 24, h: 48, gap: 10 });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: 'Previous' }, icon: { Icon: ['skip-back', { filled: true }] } });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: 'Next' }, icon: { Icon: ['skip-forward', { filled: true }] } });
  [['Cold open', '0:00'], ['Lumon', '4:38'], ['Outie', '11:02'], ['The bowling alley', '17:15'], ['Reintegration', '24:50'], ['Wellness', '31:20'], ['The goats', '38:44'], ['Who is alive?', '44:10']]
    .forEach(([n, t], i) => option(s, px + 32 + (i >= 4 ? 412 : 0), py + 100 + (i % 4) * 72, `${i + 1} · ${n}`, t, i === 3, i === 4));
}
{
  const s = screen('08e Player · episodes', 2, 11);
  const [px, py] = menuPanel(s, 'episodes');
  text(s, 'Episodes', { x: px + 44, y: py + 30, size: 24, weight: 800 });
  const ch = row(s, { name: 'Seasons', x: px + 480, y: py + 24, h: 46, gap: 10 });
  use(ch, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(ch, CHIP, { selected: 'on', state: 'rest' });
  SEV.episodes.slice(1, 5).forEach((v, i) => {
    const playing = i === 1, focus = i === 2;
    const r = box(s, { name: `Episode/${v.episode}`, x: px + 32, y: py + 92 + i * 108, w: 776, h: 96, r: 16, fill: C.white, o: focus ? 0.14 : 0, ...(focus ? { stroke: C.white, sw: 3 } : {}) });
    const k = box(r, { name: 'Still', x: 12, y: 12, w: 128, h: 72, r: 10, clip: true, fill: C.surface2 });
    image(k, v.still, { w: 128, h: 72 });
    if (playing) { rect(k, { name: 'Progress', x: 8, y: 64, w: 112 * 0.38, h: 3, r: 2, fill: C.accent }); }
    text(r, `E${v.episode} · ${v.name}`, { name: 'Title', x: 160, y: 18, size: 19, weight: 700 });
    text(r, playing ? 'Playing now · 17:52 of 48:33' : `${day(v.released)} · ${epText(v, 60)}`, { name: 'Detail', x: 160, y: 48, w: 590, size: 15, o: playing ? 1 : A.faint, ...(playing ? { color: C.accent } : {}) });
  });
}
{
  const s = screen('08f Player · streams', 2, 12);
  film(s);
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.ink, o: 0.45 });
  use(s, PANEL, { placement: 'side' }, { x: 960, y: 24, text: { Title: 'Streams', Subtitle: 'Severance · S2 E3 · switching keeps your place' } });
  const px = 1004;
  use(s, GROUP, {}, { x: px, y: 150 });
  use(s, STREAM, { tier: '4K', state: 'rest' }, { x: px, y: 180, edit: (n) => { n.strokes = solid(C.accent); n.strokeWeight = 3; n.strokeAlign = 'INSIDE'; } });
  use(s, BADGE, { tone: 'accent' }, { x: px + 712, y: 266, text: { Label: 'PLAYING' } });
  use(s, STREAM, { tier: '4K', state: 'focus' }, { x: px, y: 320, text: { Name: 'Severance.S02E03.2160p.WEB.h265-ETHEL', Peers: '97    ', Size: '6.1 GB    ', Source: '1337x    ' } });
  use(s, STREAM, { tier: 'HD', state: 'rest' }, { x: px, y: 460, text: { Name: 'Severance.S02E03.1080p.ATVP.WEB-DL.DDP5.1.H.264-FLUX', Peers: '532    ', Size: '3.9 GB    ', Source: 'EZTV    ' } });
  use(s, GROUP, {}, { x: px, y: 614, text: { Label: 'COMET' } });
  use(s, STREAM, { tier: 'HD', state: 'rest' }, { x: px, y: 644, text: { Name: 'Severance S02E03 Who Is Alive 1080p HEVC x265', Peers: '–    ', Size: '1.8 GB    ', Source: 'Comet · direct    ' } });
}

// ---------- Discover, Search, Library ----------
function pageHead(s, title, sub) {
  use(s, SCREEN_TITLE, {}, { x: X, y: 56, text: { Title: title, ...(sub ? { Subtitle: sub } : {}) }, ...(sub ? {} : { hide: ['Subtitle'] }) });
}
function chips(parent, x, y, groups) {
  const f = row(parent, { name: 'Filters', x, y, h: 46, gap: 10 });
  groups.forEach((g, gi) => {
    if (gi) rect(f, { name: 'Divider', w: 1, h: 28, o: 0.2 });
    g.forEach(([label, on, focus]) => use(f, CHIP, { selected: on ? 'on' : 'off', state: focus ? 'focus' : 'rest' }, { text: { Label: label } }));
  });
  return f;
}
const GRID = [...MOVIES, ...SERIES];
function discoverFilters(s, genreState) {
  const f = row(s, { name: 'Filters', x: X, y: 176, h: 46, gap: 12 });
  use(f, DROPDOWN, { state: 'rest' }, { text: { Label: 'Type', Value: 'Movies' } });
  use(f, DROPDOWN, { state: genreState });
  use(f, DROPDOWN, { state: 'rest' }, { text: { Label: 'Sort', Value: 'Most popular' } });
  return f;
}
// a poster grid: 7 columns from the margin; `marks` sets progress and watched per index
function posterGrid(s, y, list, focusAt = -1, marks = {}) {
  list.forEach((t, i) => {
    const m = marks[i] || {};
    use(s, POSTER, { state: i === focusAt ? 'focus' : 'rest' }, {
      x: X + (i % 7) * 236, y: y + Math.floor(i / 7) * 352, image: { Art: t.poster },
      show: [...(m.progress ? ['Progress', 'Progress track'] : []), ...(m.watched ? ['Watched'] : [])],
      edit: (n) => { if (m.progress) layer(n, 'Progress').resize((n.width - 28) * m.progress, 5); },
    });
  });
}
const LIB = [SEV, TLOU, SPIDER, DUNE, SERIES[1], MOVIES[5], SERIES[6], MOVIES[3], SERIES[10], MOVIES[11], SERIES[2], MOVIES[0], SERIES[4], MOVIES[7]];
const LIB_MARKS = { 0: { progress: 0.38 }, 1: { progress: 0.72 }, 2: { progress: 0.21 }, 3: { watched: true }, 5: { watched: true }, 6: { progress: 0.5 }, 9: { watched: true } };
{
  const s = screen('14 Discover', 3, 0);
  pageHead(s, 'Discover', 'From TMDB');
  discoverFilters(s, 'rest');
  posterGrid(s, 262, GRID.slice(0, 21), 2);
  railFor(s, 'Discover');
}
{
  const s = screen('14b Discover · genre menu', 3, 1);
  pageHead(s, 'Discover', 'From TMDB');
  posterGrid(s, 262, GRID.slice(0, 21));
  const f = discoverFilters(s, 'open');
  rect(s, { name: 'Dim', y: 240, w: 1920, h: 840, fill: C.canvas, o: 0.5 });
  use(s, DROP_MENU, {}, { x: f.x + f.children[1].x, y: 232 });
  railFor(s, 'Discover');
}
{
  const s = screen('15 Discover · no TMDB key', 3, 2);
  pageHead(s, 'Discover');
  use(s, EMPTY, {}, {
    x: (1920 - 640) / 2 + 60, y: 330,
    text: { Title: 'Discover needs a TMDB key', Body: 'Add your TMDB key in Settings → Credentials to browse TMDB’s catalogue here.', Label: 'Open Settings' },
    icon: { Icon: 'compass' },
    edit: (n) => swapIcon(n.findAll((k) => k.name === 'Icon')[1], 'settings'),
  });
  railFor(s, 'Discover');
}
const HUNGER = [T.tt1392170, T.tt1951264, T.tt10545296];
{
  const s = screen('16 Search', 3, 3);
  use(s, SEARCH, { state: 'focus' }, { x: X, y: 56, text: { Query: 'hunger games' }, edit: (n) => { layer(n, 'Query').fills = solid(C.ink); } });
  use(s, ROW_HEAD, {}, { x: X, y: 186, text: { Title: 'Movies', Source: 'Cinemeta' } });
  HUNGER.forEach((t, i) => use(s, POSTER, { state: 'rest' }, { x: X + i * 236, y: 244, image: { Art: t.poster } }));
  use(s, ROW_HEAD, {}, { x: X, y: 616, text: { Title: 'Series', Source: 'Cinemeta' } });
  text(s, 'No series match “hunger games”.', { name: 'No results', x: X, y: 670, size: 19, o: A.faint });
  use(s, ROW_HEAD, {}, { x: X, y: 744, text: { Title: 'Movies', Source: 'TMDB' } });
  [HUNGER[1], HUNGER[0], HUNGER[2]].forEach((t, i) => use(s, POSTER, { state: 'rest' }, { x: X + i * 236, y: 802, image: { Art: t.poster } }));
  railFor(s, 'Search');
}
{
  const s = screen('17b Library · signed out', 3, 5);
  pageHead(s, 'Library', 'From your Stremio account');
  text(s, 'Your Library holds the Titles saved in your Stremio account. Sign in to Stremio to read the account\'s collection.', { x: X, y: 176, w: 880, size: 20, lh: 30, o: A.muted });
  use(s, FIELD, { state: 'focus' }, { x: X, y: 264, text: { Label: 'Stremio email', Value: 'you@example.com' } });
  use(s, FIELD, { state: 'rest' }, { x: X, y: 380, text: { Label: 'Stremio password', Value: 'the password Stremio knows' } });
  use(s, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: X, y: 502, text: { Label: 'Sign in' }, hide: ['Icon'] });
  railFor(s, 'Library');
}
{
  const s = screen('17 Library', 3, 4);
  pageHead(s, 'Library', 'From your Stremio account');
  chips(s, X, 176, [[['All', true], ['Movies'], ['Series']]]);
  posterGrid(s, 262, LIB, 0, LIB_MARKS);
  railFor(s, 'Library');
}

// ---------- Addons and Settings ----------
const ADDONS = [
  ['ok', 'Cinemeta', 'Catalogs, metadata · movies, series', 'v3.0.13 · v3-cinemeta.strem.io'],
  ['ok', 'Torrentio', 'Streams · movies, series', 'v0.0.15 · torrentio.strem.fun'],
  ['ok', 'Comet', 'Streams · movies, series', 'v2.0.0 · comet.elfhosted.com'],
  ['failed', 'MediaFusion', 'Streams · movies, series, tv', ''],
];
function addonsPage(s, order, stateOf) {
  pageHead(s, 'Addons', '4 installed · asked in this order');
  use(s, FIELD, { state: 'rest' }, { x: X, y: 168 });
  use(s, BUTTON, { kind: 'primary', size: 'L', state: 'rest' }, { x: X + 900, y: 206, text: { Label: 'Install' }, icon: { Icon: 'plus' } });
  order.forEach((k, i) => {
    const [health, name, res, origin] = ADDONS[k];
    use(s, ADDON, { health, state: stateOf(k) }, { x: X, y: 318 + i * 132, text: { Name: name, Resources: res, ...(origin ? { Origin: origin } : {}) } });
  });
  railFor(s, 'Addons');
}
{
  const s = screen('18 Addons', 4, 0);
  addonsPage(s, [0, 1, 2, 3], (k) => (k === 1 ? 'focus' : 'rest'));
}
{
  const s = screen('18b Addons · moving', 4, 1);
  addonsPage(s, [0, 2, 1, 3], (k) => (k === 2 ? 'moving' : 'rest'));
}
{
  const s = screen('18d Addons · details', 4, 3);
  pageHead(s, 'Addons', '4 installed · asked in this order');
  use(s, FIELD, { state: 'rest' }, { x: X, y: 168 });
  use(s, BUTTON, { kind: 'primary', size: 'L', state: 'rest' }, { x: X + 900, y: 206, text: { Label: 'Install' }, icon: { Icon: 'plus' } });
  let y = 318;
  [0, 1, 2, 3].forEach((k) => {
    const [health, name, res, origin] = ADDONS[k];
    use(s, ADDON, { health, state: k === 1 ? 'focus' : 'rest' }, { x: X, y, text: { Name: name, Resources: res, ...(origin ? { Origin: origin } : {}) } });
    y += 132;
    if (k === 1) {
      facts(s, X, y - 12, 880, [['Version', '0.0.15'], ['Manifest', 'https://torrentio.strem.fun/manifest.json'], ['Id', 'com.stremio.torrentio.addon'], ['Serves', 'Streams'], ['Types', 'movie, series']]);
      y += 5 * 52 + 8 + 8;
    }
  });
  railFor(s, 'Addons');
}
{
  const s = screen('18c Addons · remove', 4, 2);
  addonsPage(s, [0, 1, 2, 3], () => 'rest');
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.ink, o: 0.6 });
  use(s, CONFIRM, {}, { x: 640, y: 390 });
}
const CATS = ['Credentials', 'Preferences', 'Remote devices', 'About/Credits'];
function settingsBase(s, active) {
  pageHead(s, 'Settings');
  CATS.forEach((c, i) => use(s, CATEGORY, { state: c === active ? 'active' : 'rest' }, { x: X, y: 176 + i * 72, text: { Label: c } }));
  text(s, active, { name: 'Category', x: 600, y: 176, size: 30, weight: 800 });
  railFor(s, 'Settings');
}
// the values main's Settings holds today (src/core/controls.ts and its JSON ladders)
const PREFS = [
  ['value', 'captions', 'Subtitle languages', 'Português (Brasil), English'],
  ['value', 'audio-lines', 'Audio languages', 'Follow the file'],
  ['value', 'sliders-horizontal', 'Subtitle appearance', 'White · Default'],
  ['switch', 'skip-forward', 'Autoplay the next episode', ''],
  ['value', 'play', 'Play on an Up next', 'Play directly'],
  ['value', 'house', 'Featured catalog', 'Popular · Cinemeta'],
  ['value', 'gauge', 'Stream buffer', '5 min · 512 MB'],
  ['value', 'disk', 'Torrent cache', '2 GB'],
];
{
  const s = screen('19 Settings · preferences', 4, 4);
  settingsBase(s, 'Preferences');
  PREFS.forEach(([trailing, ic, label, value], i) => use(s, LIST_ROW, { trailing, state: i === 0 ? 'focus' : 'rest' }, {
    x: 600, y: 236 + i * 88, text: { Label: label, ...(value ? { Value: value } : {}) }, icon: { Icon: ic },
  }));
}
function remoteDevices(s) {
  settingsBase(s, 'Remote devices');
  use(s, PAIRING, {}, { x: 600, y: 236 });
  text(s, 'Paired devices', { x: 600, y: 470, size: 22, weight: 800 });
  use(s, DEVICE, {}, { x: 600, y: 512 });
  use(s, DEVICE, {}, { x: 600, y: 612, text: { Name: 'Tablet', Detail: 'Paired 3 Oct 2026 · last seen 2 days ago' } });
}
{
  const s = screen('20 Settings · remote devices', 4, 5);
  remoteDevices(s);
}
{
  const s = screen('20b Remote devices · revoke', 4, 7);
  remoteDevices(s);
  rect(s, { name: 'Dim', w: 1920, h: 1080, fill: C.ink, o: 0.6 });
  use(s, CONFIRM, {}, { x: 640, y: 390, text: { Title: 'Revoke Tablet?', Body: 'The device\'s token stops working immediately. Every other paired device keeps working.', Label: 'Revoke' } });
}
{
  const s = screen('21 Settings · credentials', 4, 6);
  credentials(s, true);
}
// ---------- Settings, part by part ----------
function settingsDetail(s, cat, title, intro, row, col) {
  pageHead(s, 'Settings');
  CATS.forEach((c, i) => use(s, CATEGORY, { state: c === cat ? 'active' : 'rest' }, { x: X, y: 176 + i * 72, text: { Label: c } }));
  railFor(s, 'Settings');
  if (title === cat) text(s, title, { name: 'Title', x: 600, y: 176, size: 30, weight: 800 });
  else {
    // a level pushed inside a category: Back, and the category above its name
    use(s, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 600, y: 170, name: 'Back', icon: { Icon: 'arrow-left' } });
    text(s, cat, { name: 'Crumb', x: 664, y: 168, size: 15, weight: 700, color: C.accent });
    text(s, title, { name: 'Title', x: 664, y: 188, size: 28, weight: 800 });
  }
  if (intro) text(s, intro, { name: 'Intro', x: 600, y: 246, w: 880, size: 17, lh: 25, o: A.muted });
}
// a labelled row of chips; returns the y under it
function choiceGroup(s, x, y, label, labels, on, focus = -1, note) {
  text(s, label, { name: label, x, y, size: 17, weight: 700, o: A.muted });
  const f = row(s, { name: `${label} choices`, x, y: y + 32, h: 46, gap: 10 });
  labels.forEach((l, i) => use(f, CHIP, { selected: i === on ? 'on' : 'off', state: i === focus ? 'focus' : 'rest' }, { text: { Label: l } }));
  if (note) text(s, note, { name: 'Note', x, y: y + 90, w: 880, size: 15, o: A.faint });
  return y + (note ? 130 : 104);
}
function facts(s, x, y, w, rows) {
  const b = box(s, { name: 'Facts', x, y, w, h: rows.length * 52 + 8, r: 18, fill: C.white, o: 0.055 });
  rows.forEach(([a, v, tone], i) => {
    text(b, a, { name: a, x: 24, y: 18 + i * 52, size: 17, o: A.muted });
    text(b, v, { name: `${a} value`, x: 24, y: 18 + i * 52, w: w - 48, size: 17, weight: 700, align: 'RIGHT', ...(tone ? { color: tone } : {}) });
    if (i) rect(b, { name: 'Rule', x: 24, y: 4 + i * 52, w: w - 48, h: 1, o: 0.08 });
  });
  return b;
}
function credentials(s, held) {
  settingsDetail(s, 'Credentials', 'Credentials');
  facts(s, 600, 250, 880, [['Secret store', 'OS keyring'], ['TMDB key', held ? 'Held' : 'Not held', held ? C.accent : null], ['Stremio account', held ? 'Signed in' : 'Not signed in', held ? C.accent : null]]);
  use(s, FIELD, { state: held ? 'rest' : 'focus' }, { x: 600, y: 440, text: { Label: 'TMDB API key or read-access token', Value: held ? 'the key TMDB gave you' : '••••••••••••••••••••••••' } });
  const b = row(s, { name: 'Key actions', x: 600, y: 562, h: 48, gap: 12 });
  use(b, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { text: { Label: 'Save key' }, hide: ['Icon'] });
  if (held) use(b, BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { text: { Label: 'Clear key' }, icon: { Icon: 'trash' }, edit: (n) => { n.findAll((k) => k.type === 'TEXT').forEach((t) => { t.fills = solid(C.danger); }); tint(n, C.danger); } });
  text(s, 'Stremio account', { x: 600, y: 648, size: 22, weight: 800 });
  if (held) {
    const acc = box(s, { name: 'Account', x: 600, y: 690, w: 880, h: 96, r: 18, fill: C.white, o: 0.055 });
    text(acc, 'Signed in', { name: 'State', x: 24, y: 20, size: 20, weight: 700 });
    text(acc, 'Watch progress syncs both ways · the Library is read from the account', { name: 'Detail', x: 24, y: 52, size: 15, o: A.muted });
    use(acc, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 740, y: 24, text: { Label: 'Sign out' }, hide: ['Icon'] });
  } else {
    use(s, FIELD, { state: 'rest' }, { x: 600, y: 690, text: { Label: 'Stremio email', Value: 'you@example.com' } });
    use(s, FIELD, { state: 'rest' }, { x: 600, y: 806, text: { Label: 'Stremio password', Value: 'the password Stremio knows' } });
    use(s, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: 600, y: 928, text: { Label: 'Sign in' }, hide: ['Icon'] });
  }
}
{
  const s = screen('22 Credentials · signed out', 5, 0);
  credentials(s, false);
}
{
  const s = screen('23 Subtitle languages', 5, 1);
  settingsDetail(s, 'Preferences', 'Subtitle languages', 'The Host picks the first of these a Stream carries. Up to three; with none, it follows the file: the subtitle the file marks as default, if it has one.');
  use(s, GROUP, {}, { x: 600, y: 318, text: { Label: 'CHOSEN · IN ORDER' } });
  use(s, RANKED, { state: 'rest' }, { x: 600, y: 346 });
  use(s, RANKED, { state: 'focus' }, { x: 600, y: 430, text: { Label: 'English' }, edit: (n) => { layer(n, 'Rank').characters = '2'; } });
  use(s, GROUP, {}, { x: 600, y: 540, text: { Label: 'ADD A LANGUAGE' } });
  ['Español', 'Français', 'Deutsch', 'Italiano'].forEach((l, i) => use(s, LIST_ROW, { trailing: 'value', state: 'rest' }, {
    x: 600, y: 568 + i * 88, text: { Label: l, Value: '' }, icon: { Icon: 'plus' }, edit: (n) => { layer(n, 'Trailing').visible = false; },
  }));
}
{
  const s = screen('23b Audio languages', 5, 6);
  settingsDetail(s, 'Preferences', 'Audio languages', 'The Host picks the first of these a Stream carries. Up to three; with none, it follows the file.');
  const f = box(s, { name: 'Following the file', x: 600, y: 318, w: 880, h: 84, r: 18, fill: C.accent, o: 0.12, stroke: C.accent, so: 0.4 });
  text(f, 'Following the file', { name: 'State', x: 24, y: 16, size: 20, weight: 700, color: C.accent });
  text(f, 'The soundtrack the file marks as default.', { name: 'Detail', x: 24, y: 48, size: 16, o: A.muted });
  use(s, GROUP, {}, { x: 600, y: 436, text: { Label: 'ADD A LANGUAGE' } });
  ['English', 'Português (Brasil)', 'Español', 'Français', 'Deutsch'].forEach((l, i) => use(s, LIST_ROW, { trailing: 'value', state: i === 0 ? 'focus' : 'rest' }, {
    x: 600, y: 464 + i * 88, text: { Label: l, Value: '' }, icon: { Icon: 'plus' }, edit: (n) => { layer(n, 'Trailing').visible = false; },
  }));
}
{
  const s = screen('24 Subtitle appearance', 5, 2);
  settingsDetail(s, 'Preferences', 'Subtitle appearance', 'How the Player draws subtitles, on every Stream. A styled (ASS) track keeps the colours it was made with; the size reaches both kinds.');
  let y = choiceGroup(s, 600, 320, 'Colour', ['White', 'Yellow', 'Cyan', 'Green'], 0);
  text(s, 'Size', { x: 600, y, size: 17, weight: 700, o: A.muted });
  use(s, STEPPER, {}, { x: 600, y: y + 32 });
  text(s, 'From 25% to 300%, in steps of 5%.', { x: 972, y: y + 46, size: 15, o: A.faint });
  y += 104;
  const pv = box(s, { name: 'Preview', x: 600, y: y + 8, w: 880, h: 1080 - y - 48, r: 20, clip: true });
  image(pv, SEV.episodes[0].still, { w: 880, h: 495 });
  grad(pv, { dir: 'bottom', y: pv.height - 160, w: 880, h: 160, color: '#000000', stops: [[0, 0.6], [1, 0]] });
  const sub = text(pv, 'Ninguém aqui sabe quem você é lá fora.', { name: 'Subtitle', y: pv.height - 76, w: 880, size: 30, weight: 600, align: 'CENTER' });
  sub.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.9 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true, blendMode: 'NORMAL' }];
  use(pv, BADGE, { tone: 'neutral' }, { x: 16, y: 16, text: { Label: 'PREVIEW' } });
}
{
  const s = screen('25 Stream buffer & torrent cache', 5, 3);
  settingsDetail(s, 'Preferences', 'Stream buffer & torrent cache', 'How far ahead the Player reads, so a dip in the network is ridden out. It stops at whichever limit comes first.');
  let y = choiceGroup(s, 600, 320, 'Look-ahead', ['1 min', '3 min', '5 min', '10 min', '30 min'], 2);
  y = choiceGroup(s, 600, y, 'Memory ceiling', ['128 MB', '256 MB', '512 MB', '1 GB', '2 GB'], 2, -1, 'Torrents are fetched this far ahead too.');
  rect(s, { name: 'Rule', x: 600, y: y + 4, w: 880, h: 1, o: 0.1 });
  text(s, 'Torrent cache', { x: 600, y: y + 30, size: 22, weight: 800 });
  text(s, 'The most disk a playing torrent may take. Pieces furthest behind go first, and all of it is deleted when the torrent is let go.', { x: 600, y: y + 64, w: 880, size: 16, lh: 23, o: A.muted });
  choiceGroup(s, 600, y + 130, 'Size', ['512 MB', '2 GB', '8 GB', '32 GB'], 1, 1);
}
{
  const s = screen('26 Up next & featured catalog', 5, 4);
  settingsDetail(s, 'Preferences', 'Up next & featured catalog', 'The Host\'s own choices, the same on every client.');
  use(s, LIST_ROW, { trailing: 'switch', state: 'focus' }, { x: 600, y: 296, text: { Label: 'Autoplay the next episode' }, icon: { Icon: 'skip-forward' } });
  text(s, 'On, the next episode plays 5 seconds after one ends; off, the Player waits.', { x: 600, y: 384, w: 880, size: 15, o: A.faint });
  let y = 430;
  y = choiceGroup(s, 600, y, 'When Play is pressed on an Up next', ['Play directly', 'Open the Streams picker'], 0);
  rect(s, { name: 'Rule', x: 600, y: y + 4, w: 880, h: 1, o: 0.1 });
  text(s, 'Featured catalog', { x: 600, y: y + 30, size: 22, weight: 800 });
  text(s, 'What every client\'s Home hero is drawn from: its first titles, in the Addon\'s own order.', { x: 600, y: y + 64, w: 880, size: 16, lh: 23, o: A.muted });
  choiceGroup(s, 600, y + 108, 'Catalog', ['None', 'Popular · Cinemeta', 'New · Cinemeta', 'Featured · Cinemeta'], 1);
}
const TMDB_SVG = fs.readFileSync(`${D}/assets/tmdb-logo.svg`, 'utf8').replace('<svg ', '<svg width="273" height="36" ');
function tmdbMark(parent, x, y) {
  const g = figma.createNodeFromSvg(TMDB_SVG);
  g.fills = []; g.name = 'TMDB';
  for (const v of g.findAll((k) => k.type === 'VECTOR')) storeOutline(v);
  parent.appendChild(g); g.x = x; g.y = y;
  return g;
}
{
  const s = screen('27 About/Credits', 5, 5);
  settingsDetail(s, 'About/Credits', 'About/Credits');
  const t = box(s, { name: 'TMDB credit', x: 600, y: 250, w: 880, h: 132, r: 18, fill: C.white, o: 0.055 });
  tmdbMark(t, 24, 28);
  text(t, 'This product uses the TMDB API but is not endorsed or certified by TMDB', { name: 'Notice', x: 24, y: 84, w: 832, size: 16, o: A.muted });
  facts(s, 600, 406, 880, [['streamingapp', 'v0.1.628']]);
  text(s, 'Licences', { x: 600, y: 496, size: 22, weight: 800 });
  text(s, 'streamingapp is free software, released under the GNU General Public License, version 3 or later (GPL-3.0-or-later). Playback uses mpv (libmpv), whose default build is GPLv2 or later, linked in-process so the video surface stays mpv\'s own.', { x: 600, y: 536, w: 880, size: 17, lh: 26, o: A.muted });
}

// ---------- phone screens ----------
function phone(name, row, col, after) {
  return box(pageS, { name, x: after * 2040 + col * 470, y: row * 1240, w: PW, h: PH_, fill: C.canvas, clip: true });
}
function chrome(s, active, strip = true) {
  if (strip) use(s, STRIP, { playing: 'on' }, { x: 8, y: PH_ - 98 - 72 });
  use(s, TAB_BAR, { active }, { y: PH_ - 98 });
  use(s, STATUS);
}
function pContinue(s, y) {
  use(s, P_ROW_HEAD, {}, { x: G, y, text: { Title: 'Continue watching' }, hide: ['Source'] });
  CONTINUE.forEach(([t, o], i) => {
    const x = G + i * 276, cy = y + 40;
    use(s, P_WIDE, { state: 'rest' }, {
      x, y: cy, image: { Art: o.art || t.background },
      ...(o.art ? { hide: ['Logo'] } : { logo: { Logo: [t.logo, 120, 44] } }),
      show: o.upNext ? ['Up next'] : [],
      edit: (n) => { const p = layer(n, 'Progress'); if (o.progress) p.resize(236 * o.progress, 3); else p.visible = false; },
    });
    use(s, P_CAPTION, {}, { x, y: cy + 157, text: { Title: t.name, Note: o.note } });
  });
}
function pPosters(s, y, title, list) {
  use(s, P_ROW_HEAD, {}, { x: G, y, text: { Title: title } });
  list.forEach((t, i) => use(s, P_POSTER, { state: 'rest' }, { x: G + i * 128, y: y + 40, image: { Art: t.poster } }));
}
{
  const s = phone('P1 Home · top', 0, 0, 4);
  use(s, P_HERO);
  use(s, BRAND, {}, { x: G, y: 54, edit: (n) => n.rescale && n.rescale(0.75) });
  pContinue(s, 540);
  chrome(s, 'Home');
}
{
  const s = phone('P2 Home · scrolled', 0, 1, 4);
  pContinue(s, 110);
  pPosters(s, 370, 'Popular movies', MOVIES.slice(0, 6));
  pPosters(s, 612, 'Popular series', SERIES.slice(0, 6));
  const top = box(s, { name: 'Header', w: PW, h: 100, fill: C.canvas, o: 0.92, blur: 30 });
  rect(top, { name: 'Hairline', y: 99, w: PW, h: 1, o: 0.08 });
  text(top, 'Home', { name: 'Title', x: G, y: 54, size: 28, weight: 800 });
  chrome(s, 'Home');
}
function remoteScreen(s) {
  image(s, SEV.background, { name: 'Ambient', x: -600, w: 1500, h: PH_ });
  rect(s, { name: 'Ambient dim', w: PW, h: PH_, fill: C.canvas, o: 0.86 });
  use(s, STATUS);
  use(s, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: 8, y: 50, name: 'Collapse', icon: { Icon: 'caret-down' } });
  const h = text(s, 'Playing on the Host', { name: 'Where', y: 64, w: PW, size: 14, weight: 700, o: A.muted, align: 'CENTER' });
  use(s, ICON_BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { x: PW - 56, y: 50, name: 'Stop', icon: { Icon: ['stop', { filled: true }] } });
  // the Title's poster, not a frame of the episode, with its name and the episode beside it
  const pst = box(s, { name: 'Poster', x: G, y: 104, w: 148, h: 222, r: 14, clip: true, shadow: 18, fill: C.surface2 });
  image(pst, SEV.poster, { w: 148, h: 222 });
  const cx = G + 148 + 16, cw = PW - cx - G;
  text(s, 'Severance', { name: 'Title', x: cx, y: 106, w: cw, size: 24, weight: 800, lh: 30 });
  text(s, 'S2 E3 · Who Is Alive?', { name: 'Episode', x: cx, y: 140, w: cw, size: 14, weight: 700, color: C.accent });
  text(s, epText(SEV.episodes[2], 70), { name: 'Description', x: cx, y: 166, w: cw, size: 13, lh: 19, o: A.muted });
  const q = row(s, { name: 'Stream facts', x: G, y: 342, h: 28, gap: 8 });
  use(q, BADGE, { tone: 'neutral' }, { text: { Label: '4K' } });
  use(q, BADGE, { tone: 'neutral' });
  use(q, BADGE, { tone: 'neutral' }, { text: { Label: 'ATMOS' } });
  use(s, P_SEEK, {}, { x: G, y: 390 });
  use(s, P_TRANSPORT, { playing: 'on' }, { x: G, y: 440 });
  use(s, P_VOLUME, {}, { x: G, y: 536 });
  use(s, P_MENU, {}, { x: G, y: 612 });
  use(s, P_SWITCH_ROW, {}, { x: G, y: 708 });
  rect(s, { name: 'Home indicator', x: (PW - 134) / 2, y: PH_ - 13, w: 134, h: 5, r: 3 });
}
{
  const s = phone('P3 Remote', 2, 0, 13);
  remoteScreen(s);
}
{
  const s = phone('P4 Audio & subtitles', 2, 1, 13);
  remoteScreen(s);
  rect(s, { name: 'Dim', w: PW, h: PH_, fill: C.ink, o: 0.55 });
  // its content is the screen's own, so this sheet is a detached copy
  const sh = detachDeep(use(s, P_SHEET, {}, { y: 92 }));
  sh.resize(PW, 760);
  const list = (y, head, items, active) => {
    use(sh, GROUP, {}, { x: G, y, text: { Label: head } });
    items.forEach(([a, b], i) => use(sh, TRACK, { selected: i === active ? 'on' : 'off', state: 'rest' }, {
      x: G - 4, y: y + 28 + i * 64, text: { Title: a, Detail: b },
      edit: (n) => { n.resize(366, 64); if (!b) { layer(n, 'Title').y = 18; layer(n, 'Detail').visible = false; } },
    }));
  };
  list(86, 'SUBTITLES', [['Off', ''], ['Português (Brasil)', 'In the file · SRT'], ['English', 'In the file · SRT'], ['Español', 'OpenSubtitles v3']], 1);
  list(398, 'AUDIO', [['English', 'Dolby Digital+ Atmos · 5.1'], ['Português (Brasil)', 'Dolby Digital+ · 5.1']], 0);
  use(sh, GROUP, {}, { x: G, y: 560, text: { Label: 'SYNC' } });
  use(sh, SYNC, {}, { x: G, y: 586 });
  use(sh, GROUP, {}, { x: G, y: 652, text: { Label: 'SIZE' } });
  use(sh, STEPPER, {}, { x: G, y: 678 });
}

{
  const s = phone('P5 Title · series', 1, 0, 2);
  image(s, SEV.background, { name: 'Backdrop', w: PW, h: 250 });
  grad(s, { dir: 'top', w: PW, h: 120, stops: [[0, 0.7], [1, 0]] });
  grad(s, { dir: 'bottom', y: 110, w: PW, h: 142, stops: [[0, 1], [1, 0]] });
  const { w, h } = logoBox(SEV.logo, 230, 70);
  image(s, SEV.logo, { name: 'Logo', mode: 'FIT', x: (PW - w) / 2, y: 238 - h, w, h });
  text(s, 'IMDb 8.6  ·  2022–  ·  49 min  ·  Drama, Mystery', { name: 'Facts', y: 250, w: PW, size: 13, weight: 600, o: A.muted, align: 'CENTER' });
  text(s, cut(SEV.description, 120), { name: 'Synopsis', x: G, y: 274, w: PW - 2 * G, size: 15, lh: 21, o: A.muted });
  use(s, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: G, y: 346, text: { Label: 'Resume S2 E3' }, edit: stretch(PW - 2 * G) });
  use(s, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: G, y: 404, text: { Label: 'Choose stream' }, icon: { Icon: 'list-video' }, edit: stretch(PW - 2 * G) });
  const seasons = row(s, { name: 'Seasons', x: G, y: 470, h: 46, gap: 10 });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(seasons, CHIP, { selected: 'on', state: 'rest' });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Specials' } });
  SEV.episodes.slice(0, 3).forEach((v, i) => use(s, P_EPISODE, {}, {
    x: G, y: 532 + i * 136, image: { Art: v.still },
    text: { Number: `E${v.episode} · ${[57, 51, 46][i]} min`, Title: v.name, Note: day(v.released), Description: epText(v, 84) },
    ...(i === 2 ? {} : { hide: ['Progress', 'Progress track'] }),
  }));
  use(s, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 12, y: 50, name: 'Back', icon: { Icon: 'arrow-left' } });
  chrome(s, 'Home');
}
{
  const s = phone('P5b Title · episodes', 1, 1, 2);
  const seasons = row(s, { name: 'Seasons', x: G, y: 116, h: 46, gap: 10 });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(seasons, CHIP, { selected: 'on', state: 'rest' });
  use(seasons, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Specials' } });
  SEV.episodes.slice(0, 5).forEach((v, i) => use(s, P_EPISODE, {}, {
    x: G, y: 182 + i * 140, image: { Art: v.still },
    text: { Number: `E${v.episode} · ${[57, 51, 46, 49, 55][i]} min`, Title: v.name, Note: day(v.released), Description: epText(v, 84) },
    ...(i === 2 ? {} : { hide: ['Progress', 'Progress track'] }),
  }));
  pHeader(s, 'Severance', 'Season 2 · 10 episodes');
  chrome(s, 'Home');
}
{
  const s = phone('P6 Streams', 1, 2, 2);
  const f = row(s, { name: 'Addon filter', x: G, y: 112, h: 46, gap: 8 });
  use(f, CHIP, { selected: 'on', state: 'rest' }, { text: { Label: 'All' } });
  for (const a of ['Torrentio', 'Comet', 'MediaFusion']) use(f, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: a } });
  use(s, GROUP, {}, { x: G, y: 176 });
  use(s, P_STREAM, { tier: '4K' }, { x: G, y: 200 });
  use(s, P_STREAM, { tier: '4K' }, { x: G, y: 322, text: { Name: 'Severance.S02E03.2160p.WEB.h265-ETHEL', Details: '97 peers · 6.1 GB · 1337x' } });
  use(s, P_STREAM, { tier: 'HD' }, { x: G, y: 444, text: { Name: 'Severance.S02E03.1080p.ATVP.WEB-DL.DDP5.1.H.264', Details: '532 peers · 3.9 GB · EZTV' } });
  use(s, GROUP, {}, { x: G, y: 572, text: { Label: 'COMET' } });
  use(s, P_STREAM, { tier: 'HD' }, { x: G, y: 596, text: { Name: 'Severance S02E03 Who Is Alive 1080p HEVC', Details: '1.8 GB · Comet · direct' } });
  pHeader(s, 'Streams', 'Severance · S2 E3 · Who Is Alive?');
  chrome(s, 'Home');
}

// ---------- phone: the remote's menus, open ----------
function remoteSheet(s, title, h) {
  remoteScreen(s);
  rect(s, { name: 'Dim', w: PW, h: PH_, fill: C.ink, o: 0.55 });
  const sh = detachDeep(use(s, P_SHEET, {}, { y: PH_ - h }));
  sh.resize(PW, h + 40);
  layer(sh, 'Title').characters = title;
  return sh;
}
function sheetChips(sh, y, labels, on) {
  let f = row(sh, { name: 'Choices', x: G, y, h: 46, gap: 8 }), lines = 1;
  labels.forEach((l, i) => {
    const want = { selected: i === on ? 'on' : 'off', state: 'rest' }, o = { text: { Label: l } };
    const c = use(f, CHIP, want, o);
    if (f.width > PW - 2 * G) { c.remove(); f = row(sh, { name: 'Choices', x: G, y: y + lines++ * 54, h: 46, gap: 8 }); use(f, CHIP, want, o); }
  });
  return y + lines * 54;
}
{
  const s = phone('P4b Picture', 2, 2, 13);
  const sh = remoteSheet(s, 'Picture', 500);
  use(sh, GROUP, {}, { x: G, y: 86, text: { Label: 'ASPECT' } });
  let y = sheetChips(sh, 112, ['Source', '16:9', '4:3', '21:9'], 0);
  use(sh, GROUP, {}, { x: G, y: y + 14, text: { Label: 'CROP' } });
  y = sheetChips(sh, y + 40, ['Full frame', '16:9', '4:3', '21:9'], 0);
  use(sh, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: G, y: y + 14, text: { Label: 'Autocrop' }, icon: { Icon: 'maximize' } });
  text(sh, 'Finds the black bars and keeps the picture inside them.', { x: G, y: y + 76, w: PW - 2 * G, size: 13, o: A.faint });
}
{
  const s = phone('P4c Episodes', 2, 3, 13);
  const sh = remoteSheet(s, 'Episodes', 620);
  const ch = row(sh, { name: 'Seasons', x: G, y: 86, h: 46, gap: 8 });
  use(ch, CHIP, { selected: 'off', state: 'rest' }, { text: { Label: 'Season 1' } });
  use(ch, CHIP, { selected: 'on', state: 'rest' });
  SEV.episodes.slice(1, 5).forEach((v, i) => use(sh, P_EPISODE, {}, {
    x: G, y: 150 + i * 130, image: { Art: v.still },
    text: { Number: i === 1 ? `E${v.episode} · PLAYING` : `E${v.episode} · ${[51, 46, 49, 55][i]} min`, Title: v.name, Note: day(v.released), Description: epText(v, 84) },
    ...(i === 1 ? {} : { hide: ['Progress', 'Progress track'] }),
  }));
}
{
  const s = phone('P4d Streams', 2, 4, 13);
  const sh = remoteSheet(s, 'Streams', 520);
  use(sh, GROUP, {}, { x: G, y: 86 });
  // the Stream playing now: lavender outline, and PLAYING in place of its second mark
  use(sh, P_STREAM, { tier: '4K' }, { x: G, y: 112, edit: (n) => { n.strokes = solid(C.accent); n.strokeWeight = 2; n.strokeAlign = 'INSIDE'; layer(n, 'Marks').children[1].visible = false; } });
  use(sh, BADGE, { tone: 'accent' }, { x: G + 222, y: 188, text: { Label: 'PLAYING' } });
  use(sh, P_STREAM, { tier: '4K' }, { x: G, y: 234, text: { Name: 'Severance.S02E03.2160p.WEB.h265-ETHEL', Details: '97 peers · 6.1 GB · 1337x' } });
  use(sh, P_STREAM, { tier: 'HD' }, { x: G, y: 356, text: { Name: 'Severance.S02E03.1080p.ATVP.WEB-DL.DDP5.1.H.264', Details: '532 peers · 3.9 GB · EZTV' } });
}

// ---------- phone: Discover, Search, Library ----------
function pChips(s, y, groups) {
  const f = row(s, { name: 'Filters', x: G, y, h: 46, gap: 8 });
  groups.forEach((g, gi) => {
    if (gi) rect(f, { name: 'Divider', w: 1, h: 24, o: 0.2 });
    g.forEach(([label, on]) => use(f, CHIP, { selected: on ? 'on' : 'off', state: 'rest' }, { text: { Label: label } }));
  });
}
function pGrid(s, y, list, marks = {}) {
  list.forEach((t, i) => {
    const m = marks[i] || {};
    use(s, P_POSTER, { state: 'rest' }, { x: G + (i % 3) * 121, y: y + Math.floor(i / 3) * 181, image: { Art: t.poster } });
    if (m.progress) {
      rect(s, { name: 'Progress track', x: G + (i % 3) * 121 + 10, y: y + Math.floor(i / 3) * 181 + 164, w: 96, h: 3, r: 2, o: 0.3 });
      rect(s, { name: 'Progress', x: G + (i % 3) * 121 + 10, y: y + Math.floor(i / 3) * 181 + 164, w: 96 * m.progress, h: 3, r: 2, fill: C.accent });
    }
  });
}
{
  const s = phone('P7 Discover', 3, 0, 6);
  const f = row(s, { name: 'Filters', x: G, y: 128, h: 46, gap: 8 });
  for (const v of ['Movies', 'All genres', 'Popular']) use(f, DROPDOWN, { state: 'rest' }, { text: { Value: v }, hide: ['Label'], edit: (n) => { n.paddingLeft = 16; n.paddingRight = 12; } });
  pGrid(s, 188, GRID.slice(0, 12));
  pLarge(s, 'Discover', 'From TMDB');
  chrome(s, 'Discover');
}
{
  const s = phone('P8 Search', 3, 1, 6);
  use(s, P_ROW_HEAD, {}, { x: G, y: 136, text: { Title: 'Movies', Source: 'Cinemeta' } });
  HUNGER.forEach((t, i) => use(s, P_POSTER, { state: 'rest' }, { x: G + i * 121, y: 176, image: { Art: t.poster } }));
  use(s, P_ROW_HEAD, {}, { x: G, y: 374, text: { Title: 'Series', Source: 'Cinemeta' } });
  text(s, 'No series match “hunger games”.', { name: 'No results', x: G, y: 410, size: 14, o: A.faint });
  use(s, P_ROW_HEAD, {}, { x: G, y: 456, text: { Title: 'Movies', Source: 'TMDB' } });
  HUNGER.forEach((t, i) => use(s, P_POSTER, { state: 'rest' }, { x: G + i * 121, y: 496, image: { Art: t.poster } }));
  const top = box(s, { name: 'Header', w: PW, h: 122, fill: C.canvas, o: 0.94, blur: 30 });
  rect(top, { name: 'Hairline', y: 121, w: PW, h: 1, o: 0.08 });
  use(top, SEARCH, { state: 'rest' }, { x: G, y: 54, text: { Query: 'hunger games' }, edit: (n) => { n.resize(PW - 2 * G, 56); layer(n, 'Query').fills = solid(C.white); } });
  chrome(s, 'Search');
}
{
  const s = phone('P9b Library · signed out', 3, 3, 6);
  let y = pIntro(s, 132, 'Your Library holds the Titles saved in your Stremio account. Sign in to Stremio to read the account\'s collection.') + 20;
  y = pField(s, y, 'Stremio email', 'you@example.com');
  y = pField(s, y, 'Stremio password', 'the password Stremio knows');
  use(s, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: G, y: y + 8, text: { Label: 'Sign in' }, hide: ['Icon'], edit: stretch(PW - 2 * G) });
  pLarge(s, 'Library', 'From your Stremio account');
  chrome(s, 'Library');
}
{
  const s = phone('P9 Library', 3, 2, 6);
  pChips(s, 128, [[['All', true], ['Movies'], ['Series']]]);
  pGrid(s, 188, LIB.slice(0, 12), LIB_MARKS);
  pLarge(s, 'Library', 'From your Stremio account');
  chrome(s, 'Library');
}

// ---------- phone: Addons, Settings, pairing ----------
function pAddons(s, editing) {
  if (!editing) {
    const f = box(s, { name: 'Install', x: G, y: 128, w: PW - 2 * G, h: 52, r: 14, fill: C.white, o: 0.08, stroke: C.white, so: 0.12 });
    text(f, 'Paste a manifest URL', { name: 'Value', x: 16, y: 15, size: 15, o: 0.55 });
    use(f, ICON_BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: PW - 2 * G - 50, y: 2, name: 'Install', icon: { Icon: 'plus' } });
  }
  ADDONS.forEach(([health, name, res], i) => {
    const y = (editing ? 128 : 196) + i * 88, detail = health === 'ok' ? res.replace('Catalogs, metadata', 'Catalogs') : 'Offline · addon_unreachable';
    if (editing) {
      const r = box(s, { name: `Addon/${name}`, x: G, y, w: PW - 2 * G, h: 76, r: 16, fill: C.white, o: 0.055 });
      icon(r, 'minus-circle', { name: 'Remove', size: 26, x: 12, y: 25, color: C.danger, filled: true });
      const k = box(r, { name: 'Logo', x: 48, y: 14, w: 48, h: 48, r: 12, fill: C.surface3 });
      icon(k, 'puzzle', { size: 24, x: 12, y: 12, o: 0.8 });
      text(r, name, { name: 'Name', x: 108, y: 15, size: 16, weight: 700 });
      text(r, detail, { name: 'Resources', x: 108, y: 39, w: 190, size: 13, o: A.muted, ...(health === 'ok' ? {} : { color: C.danger, o: 1 }) });
      icon(r, 'handle', { name: 'Handle', size: 26, x: PW - 2 * G - 40, y: 25, o: 0.6 });
      return;
    }
    use(s, P_ADDON, {}, {
      x: G, y, text: { Name: name, Resources: detail },
      edit: (n) => {
        if (health === 'ok') return;
        layer(n, 'Resources').fills = solid(C.danger);
        const sw = layer(n, 'Enabled');
        use(n, SWITCH, { value: 'off' }, { x: sw.x, y: sw.y, name: 'Enabled' });
        sw.remove();
      },
    });
  });
  const top = pLarge(s, 'Addons', '4 installed · asked in this order');
  const t = text(top, editing ? 'Done' : 'Edit', { name: 'Action', y: 58, size: 17, weight: 800, color: C.accent });
  t.x = PW - G - t.width;
}
{
  const s = phone('P10 Addons', 4, 0, 8);
  pAddons(s, false);
  chrome(s, 'Addons');
}
{
  const s = phone('P10b Addons · editing', 4, 1, 8);
  pAddons(s, true);
  text(s, 'Drag a handle to change the order the Host asks them in.', { name: 'Hint', x: G, y: 488, w: PW - 2 * G, size: 13, lh: 19, o: A.faint });
  chrome(s, 'Addons');
}
{
  const s = phone('P10c Addons · remove', 4, 2, 8);
  pAddons(s, true);
  chrome(s, 'Addons');
  rect(s, { name: 'Dim', w: PW, h: PH_, fill: C.ink, o: 0.6 });
  const c = box(s, { name: 'Confirm', x: 8, y: PH_ - 34 - 262, w: PW - 16, h: 262, r: 28, fill: C.surface, o: 0.98, stroke: C.white, so: 0.08, shadow: 30 });
  text(c, 'Remove MediaFusion?', { name: 'Title', x: 20, y: 24, size: 20, weight: 800 });
  text(c, 'Its Streams stop showing on every client. You can install it again from its URL.', { name: 'Body', x: 20, y: 58, w: PW - 56, size: 14, lh: 20, o: A.muted });
  use(c, BUTTON, { kind: 'danger', size: 'M', state: 'rest' }, { x: 20, y: 132, text: { Label: 'Remove' }, icon: { Icon: 'trash' }, edit: stretch(PW - 56) });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 20, y: 192, text: { Label: 'Cancel' }, hide: ['Icon'], edit: stretch(PW - 56) });
  rect(s, { name: 'Home indicator', x: (PW - 134) / 2, y: PH_ - 13, w: 134, h: 5, r: 3 });
}
{
  const s = phone('P10d Addon details', 4, 3, 8);
  const c = box(s, { name: 'Addon', x: G, y: 116, w: PW - 2 * G, h: 76, r: 16, fill: C.white, o: 0.055 });
  const k = box(c, { name: 'Logo', x: 12, y: 14, w: 48, h: 48, r: 12, fill: C.surface3 });
  icon(k, 'puzzle', { size: 24, x: 12, y: 12, o: 0.8 });
  text(c, 'Torrentio', { name: 'Name', x: 72, y: 15, size: 16, weight: 700 });
  text(c, 'v0.0.15', { name: 'Version', x: 72, y: 39, size: 13, o: A.muted });
  use(c, SWITCH, { value: 'on' }, { x: PW - 2 * G - 72, y: 21 });
  const y = pFacts(s, 208, [['Serves', 'Streams'], ['Types', 'movie, series'], ['Id', 'com.stremio.torrentio.addon']]);
  text(s, 'Manifest', { x: G, y: y + 18, size: 13, weight: 700, o: A.muted });
  text(s, 'https://torrentio.strem.fun/manifest.json', { x: G, y: y + 40, w: PW - 2 * G, size: 14, color: C.accent });
  const b = row(s, { name: 'Order', x: G, y: y + 86, h: 48, gap: 10 });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: 'Move up' }, icon: { Icon: 'arrow-up' } });
  use(b, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { text: { Label: 'Move down' }, icon: { Icon: 'arrow-down' } });
  use(s, BUTTON, { kind: 'danger', size: 'M', state: 'rest' }, { x: G, y: y + 150, text: { Label: 'Remove' }, icon: { Icon: 'trash' }, edit: stretch(PW - 2 * G) });
  pHeader(s, 'Torrentio', 'Addon');
  chrome(s, 'Addons');
}
{
  const s = phone('P11 Settings', 4, 4, 8);
  [['key', 'Credentials', 'OS keyring'], ['sliders-horizontal', 'Preferences', ''], ['device', 'Remote devices', '2 paired'], ['info', 'About/Credits', '']]
    .forEach(([ic, label, value], i) => use(s, P_LIST, {}, { x: G, y: 116 + i * 70, text: { Label: label, Value: value }, icon: { Icon: ic } }));
  pLarge(s, 'Settings');
  chrome(s, 'Settings');
}
{
  const s = phone('P12 Preferences', 4, 5, 8);
  PREFS.forEach(([trailing, ic, label, value], i) => {
    if (trailing === 'switch') {
      const r = box(s, { name: 'Autoplay', x: G, y: 116 + i * 70, w: PW - 2 * G, h: 60, r: 14, fill: C.white, o: 0.055 });
      icon(r, ic, { size: 22, x: 14, y: 19, o: 0.8 });
      text(r, label, { name: 'Label', x: 48, y: 19, size: 16, weight: 600 });
      use(r, SWITCH, { value: 'on' }, { x: PW - 2 * G - 74, y: 13 });
    } else use(s, P_LIST, {}, { x: G, y: 116 + i * 70, text: { Label: label, Value: value.replace('Português (Brasil), English', 'Português, English') }, icon: { Icon: ic } });
  });
  pHeader(s, 'Preferences');
  chrome(s, 'Settings');
}
{
  const s = phone('P13 Pairing', 4, 6, 8);
  use(s, STATUS);
  use(s, BRAND, {}, { x: (PW - 48) / 2, y: 150 });
  text(s, 'Pair with your Host', { name: 'Title', y: 226, w: PW, size: 26, weight: 800, align: 'CENTER' });
  text(s, 'Type the code the Host shows in Settings → Remote devices.', { name: 'Body', x: 32, y: 270, w: PW - 64, size: 15, lh: 22, o: A.muted, align: 'CENTER' });
  use(s, P_CODE, {}, { x: G, y: 352 });
  text(s, 'Host 192.168.0.12:7878', { name: 'Host', y: 432, w: PW, size: 14, weight: 700, color: C.accent, align: 'CENTER' });
  use(s, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { x: G, y: 480, text: { Label: 'Pair' }, hide: ['Icon'], edit: stretch(PW - 2 * G) });
  text(s, 'The code works once; the Host shows a new one after.', { name: 'Note', x: 32, y: 548, w: PW - 64, size: 13, lh: 19, o: A.faint, align: 'CENTER' });
  rect(s, { name: 'Home indicator', x: (PW - 134) / 2, y: PH_ - 13, w: 134, h: 5, r: 3 });
}

// ---------- phone: Settings, part by part ----------
function pChoice(s, y, label, labels, on) {
  text(s, label, { name: label, x: G, y, size: 13, weight: 700, o: A.muted });
  let f = row(s, { name: `${label} choices`, x: G, y: y + 24, h: 46, gap: 8 }), lines = 1;
  labels.forEach((l, i) => {
    const want = { selected: i === on ? 'on' : 'off', state: 'rest' }, o = { text: { Label: l } };
    const c = use(f, CHIP, want, o);
    if (f.width > PW - 2 * G) {
      c.remove();
      f = row(s, { name: `${label} choices ${++lines}`, x: G, y: y + 24 + (lines - 1) * 54, h: 46, gap: 8 });
      use(f, CHIP, want, o);
    }
  });
  return y + 24 + lines * 54 + 14;
}
function pFacts(s, y, rows) {
  const b = box(s, { name: 'Facts', x: G, y, w: PW - 2 * G, h: rows.length * 44 + 8, r: 14, fill: C.white, o: 0.055 });
  rows.forEach(([a, v, tone], i) => {
    text(b, a, { name: a, x: 16, y: 16 + i * 44, size: 14, o: A.muted });
    text(b, v, { name: `${a} value`, x: 16, y: 16 + i * 44, w: PW - 2 * G - 32, size: 14, weight: 700, align: 'RIGHT', ...(tone ? { color: tone } : {}) });
    if (i) rect(b, { name: 'Rule', x: 16, y: 4 + i * 44, w: PW - 2 * G - 32, h: 1, o: 0.08 });
  });
  return y + b.height;
}
function pField(s, y, label, value) {
  text(s, label, { name: label, x: G, y, size: 13, weight: 700, o: A.muted });
  const f = box(s, { name: 'Field', x: G, y: y + 22, w: PW - 2 * G, h: 52, r: 14, fill: C.white, o: 0.08, stroke: C.white, so: 0.12 });
  text(f, value, { name: 'Value', x: 16, y: 15, size: 15, o: 0.55 });
  return y + 86;
}
function pIntro(s, y, str) {
  return y + text(s, str, { name: 'Intro', x: G, y, w: PW - 2 * G, size: 14, lh: 20, o: A.muted }).height + 18;
}
{
  const s = phone('P14 Credentials', 5, 0, 7);
  let y = pFacts(s, 116, [['Secret store', 'OS keyring'], ['TMDB key', 'Held', C.accent], ['Stremio account', 'Signed in', C.accent]]) + 22;
  y = pField(s, y, 'TMDB API key or read-access token', 'the key TMDB gave you');
  const b = row(s, { name: 'Key actions', x: G, y, h: 48, gap: 10 });
  use(b, BUTTON, { kind: 'primary', size: 'M', state: 'rest' }, { text: { Label: 'Save key' }, hide: ['Icon'] });
  use(b, BUTTON, { kind: 'ghost', size: 'M', state: 'rest' }, { text: { Label: 'Clear key' }, icon: { Icon: 'trash' }, edit: (n) => { n.findAll((k) => k.type === 'TEXT').forEach((t) => { t.fills = solid(C.danger); }); tint(n, C.danger); } });
  y += 76;
  text(s, 'Stremio account', { x: G, y, size: 18, weight: 800 });
  const acc = box(s, { name: 'Account', x: G, y: y + 34, w: PW - 2 * G, h: 140, r: 16, fill: C.white, o: 0.055 });
  text(acc, 'Signed in', { name: 'State', x: 16, y: 14, size: 16, weight: 700 });
  text(acc, 'Watch progress syncs both ways; the Library is read from the account.', { name: 'Detail', x: 16, y: 38, w: PW - 2 * G - 32, size: 13, lh: 18, o: A.muted });
  use(acc, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 16, y: 80, text: { Label: 'Sign out' }, hide: ['Icon'] });
  pHeader(s, 'Credentials');
  chrome(s, 'Settings');
}
{
  const s = phone('P15 Subtitle languages', 5, 1, 7);
  let y = pIntro(s, 116, 'The Host picks the first of these a Stream carries. Up to three; with none, it follows the file.');
  use(s, GROUP, {}, { x: G, y, text: { Label: 'CHOSEN · IN ORDER' } });
  [['1', 'Português (Brasil)'], ['2', 'English']].forEach(([n, l], i) => {
    const r = box(s, { name: `Chosen/${l}`, x: G, y: y + 26 + i * 68, w: PW - 2 * G, h: 60, r: 14, fill: C.white, o: 0.055 });
    const k = box(r, { name: 'Badge', x: 12, y: 15, w: 30, h: 30, r: 15, fill: C.accent });
    text(k, n, { name: 'Rank', y: 5, w: 30, size: 15, weight: 800, color: C.ink, align: 'CENTER' });
    text(r, l, { name: 'Label', x: 54, y: 19, size: 15, weight: 700 });
    icon(r, 'arrow-up', { size: 20, x: 236, y: 20, o: 0.8 });
    icon(r, 'arrow-down', { size: 20, x: 274, y: 20, o: 0.8 });
    icon(r, 'x', { size: 20, x: 312, y: 20, o: 0.8 });
  });
  y += 26 + 2 * 68 + 18;
  use(s, GROUP, {}, { x: G, y, text: { Label: 'ADD A LANGUAGE' } });
  ['Español', 'Français', 'Deutsch'].forEach((l, i) => use(s, P_LIST, {}, {
    x: G, y: y + 26 + i * 68, text: { Label: l, Value: '' }, icon: { Icon: 'plus' }, edit: (n) => { layer(n, 'Trailing').visible = false; },
  }));
  pHeader(s, 'Subtitle languages', 'Preferences');
  chrome(s, 'Settings');
}
{
  const s = phone('P15b Audio languages', 5, 8, 7);
  let y = pIntro(s, 116, 'The Host picks the first of these a Stream carries. Up to three; with none, it follows the file.');
  const f = box(s, { name: 'Following the file', x: G, y, w: PW - 2 * G, h: 70, r: 14, fill: C.accent, o: 0.12, stroke: C.accent, so: 0.4 });
  text(f, 'Following the file', { name: 'State', x: 16, y: 14, size: 16, weight: 700, color: C.accent });
  text(f, 'The soundtrack the file marks as default.', { name: 'Detail', x: 16, y: 40, size: 13, o: A.muted });
  y += 90;
  use(s, GROUP, {}, { x: G, y, text: { Label: 'ADD A LANGUAGE' } });
  ['English', 'Português (Brasil)', 'Español', 'Français'].forEach((l, i) => use(s, P_LIST, {}, {
    x: G, y: y + 26 + i * 68, text: { Label: l, Value: '' }, icon: { Icon: 'plus' }, edit: (n) => { layer(n, 'Trailing').visible = false; },
  }));
  pHeader(s, 'Audio languages', 'Preferences');
  chrome(s, 'Settings');
}
{
  const s = phone('P16 Subtitle appearance', 5, 2, 7);
  let y = pIntro(s, 116, 'How the Player draws subtitles, on every Stream.');
  y = pChoice(s, y, 'Colour', ['White', 'Yellow', 'Cyan', 'Green'], 0);
  text(s, 'Size · 25% to 300%', { x: G, y, size: 13, weight: 700, o: A.muted });
  use(s, STEPPER, {}, { x: G, y: y + 24 });
  y += 92;
  const pv = box(s, { name: 'Preview', x: G, y, w: PW - 2 * G, h: 201, r: 16, clip: true });
  image(pv, SEV.episodes[0].still, { w: PW - 2 * G, h: 201 });
  const sub = text(pv, 'Ninguém aqui sabe quem você é.', { name: 'Subtitle', y: 160, w: PW - 2 * G, size: 16, weight: 600, align: 'CENTER' });
  sub.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.9 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: 'NORMAL' }];
  pHeader(s, 'Subtitle appearance', 'Preferences');
  chrome(s, 'Settings');
}
{
  const s = phone('P17 Buffer & cache', 5, 3, 7);
  let y = pIntro(s, 116, 'How far ahead the Player reads. It stops at whichever limit comes first; torrents are fetched this far ahead too.');
  y = pChoice(s, y, 'Look-ahead', ['1 min', '3 min', '5 min', '10 min', '30 min'], 2);
  y = pChoice(s, y, 'Memory ceiling', ['128 MB', '256 MB', '512 MB', '1 GB', '2 GB'], 2);
  text(s, 'Torrent cache', { x: G, y: y + 4, size: 18, weight: 800 });
  y = pIntro(s, y + 34, 'The most disk a playing torrent may take; deleted when the torrent is let go.');
  pChoice(s, y, 'Size', ['512 MB', '2 GB', '8 GB', '32 GB'], 1);
  pHeader(s, 'Stream buffer & torrent cache', 'Preferences');
  chrome(s, 'Settings', false);
}
{
  const s = phone('P18 Up next & featured', 5, 4, 7);
  const r = box(s, { name: 'Autoplay', x: G, y: 116, w: PW - 2 * G, h: 60, r: 14, fill: C.white, o: 0.055 });
  icon(r, 'skip-forward', { size: 22, x: 14, y: 19, o: 0.8 });
  text(r, 'Autoplay the next episode', { name: 'Label', x: 48, y: 19, size: 16, weight: 600 });
  use(r, SWITCH, { value: 'on' }, { x: PW - 2 * G - 74, y: 13 });
  let y = 116 + 60 + 10;
  y = pIntro(s, y, 'Plays the next episode 5 seconds after one ends.');
  y = pChoice(s, y, 'When Play is pressed on an Up next', ['Play directly', 'Open the Streams picker'], 0);
  text(s, 'Featured catalog', { x: G, y: y + 4, size: 18, weight: 800 });
  y = pIntro(s, y + 34, 'What every client\'s Home hero is drawn from.');
  pChoice(s, y, 'Catalog', ['None', 'Popular · Cinemeta', 'New · Cinemeta', 'Featured · Cinemeta'], 1);
  pHeader(s, 'Up next & featured catalog', 'Preferences');
  chrome(s, 'Settings', false);
}
function pRemoteDevices(s) {
  const c = box(s, { name: 'Pairing', x: G, y: 116, w: PW - 2 * G, h: 176, r: 16, fill: C.white, o: 0.055 });
  text(c, 'PAIRING CODE · SINGLE USE', { name: 'Overline', x: 16, y: 16, size: 11, weight: 800, o: A.faint, ls: 1.2 });
  const r = row(c, { name: 'Code', x: 16, y: 40, w: PW - 2 * G - 32, h: 64, gap: 0, justify: 'SPACE_BETWEEN' });
  for (const ch of 'K7QX4M') { const b = box(r, { name: 'Cell', w: 48, h: 64, r: 10, fill: C.surface3 }); text(b, ch, { name: 'Char', y: 14, w: 48, size: 28, weight: 800, align: 'CENTER' }); }
  text(c, 'Address', { name: 'Address label', x: 16, y: 122, size: 12, o: A.faint });
  text(c, 'http://192.168.0.12:7878', { name: 'Address', x: 16, y: 140, size: 15, weight: 700, color: C.accent });
  text(s, 'Paired devices', { x: G, y: 314, size: 18, weight: 800 });
  [['Living-room phone', 'This device · paired 12 Nov 2026'], ['Tablet', 'Paired 3 Oct 2026, 21:14']].forEach(([n, d], i) => {
    const b = box(s, { name: `Device/${n}`, x: G, y: 350 + i * 84, w: PW - 2 * G, h: 76, r: 16, fill: C.white, o: 0.055 });
    const k = box(b, { name: 'Glyph', x: 12, y: 14, w: 48, h: 48, r: 12, fill: C.surface3 });
    icon(k, 'device', { size: 24, x: 12, y: 12, o: 0.85 });
    text(b, n, { name: 'Name', x: 72, y: 15, size: 16, weight: 700 });
    text(b, d, { name: 'Detail', x: 72, y: 39, size: 12, o: A.muted });
    use(b, ICON_BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: PW - 2 * G - 60, y: 14, name: 'Revoke', icon: { Icon: 'trash' } });
  });
  pHeader(s, 'Remote devices');
  chrome(s, 'Settings');
}
{
  const s = phone('P19 Remote devices', 5, 5, 7);
  pRemoteDevices(s);
}
{
  const s = phone('P19b Revoke', 5, 6, 7);
  pRemoteDevices(s);
  rect(s, { name: 'Dim', w: PW, h: PH_, fill: C.ink, o: 0.6 });
  const c = box(s, { name: 'Confirm', x: 8, y: PH_ - 34 - 262, w: PW - 16, h: 262, r: 28, fill: C.surface, o: 0.98, stroke: C.white, so: 0.08, shadow: 30 });
  text(c, 'Revoke Tablet?', { name: 'Title', x: 20, y: 24, size: 20, weight: 800 });
  text(c, 'The device\'s token stops working immediately. Every other paired device keeps working.', { name: 'Body', x: 20, y: 58, w: PW - 56, size: 14, lh: 20, o: A.muted });
  use(c, BUTTON, { kind: 'danger', size: 'M', state: 'rest' }, { x: 20, y: 132, text: { Label: 'Revoke' }, icon: { Icon: 'trash' }, edit: stretch(PW - 56) });
  use(c, BUTTON, { kind: 'secondary', size: 'M', state: 'rest' }, { x: 20, y: 192, text: { Label: 'Cancel' }, hide: ['Icon'], edit: stretch(PW - 56) });
  rect(s, { name: 'Home indicator', x: (PW - 134) / 2, y: PH_ - 13, w: 134, h: 5, r: 3 });
}
{
  const s = phone('P20 About', 5, 7, 7);
  const t = box(s, { name: 'TMDB credit', x: G, y: 116, w: PW - 2 * G, h: 112, r: 16, fill: C.white, o: 0.055 });
  const m = tmdbMark(t, 16, 18); m.rescale(0.7);
  text(t, 'This product uses the TMDB API but is not endorsed or certified by TMDB', { name: 'Notice', x: 16, y: 56, w: PW - 2 * G - 32, size: 13, lh: 18, o: A.muted });
  pFacts(s, 244, [['streamingapp', 'v0.1.628']]);
  text(s, 'Licences', { x: G, y: 320, size: 18, weight: 800 });
  text(s, 'streamingapp is free software, released under the GNU General Public License, version 3 or later (GPL-3.0-or-later). Playback uses mpv (libmpv), whose default build is GPLv2 or later, linked in-process so the video surface stays mpv\'s own.', { x: G, y: 352, w: PW - 2 * G, size: 14, lh: 21, o: A.muted });
  pHeader(s, 'About/Credits');
  chrome(s, 'Settings');
}

figma.currentPage = pageS;
return { screens: pageS.children.map((n) => n.name), sheets: pageC.children.map((n) => n.name), icons: Object.keys(ICONS).length, keepLinks: KEEP };
