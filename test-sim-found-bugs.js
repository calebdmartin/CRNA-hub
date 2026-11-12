'use strict';
// SIMULATED-USER PASS — FOUND BUGS, pinned on purpose.
// These checks describe CORRECT behavior and currently FAIL.
// They are not regressions and they are not suite noise: each is
// a real defect a persona journey exposed, reproduced minimally.
// A round that fixes one will see its pin PASS here — when that
// happens this file exits 3 and the runner shouts: promote the
// pin into the owning persona/suite and delete it here.
// Exit codes: 0 = every pin still fails as documented (the
// expected state today); 2 = pin state changed unexpectedly;
// 3 = at least one found bug now PASSES (fixed? promote it).
// The runner (test-sim-run-all.js) reports these separately from
// regressions. Found Nov 11, 2026, sim-pass setup round (v138).
//
// PROMOTED (no pins currently open):
// - FB1 (month headline counted W-2 salary) — fixed in v139,
//   pin promoted to test-sim-persona2-w2-sidegig.js.
// - FB2 (no-AI words path lost definitions: 6-hour binding,
//   submit context, prefill round trip) — fixed in v139,
//   pins promoted to test-v135-reader.js section (J).
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) { return { id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [], dataset: {}, style: {}, _listeners: {}, _entries: null, addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }, append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [] }; }
const elements = {}; const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData { constructor(f) { this._map = (f && f._map) || {}; this._e = (f && f._entries) || []; } get(k) { return k in this._map ? this._map[k] : null; } *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; } }
const sandbox = { console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math, crypto: require('crypto').webcrypto, FormData: FakeFormData, localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, document: { getElementById: (id) => getEl(id), querySelectorAll: () => [], createElement: () => el(), body: { append() {} }, addEventListener() {} }, window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' }, alert: () => {}, confirm: () => true, fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }), history: { replaceState() {} } };
sandbox.window = sandbox; sandbox.window.scrollTo = () => {};
if (typeof sandbox.URL.createObjectURL !== 'function') Object.assign(sandbox.URL, { createObjectURL: () => 'data:,', revokeObjectURL: () => {} });
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const J = (v) => JSON.stringify(v);
let stillFailing = 0, nowPassing = 0;
const fb = (id, name, cond, extra) => {
  if (cond) { nowPassing++; console.log(`FOUND-BUG ${id} NOW PASSES — ${name} (promote this pin!)`); }
  else { stillFailing++; console.log(`FOUND-BUG ${id} (expected fail) — ${name} :: ${extra}`); }
};

/* No open pins. Add the next found bug below this line as an
   fb('FBn', ...) block in the style of the promoted ones
   (git history of this file at 9928b24 has both examples). */

console.log(`\n${stillFailing} found bug(s) still failing as documented · ${nowPassing} now passing`);
process.exitCode = nowPassing > 0 ? 3 : 0;
