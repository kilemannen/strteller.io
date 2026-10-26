'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, flush } = require('./load');

const withConn = (type, extra = {}) => load({ navigator: { onLine: true, connection: type ? { type, addEventListener() {} } : undefined, ...extra } });

test('connState: WiFi og kabel er tillatt, mobil og offline er det ikke', () => {
  assert.equal(withConn('wifi').api.connState(), 'fixed');
  assert.equal(withConn('ethernet').api.connState(), 'fixed');
  assert.equal(withConn('cellular').api.connState(), 'mobile');
  assert.equal(withConn('wimax').api.connState(), 'mobile');
  assert.equal(withConn('bluetooth').api.connState(), 'mobile');
  assert.equal(withConn(undefined).api.connState(), 'unknown', 'nettleseren oppgir ikke type');
  assert.equal(withConn('other').api.connState(), 'unknown');
  assert.equal(load({ navigator: { onLine: false, connection: { type: 'wifi' } } }).api.connState(), 'offline');
});

test('Status og knapp: WiFi → grønn og Start er klikkbar', () => {
  const { env } = withConn('wifi');
  assert.ok(env.el('status').classList.contains('ok'));
  assert.equal(env.el('statusText').textContent, 'WiFi tilkoblet – klar til test');
  assert.equal(env.el('go').disabled, false);
});

test('Status og knapp: kabel gir egen tekst', () => {
  const { env } = withConn('ethernet');
  assert.equal(env.el('statusText').textContent, 'Kablet nett tilkoblet – klar til test');
  assert.equal(env.el('go').disabled, false);
});

test('Status og knapp: mobilnett sperrer testen', () => {
  const { env, api } = withConn('cellular');
  assert.ok(env.el('status').classList.contains('bad'));
  assert.match(env.el('statusText').textContent, /Mobilnett .* sperret/);
  assert.equal(env.el('go').disabled, true);
  assert.equal(api.allowed(), false);
});

test('Status og knapp: uten nett sperres testen med egen melding', () => {
  const { env } = load({ navigator: { onLine: false } });
  assert.equal(env.el('statusText').textContent, 'Ingen nettverkstilkobling');
  assert.equal(env.el('go').disabled, true);
});

test('Ukjent tilkobling: brukeren må bekrefte WiFi/kabel før Start åpnes', () => {
  const { env, api } = withConn(undefined);
  assert.ok(env.el('status').classList.contains('warn'));
  assert.match(env.el('statusText').innerHTML, /Jeg er på WiFi eller kablet nett/);
  assert.equal(env.el('go').disabled, true);
  assert.equal(api.allowed(), false);
  env.el('confirm').dispatch('change', { target: { checked: true } });
  assert.equal(api.confirmedFixed, true);
  assert.equal(api.allowed(), true);
  assert.equal(env.el('go').disabled, false);
  env.el('confirm').dispatch('change', { target: { checked: false } });
  assert.equal(env.el('go').disabled, true);
});

test('Bekreftelse hjelper ikke på mobilnett', () => {
  const { api } = withConn('cellular');
  api.confirmedFixed = true;
  assert.equal(api.allowed(), false);
});

test('Start gjør ingenting når tilkoblingen ikke er tillatt', async () => {
  let kall = 0;
  const { env, api } = load({ navigator: { onLine: true, connection: { type: 'cellular', addEventListener() {} } }, fetch: async () => { kall++; throw new TypeError('x'); } });
  await flush(); await flush();
  const før = kall; // serverinfo (meta og trace) er ferdig hentet
  env.el('go').dispatch('click');
  await flush();
  assert.equal(kall, før, 'ingen målinger startet');
  assert.equal(api.running, false);
  assert.notEqual(env.el('go').textContent, 'Stopp');
});

test('Serverinfo: viser sted, leverandør og IP fra Cloudflare', async () => {
  const meta = { colo: 'OSL', city: 'Oslo', clientIp: '203.0.113.7', asOrganization: 'Telenor Norge AS', asn: 2119 };
  const { env } = load({ fetch: async url => ({ ok: true, json: async () => meta, text: async () => '' }) });
  await flush(); await flush();
  assert.equal(env.el('iSrv').textContent, 'Cloudflare · Oslo (OSL)');
  assert.equal(env.el('iIsp').textContent, 'Telenor Norge AS · AS2119');
  assert.equal(env.el('iIp').textContent, '203.0.113.7');
});

test('Serverinfo: bruker trace-teksten når meta mangler, og «Ukjent» når alt feiler', async () => {
  const trace = 'fl=1\nip=198.51.100.9\ncolo=BGO\nloc=NO';
  const a = load({ fetch: async url => /\/meta$/.test(url) ? ({ ok: false, json: async () => ({}) }) : ({ ok: true, text: async () => trace }) });
  await flush(); await flush(); await flush();
  assert.equal(a.env.el('iSrv').textContent, 'Cloudflare · (BGO)'.replace(' · (BGO)', ' · (BGO)'));
  assert.equal(a.env.el('iIp').textContent, '198.51.100.9');
  const b = load();
  await flush(); await flush(); await flush();
  assert.equal(b.env.el('iSrv').textContent, 'Cloudflare');
  assert.equal(b.env.el('iIsp').textContent, 'Ukjent');
  assert.equal(b.env.el('iIp').textContent, 'Ukjent');
});
