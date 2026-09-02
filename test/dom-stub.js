/* =====================================================================
   test/dom-stub.js — the smallest DOM that lets the app's modules load.

   Not a browser: it exists so the test suite can require every script in
   index.html order and prove (a) nothing throws while wiring up, and
   (b) each module publishes the API surface the others call.
   Canvas 2D is faked well enough for FUJI.CPUEngine to run its real math.
   ===================================================================== */
'use strict';

const vm = require('node:vm');

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force == null ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  toString() { return [...this.set].join(' '); }
}

class FakeStyle {
  constructor() { this._props = {}; }
  setProperty(k, v) { this._props[k] = v; }
  getPropertyValue(k) { return this._props[k] || ''; }
}

class FakeCtx {
  constructor(canvas, attrs) {
    this.canvas = canvas;
    this.attrs = attrs || null;
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'high';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.filter = 'none';
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.font = '';
    this.textAlign = '';
    this.lineWidth = 1;
    this.__ops = 0;
    this.__last = null;      // last putImageData (what scratch canvases hold)
    this.__drawn = null;      // last image handed to drawImage, normalised
  }
  _dims() {
    const w = Math.max(1, this.canvas.width | 0);
    const h = Math.max(1, this.canvas.height | 0);
    return { w, h };
  }
  save() {} restore() {} translate() {} rotate() {} scale() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} rect() {} fill() {} stroke() {} clip() {}
  fillRect() {} clearRect() {} strokeRect() {}
  fillText() {} measureText() { return { width: 10 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  drawImage(img) {
    this.__ops++;
    this.__drawnCount = (this.__drawnCount || 0) + 1;
    // Capture what was painted, whether it is ImageData or another canvas
    // (engines putImageData into a scratch canvas, then draw it here).
    if (img && img.data) this.__drawn = img;
    else if (img && img.getContext && img.__c2d && img.__c2d.__last) this.__drawn = img.__c2d.__last;
  }
  putImageData(img) {
    const { w, h } = this._dims();
    if (img && img.data && img.data.length >= w * h * 4) this.__last = img;
  }
  getImageData(x, y, w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    // deterministic gradient source, so tests can tell "processed" from "copied"
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const t = i / Math.max(1, w * h - 1);
      // a luminance ramp with a mild cool cast: neutral enough for the white
      // balance sampler to accept, uneven enough to prove it did something
      data[p] = Math.round(60 + t * 170);
      data[p + 1] = Math.round(66 + t * 158);
      data[p + 2] = Math.round(76 + t * 145);
      data[p + 3] = 255;
    }
    return { data, width: w, height: h };
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.classList = new ClassList();
    this.dataset = {};
    this.style = new FakeStyle();
    this.attrs = {};
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.width = 0;
    this.height = 0;
    this.files = [];
    this.listeners = {};
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.ids = [...this._html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    if (this._html === '') { this.children = []; this.ids = []; }
  }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(node) { this.children.unshift(node); return node; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() {}
  replaceWith(...nodes) { this.__replacedBy = nodes; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  __setRect(width, height) {
    this.__rect = { left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 };
    return this.__rect;
  }
  click() { (this.listeners.click || []).forEach(fn => fn({ preventDefault() {}, target: this })); }
  closest() { return null; }
  contains() { return false; }
  focus() {} blur() {} scrollIntoView() {}
  getBoundingClientRect() {
    if (this.__rect) return this.__rect;
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
  }
  /* The stub is "universal": element queries resolve to a fresh node so code
     paths run, while id lookups stay strict (see makeDocument) so a missing
     node in index.html can never be mistaken for a pass. */
  querySelector(sel) { return FakeElement._make(this, sel); }
  querySelectorAll(sel) { return [FakeElement._make(this, sel)]; }
  getContext(type, attrs) {
    if (type === '2d') return this.__c2d || (this.__c2d = new FakeCtx(this, attrs));
    if (type === 'webgl2' || type === 'webgl') return this.__gl || null;   // null → CPU engine
    return null;
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb, type, q) {
    this.__toBlobCall = { type: type || 'image/png', quality: q };
    this.__toBlobCount = (this.__toBlobCount || 0) + 1;
    cb(new FakeBlob([Buffer.alloc(Math.max(1, (this.width | 0) * (this.height | 0) * 4))], { type: type || 'image/png' }));
  }
  /* test hooks */
  __fire(type, ev) {
    const e = Object.assign({ preventDefault() {}, stopPropagation() {}, target: this, currentTarget: this }, ev || {});
    (this.listeners[type] || []).forEach(fn => fn(e));
    return (this.listeners[type] || []).length;
  }
  __has(type) { return (this.listeners[type] || []).length > 0; }
}
FakeElement._make = function (parent, sel) {
  const el = new FakeElement(parent ? String(parent.tagName).toLowerCase() : 'div');
  el.__selector = sel;
  return el;
};

class FakeImage {
  constructor() {
    this._src = '';
    this.naturalWidth = 120;
    this.naturalHeight = 80;
    this.width = 120;
    this.height = 80;
    this.onload = null;
    this.onerror = null;
  }
  set src(v) {
    this._src = v;
    setTimeout(() => this.onload && this.onload({ target: this }), 0);
  }
  get src() { return this._src; }
}

class FakeBlob {
  constructor(parts, opts) {
    this.__parts = parts || [];
    this.type = (opts && opts.type) || 'application/octet-stream';
    this.size = this.__parts.reduce((n, p) => n + (p && p.length ? p.length : 64), 0);
  }
  /* Non-binary parts (a blob handed to `new File([blob], …)`) flatten to
     their declared byte length instead of throwing. */
  _buffer() {
    const parts = this.__parts.map(p => {
      if (p == null) return Buffer.alloc(0);
      if (Buffer.isBuffer(p)) return p;
      if (p instanceof ArrayBuffer) return Buffer.from(p);
      if (p.buffer instanceof ArrayBuffer) {
        return Buffer.from(p.buffer.slice(p.byteOffset || 0, (p.byteOffset || 0) + (p.byteLength || 0)));
      }
      return Buffer.alloc(Math.max(0, p.size | 0));
    });
    return Buffer.concat(parts);
  }
  slice(start, end) {
    const buf = this._buffer();
    return new FakeBlob([buf.slice(start | 0, end == null ? buf.length : end | 0)], { type: this.type });
  }
  arrayBuffer() {
    const buf = this._buffer();
    return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
}

class FakeFileReader {
  constructor() { this.result = null; this.onload = null; this.onerror = null; this.error = null; }
  readAsArrayBuffer(blob) {
    Promise.resolve()
      .then(() => blob.arrayBuffer())
      .then(ab => { this.result = ab; this.onload && this.onload({ target: this }); })
      .catch(e => { this.error = e; this.onerror && this.onerror(e); });
  }
  readAsText(blob) {
    Promise.resolve()
      .then(() => blob.arrayBuffer())
      .then(ab => { this.result = Buffer.from(ab).toString('utf8'); this.onload && this.onload({ target: this }); })
      .catch(e => { this.error = e; this.onerror && this.onerror(e); });
  }
}

function makeDocument(knownIds) {
  const doc = new FakeElement('html');
  const cache = new Map();
  doc.readyState = 'loading';
  doc.__knownIds = knownIds || null;
  doc.createElement = (tag) => new FakeElement(tag);
  doc.createTextNode = (t) => { const e = new FakeElement('#text'); e.textContent = t; return e; };
  doc.createDocumentFragment = () => new FakeElement('#fragment');
  doc.getElementById = (id) => {
    if (doc.__knownIds && !doc.__knownIds.has(id)) return null;
    if (!cache.has(id)) { const e = new FakeElement('div'); e.attrs.id = id; cache.set(id, e); }
    return cache.get(id);
  };
  doc.querySelector = (sel) => {
    const m = /^#([\w-]+)$/.exec(sel);
    if (m) return doc.getElementById(m[1]);
    return FakeElement._make(doc, sel);
  };
  doc.querySelectorAll = (sel) => [doc.querySelector(sel)];
  doc.body = new FakeElement('body');
  doc.head = new FakeElement('head');
  doc.documentElement = new FakeElement('html');
  doc.visibilityState = 'visible';
  doc.hidden = false;
  return doc;
}

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    __map: map
  };
}

function makeIndexedDB() {
  const stores = new Map();   // store name -> Map(key -> value)
  function req(result) {
    const r = { result, onsuccess: null, onerror: null };
    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
    return r;
  }
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); return { name: n }; },
    transaction: (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      const tx = {
        objectStore: () => ({
          put: (val, key) => { s.set(key, val); return req(undefined); },
          get: (key) => req(s.has(key) ? s.get(key) : undefined),
          delete: (key) => { s.delete(key); return req(undefined); }
        }),
        oncomplete: null, onerror: null, onabort: null
      };
      // ops are queued synchronously by the caller, so complete on the next tick
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    }
  };
  return {
    open: () => {
      const r = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        if (r.onupgradeneeded) r.onupgradeneeded();
        if (r.onsuccess) r.onsuccess({ target: r });
      }, 0);
      return r;
    }
  };
}

/* Build a `window` with a permissive DOM. Scripts are then evaluated inside
   one shared context, exactly like sequential <script> tags. */
function createWindow({ knownIds } = {}) {
  const win = {};
  win.window = win;
  win.self = win;
  win.document = makeDocument(knownIds);
  win.navigator = { serviceWorker: { register: () => Promise.resolve({}), addEventListener() {} }, userAgent: 'node-test' };
  win.location = { href: 'https://example.test/index.html', origin: 'https://example.test', pathname: '/index.html' };
  win.localStorage = makeLocalStorage();
  win.indexedDB = makeIndexedDB();
  win.Image = FakeImage;
  win.Blob = FakeBlob;
  win.File = class FakeFile extends FakeBlob {
    constructor(parts, name, opts) { super(parts, opts); this.name = name; }
  };
  win.FileReader = FakeFileReader;
  win.__objectUrls = [];
  win.URL = {
    createObjectURL: (b) => { const u = `blob:fake/${win.__objectUrls.length}`; win.__objectUrls.push({ url: u, blob: b, revoked: false }); return u; },
    revokeObjectURL: (u) => { const e = win.__objectUrls.find(x => x.url === u); if (e) e.revoked = true; }
  };
  win.requestAnimationFrame = (fn) => { (win.__raf = win.__raf || []).push(fn); return win.__raf.length; };
  win.cancelAnimationFrame = () => {};
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.screen = { width: 390, height: 844, availWidth: 390, availHeight: 844 };
  win.innerWidth = 390; win.innerHeight = 844; win.devicePixelRatio = 2;
  /* dialogs answered from a scripted queue, so UI flows stay testable */
  win.__answers = { prompt: [], confirm: [] };
  win.prompt = () => (win.__answers.prompt.length ? win.__answers.prompt.shift() : null);
  win.confirm = () => (win.__answers.confirm.length ? win.__answers.confirm.shift() : true);
  win.alert = () => {};
  win.addEventListener = (t, fn) => { win.__listeners = win.__listeners || {}; (win.__listeners[t] = win.__listeners[t] || []).push(fn); };
  win.removeEventListener = () => {};
  win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  win.setInterval = setInterval; win.clearInterval = clearInterval;
  win.console = console;
  win.__fireWindow = (type, ev) => ((win.__listeners || {})[type] || []).forEach(fn => fn(ev || { preventDefault() {} }));
  win.__flushRAF = () => { const q = win.__raf || []; win.__raf = []; q.forEach(fn => fn(Date.now())); };
  win.__tick = (ms = 0) => new Promise(res => setTimeout(res, ms));
  return win;
}

function createContext(win) { return vm.createContext(win); }

/* Evaluate source inside a context (as a browser <script> would). */
function loadScript(ctx, filename, source) {
  vm.runInContext(source, ctx, { filename });
}

/* collect id="..." from an HTML string so getElementById can be strict */
function idsInHtml(html) {
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
}

module.exports = {
  createWindow, createContext, loadScript, idsInHtml,
  FakeElement, FakeCtx, FakeBlob, FakeFileReader, FakeImage, vm
};
