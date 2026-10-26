'use strict';
/* Utgivelsesregler: versjonen skal være lik overalt, og endringsloggen skal starte med gjeldende versjon. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const V = pkg.version;

test('Versjon i overskriften, skriptkommentaren og VERSION er lik package.json', () => {
  assert.match(html, new RegExp(`vertical-align:middle">v${V.replace(/\./g, '\\.')}</span>`), 'overskriften');
  assert.match(html, new RegExp(`/\\* Størrelsen teller v${V.replace(/\./g, '\\.')}`), 'skriptkommentaren');
  assert.match(html, new RegExp(`const VERSION = "${V.replace(/\./g, '\\.')}";`), 'VERSION');
});

test('Endringsloggen i skriptet starter med gjeldende versjon', () => {
  const m = /\n\s{3}(\d+\.\d+\.\d+)\s{2}\S/.exec(html);
  assert.ok(m, 'fant ikke endringsloggen');
  assert.equal(m[1], V);
});

test('Endringsloggen er sortert nyeste først', () => {
  const list = [...html.matchAll(/\n\s{3}(\d+)\.(\d+)\.(\d+)\s{2}\S/g)].map(m => m.slice(1).map(Number));
  assert.ok(list.length >= 8);
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1], list[i]];
    const nyere = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
    assert.ok(nyere, `rekkefølgen er feil: ${a.join('.')} før ${b.join('.')}`);
  }
});

test('README har versjonsliste med gjeldende versjon øverst', () => {
  const m = /## Versjoner\s+- \*\*(\d+\.\d+\.\d+)\*\*/.exec(readme);
  assert.ok(m, 'README mangler «## Versjoner»');
  assert.equal(m[1], V);
});
