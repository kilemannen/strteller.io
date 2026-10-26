'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, settle, flush } = require('./load');

/* ---------- Simulert nettverk ---------- */
// ping: hver forespørsel tar delays[i] ms. Går tom for forsinkelser → nettverksfeil.
function netFake(E, { pings = [], status = 200, downMs = 10, xhrMs = 1000, xhrStatus = 200, downFail = false } = {}) {
  const sizes = []; let pi = 0;
  const fetch = async (url) => {
    const m = /__down\?bytes=(\d+)/.exec(url);
    if (!m) return { ok: false, json: async () => ({}), text: async () => '' };
    const bytes = +m[1];
    if (bytes === 0) {
      const d = pings[pi++];
      if (d == null) throw new TypeError('nettverksfeil');
      E.e.setNow(E.e.now() + d);
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (downFail) return { ok: false, status, body: { cancel: async () => {} } };
    sizes.push(bytes);
    let left = bytes;
    return {
      ok: true, status: 200,
      body: { getReader: () => ({ read: () => new Promise(res => setImmediate(() => {
        if (left <= 0) return res({ done: true });
        const n = Math.min(1e6, left); left -= n;
        E.e.advance(downMs);
        res({ done: false, value: { length: n } });
      })) }) },
    };
  };
  const xhrs = [];
  class XHR {
    constructor() { this.upload = {}; xhrs.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    send(blob) {
      this.blob = blob;
      this.timer = E.e.sandbox.setTimeout(() => { this.status = xhrStatus; if (this.onload) this.onload(); }, xhrMs);
    }
    abort() { this.aborted = true; E.e.sandbox.clearTimeout(this.timer); }
  }
  return { fetch, XMLHttpRequest: XHR, sizes, xhrs };
}
function boot(net, opts = {}) {
  const E = {};
  const n = net(E);
  Object.assign(E, load({ fetch: n.fetch, XMLHttpRequest: n.XMLHttpRequest, navigator: { onLine: true, connection: { type: 'wifi', addEventListener() {} } }, ...opts }));
  E.e = E.env;
  return { ...E, net: n, E };
}
const sig = () => new AbortController();

/* ---------- Ping ---------- */
test('Ping: median av målingene etter den første, og jitter som snitt av forskjellen mellom påfølgende', async () => {
  const { api, env } = boot(E => netFake(E, { pings: [80, 20, 22, 20, 22, 20, 22, 20, 22, 20, 22] }));
  const r = await settle(api.measurePing(api.SRV, sig().signal), env);
  assert.equal(r.ping, 22);
  assert.equal(r.jitter, 2);
});

test('Ping: første måling (oppkobling) forkastes selv om den er den tregeste', async () => {
  const { api, env } = boot(E => netFake(E, { pings: [900, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] }));
  const r = await settle(api.measurePing(api.SRV, sig().signal), env);
  assert.equal(r.ping, 10);
  assert.equal(r.jitter, 0);
});

test('Ping: tåler noen feil underveis og bruker de som lykkes', async () => {
  let kall = 0;
  const { api, env } = boot(E => {
    const n = netFake(E, { pings: [50, 30, 30, 30, 30, 30, 30, 30] });
    const orig = n.fetch;
    n.fetch = async url => { if (/bytes=0/.test(url) && ++kall % 4 === 0) throw new TypeError('hikke'); return orig(url); };
    return n;
  });
  const r = await settle(api.measurePing(api.SRV, sig().signal), env);
  assert.equal(r.ping, 30);
});

test('Ping: færre enn tre svar gir LimitError med beskjed om å vente', async () => {
  const { api, env } = boot(E => netFake(E, { pings: [40, 40] }));
  await assert.rejects(settle(api.measurePing(api.SRV, sig().signal), env), e => {
    assert.equal(e.name, 'LimitError');
    assert.equal(e.message, api.LIMIT_MSG);
    assert.equal(e.detail, 'Ping: fikk ikke svar');
    return true;
  });
});

test('Ping: avbrutt test gir AbortError med en gang', async () => {
  const { api, env } = boot(E => { const n = netFake(E, {}); const o = n.fetch; n.fetch = async u => { if (/bytes=0/.test(u)) { const e = new Error('avbrutt'); e.name = 'AbortError'; throw e; } return o(u); }; return n; });
  await assert.rejects(settle(api.measurePing(api.SRV, sig().signal), env), e => e.name === 'AbortError');
});

/* ---------- Nedlasting ---------- */
test('Nedlasting: regner ut farten fra mottatte bytes og tid, og øker størrelsen 1 → 5 → 25 MB', async () => {
  const { api, env, net } = boot(E => netFake(E, { downMs: 10 }));
  const mbit = await settle(api.measureDown(api.SRV, sig().signal), env, 0);
  assert.ok(mbit > 760 && mbit < 840, `forventet ca. 800 Mbit/s (1 MB per 10 ms), fikk ${mbit}`);
  assert.deepEqual([...new Set(net.sizes)].sort((a, b) => a - b), [1e6, 5e6, 25e6]);
  assert.ok(Math.max(...net.sizes) <= api.CHUNK, 'aldri større biter enn 25 MB');
  assert.equal(net.sizes.slice(0, 4).every(s => s === 1e6), true, 'alle strømmer starter på 1 MB');
  assert.match(env.el('rDl').textContent, /^\d+\.\d$/, 'avlesningen oppdateres underveis');
});

test('Nedlasting: bruker fire parallelle strømmer', async () => {
  const { api, env, net } = boot(E => netFake(E, {}));
  const p = api.measureDown(api.SRV, sig().signal);
  await flush();
  assert.equal(net.sizes.length, api.STREAMS);
  await settle(p, env, 0);
});

test('Nedlasting: HTTP 429 på alle forsøk gir LimitError med detaljer', async () => {
  const { api, env } = boot(E => netFake(E, { downFail: true, status: 429 }));
  await assert.rejects(settle(api.measureDown(api.SRV, sig().signal), env), e => {
    assert.equal(e.name, 'LimitError');
    assert.match(e.detail, /^Nedlasting: .*HTTP 429 ved 1 MB/);
    return true;
  });
});

test('Nedlasting: stopp midt i målingen gir AbortError og ingen hengende strømmer', async () => {
  const { api, env } = boot(E => netFake(E, {}));
  const ctl = sig();
  const p = api.measureDown(api.SRV, ctl.signal);
  await flush(); await flush();
  ctl.abort();
  await assert.rejects(settle(p, env, 0), e => e.name === 'AbortError');
});

/* ---------- Opplasting ---------- */
test('Opplasting: tre strømmer, fartsberegning fra ferdige biter, og ingen nye biter etter slutt', async () => {
  // 1,1 s per bit: ni ferdige biter per strøm innen 10 s (den tiende ville blitt ferdig først etter 11 s)
  const { api, env, net } = boot(E => netFake(E, { xhrMs: 1100 }));
  const p = api.measureUp(api.SRV, sig().signal);
  assert.equal(net.xhrs.length, api.UPSTREAMS);
  const mbit = await settle(p, env, 100);
  const blob = Math.ceil(api.UPCHUNK / 65536) * 65536;
  const forventet = 3 * 9 * blob * 8 / 10000 / 1000;
  assert.ok(Math.abs(mbit - forventet) < 1, `forventet ca. ${forventet.toFixed(1)}, fikk ${mbit}`);
  assert.ok(net.xhrs.every(x => x.method === 'POST' && /__up\?r=/.test(x.url)));
  assert.match(env.el('rUl').textContent, /^\d+\.\d$/);
  const open = net.xhrs.filter(x => !x.aborted && x.status === undefined);
  assert.equal(open.length, 0, 'alle åpne forespørsler er avbrutt når målingen er ferdig');
});

test('Opplasting: feil på alle forsøk gir LimitError med HTTP-status', async () => {
  const { api, env } = boot(E => netFake(E, { xhrMs: 100, xhrStatus: 500 }));
  await assert.rejects(settle(api.measureUp(api.SRV, sig().signal), env), e => {
    assert.equal(e.name, 'LimitError');
    assert.match(e.detail, /^Opplasting: .*HTTP 500/);
    return true;
  });
});

test('Opplasting: stopp avbryter alle forespørsler og gir AbortError', async () => {
  const { api, env, net } = boot(E => netFake(E, { xhrMs: 5000 }));
  const ctl = sig();
  const p = api.measureUp(api.SRV, ctl.signal);
  env.advance(1000);
  ctl.abort();
  await assert.rejects(p, e => e.name === 'AbortError');
  assert.ok(net.xhrs.every(x => x.aborted));
});

test('waitOrAbort: venter hele tiden, men avbrytes umiddelbart ved stopp', async () => {
  const { api, env } = boot(E => netFake(E, {}));
  let ferdig = false;
  const ctl = sig();
  api.waitOrAbort(5000, ctl.signal).then(() => { ferdig = true; });
  env.advance(4000); await flush();
  assert.equal(ferdig, false);
  ctl.abort(); await flush();
  assert.equal(ferdig, true);
});

/* ---------- Hele testen via Start-knappen ---------- */
async function until(cond, env, step = 50, max = 4000) {
  for (let i = 0; i < max && !cond(); i++) { await flush(); env.advance(step); }
  await flush();
  if (!cond()) throw new Error('betingelsen ble aldri oppfylt');
}
const GOOD = E => netFake(E, { pings: [60, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], downMs: 10, xhrMs: 1000 });

test('Full test: ping, ned og opp vises, resultatet lagres, og knappen får pause', async () => {
  const { api, env } = boot(GOOD);
  env.el('go').click();
  assert.equal(api.running, true);
  assert.equal(env.el('go').textContent, 'Stopp');
  assert.equal(env.el('rPing').textContent, '0', 'ping settes til 0 ved start');
  await until(() => !api.running, env);
  assert.equal(env.el('phase').textContent, 'Ferdig');
  assert.equal(env.el('rPing').textContent, '20');
  assert.equal(env.el('rJit').textContent, '0.0');
  assert.ok(+env.el('rDl').textContent > 100, `ned: ${env.el('rDl').textContent}`);
  assert.ok(+env.el('rUl').textContent > 200 && +env.el('rUl').textContent < 280, `opp: ${env.el('rUl').textContent}`);
  assert.equal(env.el('big').textContent, '0.0', 'nål og stort tall tilbake til 0 etter målingen');
  const saved = JSON.parse(env.storage.get('linjemaler.last'));
  assert.equal(saved.ping, 20); assert.equal(saved.jitter, 0);
  assert.ok(saved.dl > 100 && saved.ul > 200);
  assert.match(env.el('when').textContent, /^Siste måling i dag kl\. \d{2}[:.]\d{2}$/);
  // pause
  env.advance(300);
  assert.match(env.el('go').textContent, /^Klar om \d+ s$/);
  assert.equal(env.el('go').disabled, true);
  env.advance(api.COOLDOWN * 1000 + 500);
  assert.equal(env.el('go').textContent, 'Start');
  assert.equal(env.el('go').disabled, false);
});

test('Stopp midt i en test: melding, og kort pause på 10 sekunder', async () => {
  const { api, env } = boot(GOOD);
  env.el('go').click();
  await until(() => env.el('phase').textContent === 'Nedlasting', env);
  env.el('go').click();
  await until(() => !api.running, env);
  assert.equal(env.el('log').textContent, 'Testen ble stoppet.');
  assert.ok(env.el('log').classList.contains('err'));
  assert.equal(env.el('phase').textContent, 'Klar');
  env.advance(300);
  assert.equal(env.el('go').textContent, `Klar om ${api.STOP_COOLDOWN} s`);
});

test('Cloudflare begrenser oss: forklaring med detaljer og 60 sekunders pause', async () => {
  const { api, env } = boot(E => netFake(E, { pings: [] }));
  env.el('go').click();
  await until(() => !api.running, env);
  assert.match(env.el('log').textContent, /Fikk ikke kontakt med Cloudflare/);
  assert.match(env.el('log').textContent, /\nDetaljer: Ping: fikk ikke svar$/);
  assert.ok(env.el('log').classList.contains('err'));
  env.advance(300);
  assert.equal(env.el('go').textContent, 'Klar om 60 s');
});

test('Start under pausen gjør ingenting', async () => {
  const { api, env, net } = boot(GOOD);
  env.el('go').click();
  await until(() => !api.running, env);
  const før = net.sizes.length;
  env.el('go').click();
  await flush();
  assert.equal(api.running, false);
  assert.equal(net.sizes.length, før);
});

test('Bytte til mobilnett under testen stopper den med forklaring', async () => {
  const handlers = {}, conn = { type: 'wifi', addEventListener: (t, f) => { handlers[t] = f; } };
  const { api, env } = boot(GOOD, { navigator: { onLine: true, connection: conn } });
  env.el('go').click();
  await until(() => env.el('phase').textContent === 'Nedlasting', env);
  conn.type = 'cellular';
  handlers.change();
  await until(() => !api.running, env);
  assert.equal(env.el('log').textContent, 'Byttet til mobilnett – testen ble stoppet.');
  assert.ok(env.el('status').classList.contains('bad'));
});

test('Mister WiFi-bekreftelsen etter nedlasting: opplasting startes ikke', async () => {
  const conn = { type: 'wifi', addEventListener() {} };
  const { api, env, net } = boot(GOOD, { navigator: { onLine: true, connection: conn } });
  env.el('go').click();
  await until(() => env.el('phase').textContent === 'Nedlasting', env);
  conn.type = undefined; // nettleseren slutter å oppgi type, uten change-hendelse
  await until(() => !api.running, env);
  assert.equal(env.el('log').textContent, 'Feil: Tilkoblingen er ikke lenger WiFi/kabel');
  assert.equal(net.xhrs.length, 0, 'ingen opplasting ble startet');
});

/* ---------- Siste måling ---------- */
test('Siste måling vises fra lagring, med dato når den ikke er fra i dag', () => {
  const nå = Date.UTC(2026, 9, 26, 12, 0, 0);
  const gårsdag = nå - 26 * 3600000;
  const { env } = load({ now: nå, storage: { 'linjemaler.last': JSON.stringify({ ping: 12.4, jitter: 1.26, dl: 345.67, ul: 89.01, t: gårsdag }) } });
  assert.equal(env.el('rPing').textContent, '12');
  assert.equal(env.el('rJit').textContent, '1.3');
  assert.equal(env.el('rDl').textContent, '345.7');
  assert.equal(env.el('rUl').textContent, '89.0');
  assert.match(env.el('when').textContent, /^Siste måling \d{1,2}\.\d{1,2}\.\d{4} kl\. \d{2}[:.]\d{2}$/);
});

test('Siste måling uten jitter (eldre versjoner) viser «–», og tom eller skadet lagring gir «Ingen målinger ennå»', () => {
  const old = load({ storage: { 'linjemaler.last': JSON.stringify({ ping: 20, dl: 50, ul: 10, t: Date.UTC(2026, 9, 26, 11, 0, 0) }) } });
  assert.equal(old.env.el('rJit').textContent, '–');
  assert.match(old.env.el('when').textContent, /^Siste måling i dag/);
  for (const storage of [{}, { 'linjemaler.last': 'ikke json' }]) {
    const r = load({ storage });
    assert.equal(r.env.el('when').textContent, 'Ingen målinger ennå');
    assert.equal(r.env.el('rDl').textContent, '–');
  }
});

test('Lagring som feiler stopper ikke appen', async () => {
  const { api, env } = boot(GOOD, { storageFails: true });
  env.el('go').click();
  await until(() => !api.running, env);
  assert.equal(env.el('phase').textContent, 'Ferdig');
  assert.ok(api.last && api.last.dl > 0, 'resultatet vises fra minnet selv om lagring feilet');
});
