'use strict';
/* Testoppsett v1.0.0
   Laster appens eget <script> uendret inn i en simulert nettleser (node:vm), så testene
   kjører mot nøyaktig den koden som ligger i index.html. Ingen avhengigheter.

   loadApp(htmlFil, navn, valg) -> { api, env }
     api  gir lese-/skrivetilgang til variabler og funksjoner på toppnivå i skriptet (de som er listet i `navn`)
     env  gir klokke (advance/setNow), elementer (el), lagring og logg fra den simulerte nettleseren
*/
const fs = require('node:fs');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...a) { a.forEach(x => this.s.add(x)); }
  remove(...a) { a.forEach(x => this.s.delete(x)); }
  toggle(c, force) { const on = force === undefined ? !this.s.has(c) : !!force; if (on) this.s.add(c); else this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id; this._text = ''; this._html = ''; this.value = ''; this.hidden = false;
    this.disabled = false; this.checked = false; this.href = ''; this.style = {}; this.dataset = {};
    this.classList = new FakeClassList(); this.children = []; this.tabIndex = 0;
    this._attrs = new Map(); this._ls = new Map();
  }
  // som i en ekte nettleser blir tekst alltid til streng
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v ?? ''); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v ?? ''); }
  get className() { return [...this.classList.s].join(' '); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  removeAttribute(k) { this._attrs.delete(k); }
  hasAttribute(k) { return this._attrs.has(k); }
  addEventListener(t, fn) { if (!this._ls.has(t)) this._ls.set(t, []); this._ls.get(t).push(fn); }
  removeEventListener(t, fn) { const l = this._ls.get(t); if (l) this._ls.set(t, l.filter(f => f !== fn)); }
  dispatch(t, ev = {}) {
    if (ev.target === undefined) ev.target = this;
    if (!ev.preventDefault) ev.preventDefault = () => {};
    for (const f of [...(this._ls.get(t) || [])]) f(ev);
    if (typeof this['on' + t] === 'function') this['on' + t](ev);
  }
  click() { this.dispatch('click'); }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(c) { this.children.push(c); return c; }
  insertAdjacentHTML(_where, html) { this._html += html; }
  focus() { this.focused = true; } blur() {} select() {} remove() {}
}

function createEnv(opts = {}) {
  const clock = { now: opts.now ?? Date.UTC(2026, 9, 26, 12, 0, 0), t0: opts.now ?? Date.UTC(2026, 9, 26, 12, 0, 0), timers: [], seq: 1 };
  const els = new Map();
  const hiddenIds = new Set(opts.hiddenIds || []);
  const getEl = id => { if (!els.has(id)) { const e = new FakeElement(id); e.hidden = hiddenIds.has(id); els.set(id, e); } return els.get(id); };
  const selectors = new Map();
  const storage = new Map(Object.entries(opts.storage || {}));
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { if (opts.storageFails) throw new Error('lagring ikke tilgjengelig'); storage.set(k, String(v)); },
    removeItem: k => { storage.delete(k); },
  };
  class FDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  const addTimer = (fn, ms, every) => { const id = clock.seq++; clock.timers.push({ id, at: clock.now + (ms || 0), fn, every }); return id; };
  const clearTimer = id => { clock.timers = clock.timers.filter(t => t.id !== id); };
  const advance = ms => {
    const target = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.now = Math.max(clock.now, due.at);
      if (due.every != null) due.at = clock.now + Math.max(1, due.every); else clearTimer(due.id);
      due.fn();
    }
    clock.now = target;
  };
  const document = new FakeElement('document');
  document.getElementById = getEl;
  document.querySelector = sel => { if (!selectors.has(sel)) selectors.set(sel, new FakeElement(sel)); return selectors.get(sel); };
  document.createElement = tag => { const e = new FakeElement(); e.tagName = String(tag).toUpperCase(); return e; };
  document.documentElement = new FakeElement('html');
  document.body = new FakeElement('body');
  document.title = '';
  const revoked = []; let blobSeq = 0;
  class FURL extends URL {
    static createObjectURL() { return 'blob:fake-' + (++blobSeq); }
    static revokeObjectURL(u) { revoked.push(u); }
  }
  const winEvents = new FakeElement('window');
  const sandbox = {
    console, Math, JSON, Intl, Promise, Symbol, Object, Array, Number, String, Boolean, RegExp, Error, TypeError, Map, Set, WeakMap,
    isFinite, isNaN, parseFloat, parseInt, Uint8Array, ArrayBuffer, encodeURIComponent, decodeURIComponent,
    AbortController, DOMException, Blob, crypto: globalThis.crypto, URL: FURL,
    Date: FDate, document, localStorage,
    navigator: opts.navigator || { onLine: true },
    location: opts.location || { protocol: 'https:', hash: '', href: 'https://example.test/' },
    matchMedia: () => ({ matches: !!opts.standalone, addEventListener() {} }),
    setTimeout: (fn, ms) => addTimer(fn, ms, null),
    setInterval: (fn, ms) => addTimer(fn, ms, ms),
    clearTimeout: clearTimer, clearInterval: clearTimer,
    requestAnimationFrame: fn => addTimer(fn, 16, null), cancelAnimationFrame: clearTimer,
    performance: { now: () => clock.now - clock.t0 },
    fetch: opts.fetch || (async () => { throw new TypeError('ingen nett i test'); }),
    XMLHttpRequest: opts.XMLHttpRequest,
    MediaMetadata: class { constructor(o) { Object.assign(this, o); } },
    indexedDB: opts.indexedDB,
    addEventListener: (t, fn) => winEvents.addEventListener(t, fn),
    isSecureContext: opts.isSecureContext ?? true,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = opts.framed ? {} : sandbox; sandbox.globalThis = sandbox;
  return {
    sandbox,
    clock,
    advance,
    setNow: ms => { clock.now = ms; },
    now: () => clock.now,
    el: getEl,
    document,
    storage,
    revoked,
    winEvents,
    pendingTimers: () => clock.timers.length,
  };
}

/* Henter siste inline-<script> (uten src) fra en HTML-fil */
function readInlineScript(file, index = -1) {
  const html = fs.readFileSync(file, 'utf8');
  const all = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!all.length) throw new Error('Fant ingen inline-script i ' + file);
  return index < 0 ? all[all.length + index] : all[index];
}

/* Elementer som har attributtet `hidden` i HTML-en, slik at de starter skjult som i en ekte nettleser */
function hiddenIdsIn(file) {
  const html = fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const ids = [];
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0], id = /\sid="([^"]+)"/.exec(tag);
    if (id && /\shidden(?=[\s>=])/.test(tag.replace(/"[^"]*"/g, '""'))) ids.push(id[1]);
  }
  return ids;
}

function loadApp(htmlFile, names, opts = {}) {
  const src = readInlineScript(htmlFile, opts.scriptIndex ?? -1);
  const env = createEnv({ hiddenIds: hiddenIdsIn(htmlFile), ...opts });
  const exportCode = '\n;globalThis.__api = {};\n' + names.map(n =>
    `Object.defineProperty(globalThis.__api, ${JSON.stringify(n)}, { get() { return ${n}; }, set(v) { ${n} = v; }, enumerable: true, configurable: true });`
  ).join('\n');
  const ctx = vm.createContext(env.sandbox);
  vm.runInContext(src + exportCode, ctx, { filename: htmlFile });
  return { api: ctx.__api, env, ctx };
}

module.exports = { loadApp, createEnv, readInlineScript, hiddenIdsIn, FakeElement };
