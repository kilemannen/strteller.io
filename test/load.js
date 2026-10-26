'use strict';
const path = require('node:path');
const { loadApp } = require('./harness');

const HTML = path.join(__dirname, '..', 'index.html');
const NAMES = [
  'VERSION', 'SRV', 'MARKS', 'STREAMS', 'UPSTREAMS', 'DURATION', 'CHUNK', 'UPCHUNK', 'COOLDOWN', 'STOP_COOLDOWN', 'LIMIT_MSG',
  'valToFrac', 'pt', 'arcPath', 'setGauge', 'mbps', 'connState', 'allowed', 'renderStatus', 'updateButton',
  'log', 'abortTest', 'note', 'diag', 'LimitError', 'waitOrAbort', 'measurePing', 'measureDown', 'measureUp', 'runTest',
  'saveLast', 'showLast', 'startCooldown', 'loadInfo',
  'running', 'confirmedFixed', 'last', 'cooldownUntil', 'abortCtl',
];

function load(opts = {}) { return loadApp(HTML, NAMES, opts); }

/* Lar simulert tid gå mens løfter avgjøres: venter på at p blir ferdig og spoler klokka i små steg */
async function settle(p, env, step = 100, max = 2000) {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < max && !done; i++) { await new Promise(r => setImmediate(r)); env.advance(step); }
  await new Promise(r => setImmediate(r));
  if (!done) throw new Error('løftet ble aldri ferdig i simulert tid');
  return p;
}
const flush = () => new Promise(r => setImmediate(r));
const plain = x => JSON.parse(JSON.stringify(x));

module.exports = { load, settle, flush, plain, HTML, NAMES };
