'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

const { api, env } = load();

test('valToFrac: ikke-lineær skala, 0 til 1000 Mbit/s over åtte like store trinn', () => {
  const expected = { 0: 0, 5: 1 / 8, 10: 2 / 8, 25: 3 / 8, 50: 4 / 8, 100: 5 / 8, 250: 6 / 8, 500: 7 / 8, 1000: 1 };
  for (const [v, f] of Object.entries(expected)) assert.ok(Math.abs(api.valToFrac(+v) - f) < 1e-12, `${v} Mbit/s → ${api.valToFrac(+v)}, forventet ${f}`);
});

test('valToFrac: mellomverdier ligger mellom merkene, og verdier utenfor skalaen klemmes', () => {
  assert.ok(Math.abs(api.valToFrac(75) - (4 + 0.5) / 8) < 1e-12, '75 ligger midt mellom 50 og 100');
  assert.equal(api.valToFrac(-10), 0);
  assert.equal(api.valToFrac(5000), 1);
  assert.equal(api.valToFrac(Infinity), 1);
  assert.equal(api.valToFrac(NaN), 0, 'ugyldig verdi (f.eks. 0/0 rett etter start) skal gi 0, ikke fullt utslag');
});

test('valToFrac stiger jevnt: aldri nedover når farten øker', () => {
  let prev = -1;
  for (let v = 0; v <= 1000; v += 0.5) { const f = api.valToFrac(v); assert.ok(f >= prev, `faller ved ${v}`); prev = f; }
});

test('pt: punkt på sirkelen, 0° er rett opp', () => {
  const [x, y] = api.pt(0, 120);
  assert.ok(Math.abs(x - 160) < 1e-9 && Math.abs(y - 40) < 1e-9, `0° → ${x},${y}`);
  const [x2, y2] = api.pt(90, 120);
  assert.ok(Math.abs(x2 - 280) < 1e-9 && Math.abs(y2 - 160) < 1e-9);
});

test('arcPath: lang bue (over 180°) for fullt utslag, kort bue for halvt', () => {
  assert.match(api.arcPath(1), /^M[\d.\-]+ [\d.\-]+ A120 120 0 1 1 [\d.\-]+ [\d.\-]+$/);
  assert.match(api.arcPath(0.5), /A120 120 0 0 1 /);
  assert.match(api.arcPath(0.7), /A120 120 0 0 1 /, '168° er en kort bue');
  assert.match(api.arcPath(0.8), /A120 120 0 1 1 /, '192° er en lang bue');
});

test('mbps regner bytes og millisekunder om til Mbit/s', () => {
  assert.equal(api.mbps(1e6, 1000), 8);
  assert.equal(api.mbps(125e6, 1000), 1000);
  assert.equal(api.mbps(0, 500), 0);
  assert.equal(api.mbps(12.5e6, 10000), 10);
});

test('setGauge: tall, nål og bue følger verdien', () => {
  api.setGauge(0);
  assert.equal(env.el('big').textContent, '0.0');
  assert.equal(env.el('arc').getAttribute('d'), '', 'ingen bue ved 0');
  assert.equal(env.el('needle').style.transform, 'rotate(-120deg)');
  api.setGauge(50, 'var(--dl)');
  assert.equal(env.el('big').textContent, '50.0');
  assert.equal(env.el('needle').style.transform, 'rotate(0deg)');
  assert.ok(env.el('arc').getAttribute('d').startsWith('M'));
  assert.equal(env.el('arc').getAttribute('stroke'), 'var(--dl)');
  api.setGauge(99.96);
  assert.equal(env.el('big').textContent, '100.0', 'under 100 vises med én desimal');
  api.setGauge(100);
  assert.equal(env.el('big').textContent, '100', 'fra 100 vises hele tall');
  api.setGauge(936.4);
  assert.equal(env.el('big').textContent, '936');
  assert.equal(env.el('needle').style.transform, 'rotate(' + (-120 + 240 * api.valToFrac(936.4)) + 'deg)');
  api.setGauge(0);
});

test('setGauge tåler ugyldige verdier uten å vise NaN', () => {
  api.setGauge(NaN);
  assert.equal(env.el('big').textContent, '0.0');
  assert.equal(env.el('needle').style.transform, 'rotate(-120deg)');
  assert.equal(env.el('arc').getAttribute('d'), '');
  api.setGauge(Infinity);
  assert.equal(env.el('big').textContent, '0.0', 'uendelig (tid 0 ms) er ingen gyldig måling');
  api.setGauge(2300);
  assert.equal(env.el('big').textContent, '2300', 'ekte målinger over 1 Gbit/s vises, selv om måleren stopper på 1000');
  assert.equal(env.el('needle').style.transform, 'rotate(120deg)');
  api.setGauge(-5);
  assert.equal(env.el('big').textContent, '0.0', 'negative verdier vises som 0');
  api.setGauge(0);
});

test('Måleren tegnes ved oppstart: skala og merker for alle ni verdier', () => {
  const { env: e2 } = load();
  assert.match(e2.el('track').getAttribute('d'), /^M/);
  const ticks = e2.el('ticks').innerHTML;
  for (const m of [0, 5, 10, 25, 50, 100, 250, 500, 1000]) assert.match(ticks, new RegExp(`>${m}</text>`), `merke ${m} mangler`);
  assert.equal(e2.el('big').textContent, '0.0');
});
