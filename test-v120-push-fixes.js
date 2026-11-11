// CRNA Hub — v120: push-notification fixes (diagnosis Nov 11, 2026:
// the server held ZERO push_subscriptions and ZERO push_sent_log rows
// for anyone — push claimed "on" on devices the server had never
// heard of).
//
// Proven root cause: api/rest.js — the REST proxy's REST_TABLES
// allowlist was never updated for migration 013, so the client's
// push_subscriptions write got 400 table_not_allowed and the local
// flag was set anyway. Pins:
//  - 'push_subscriptions' is in REST_TABLES (and 'push_sent_log',
//    which the start-over wipe deletes through the same sbReq proxy
//    path — the client never reads it);
//  - enable reads the row BACK and only then claims "on" — a write
//    the server doesn't confirm leaves push OFF with a plain message;
//  - the panel reconciles on open: local-on + no server row shows
//    the plain warning + one-tap re-enable; the panel never shows
//    "✓ Push is on" without a server-confirmed row (incl. while the
//    check is still running);
//  - non-standalone iOS LEADS the panel with the Home Screen step;
//  - the start-over wipe clears push on device ('crna-hub-push') AND
//    server (wipe steps delete push_subscriptions + push_sent_log);
//  - the watchdog `test` action returns per-subscription results and
//    a pruned (410) subscription makes the client say exactly:
//    "Apple says this device's subscription is gone — turn push off
//    and on again." (Pruning behavior itself unchanged.)
// Run: node test-v120-push-fixes.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

// ---------------- source pins ----------------
const restSrc = fs.readFileSync(R + 'api/rest.js', 'utf8');
const watchdogSrc = fs.readFileSync(R + 'supabase/functions/push-watchdog/index.ts', 'utf8');
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
t('proxy: push_subscriptions is in the REST allowlist (THE fix)',
  /REST_TABLES = new Set\(\[[^\]]*'push_subscriptions'/.test(restSrc));
t('proxy: push_sent_log allowlisted for the wipe delete path',
  /REST_TABLES = new Set\(\[[^\]]*'push_sent_log'/.test(restSrc));
t('watchdog: test returns per-subscription results',
  watchdogSrc.includes('results') && watchdogSrc.includes('return json({ ok: true, delivered: ok, subscriptions: subs.length, results })'));
t('watchdog: deliver reports pruned per subscription, prune kept',
  watchdogSrc.includes('r.pruned = true') && watchdogSrc.includes('sbDelete(') && watchdogSrc.includes('"push_subscriptions"'));
t('app: wipe steps delete push tables server-side',
  appSrc.includes("{ label: 'Push subscriptions', run: del('push_subscriptions') }") &&
  appSrc.includes("{ label: 'Push notification log', run: del('push_sent_log') }"));
t('app: device reset clears the push local state',
  appSrc.includes("localStorage.removeItem('crna-hub-push');"));

// ---------------- VM world (v118 harness shape) ----------------
function makeWorld(opts) {
  opts = opts || {};
  const store = new Map();
  function el(id) {
    return {
      id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
      dataset: {}, style: {}, _listeners: {}, _entries: null,
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
    };
  }
  const elements = {};
  const getEl = (id) => elements[id] || (elements[id] = el(id));
  class FakeFormData { constructor(f) { this._e = (f && f._entries) || []; } *[Symbol.iterator]() { yield* this._e; } }
  const alerts = [];
  const fakeSub = {
    endpoint: 'https://push.example.com/sub/device-1',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPfake', auth: 'authfake' } }; },
    unsubscribe: async () => true,
  };
  const fakeReg = {
    pushManager: {
      _sub: null,
      async getSubscription() { return this._sub; },
      async subscribe() { this._sub = fakeSub; return fakeSub; },
    },
  };
  const nav = {
    userAgent: opts.ua || 'v120-test',
    serviceWorker: { ready: Promise.resolve(fakeReg), register: async () => fakeReg },
  };
  if (opts.standalone !== undefined) nav.standalone = opts.standalone;
  const sandbox = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
    crypto: require('crypto').webcrypto,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    FormData: FakeFormData,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      createElement: () => el(), body: { append() {} },
      addEventListener() {},
    },
    window: null,
    navigator: nav,
    location: { protocol: 'https:', search: '', pathname: '/', href: '' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async () => {
      const data = { ok: true };
      return { status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data };
    },
    history: { replaceState() {} },
  };
  if (!opts.noPush) {
    sandbox.PushManager = class {};
    sandbox.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  }
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  return { run, alerts, store, fakeReg };
}
const drain = async () => { for (let i = 0; i < 16; i++) await new Promise((r) => setImmediate(r)); };
const J = (v) => JSON.stringify(v);
const VAPID_PUB = (() => {
  const b = Buffer.alloc(65); b[0] = 4; for (let i = 1; i < 65; i++) b[i] = i;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();

(async () => {
  // ---------- enable: read-back decides ----------
  let w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    window.__sb = [];
    sbReq = async (p, m, b) => { window.__sb.push({ p, m, b }); if (m === 'GET') { const post = window.__sb.filter(x => x.m === 'POST').pop(); return post ? [{ id: post.b.id, endpoint: post.b.endpoint }] : []; } return {}; };
    liveSyncPost = async () => ({ ok: true, configured: true, vapidPublicKey: '${VAPID_PUB}' });`);
  await w.run(`pushEnable()`);
  await drain();
  t('enable: subscription write went through sbReq (the /api/rest proxy path)',
    w.run(`window.__sb.filter(x => x.m === 'POST' && x.p.includes('push_subscriptions')).length`) === 1);
  t('enable: read-back happened before claiming on',
    w.run(`window.__sb.filter(x => x.m === 'GET' && x.p.includes('push_subscriptions')).length`) >= 1);
  t('enable: server-confirmed -> local on + "Push is on for this device."',
    w.run(`pushLocalState().enabled`) === true && w.run(`pushStatusMsg`) === 'Push is on for this device.');

  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    sbReq = async (p, m, b) => { if (m === 'GET') return []; return {}; };
    liveSyncPost = async () => ({ ok: true, configured: true, vapidPublicKey: '${VAPID_PUB}' });`);
  await w.run(`pushEnable()`);
  await drain();
  t('enable: server has NO row -> push stays OFF locally (the Nov 11 failure, fixed)',
    !w.run(`pushLocalState().enabled`));
  t('enable: unconfirmed enable says so plainly',
    w.run(`pushStatusMsg`).includes('no subscription for this device'), w.run(`pushStatusMsg`));

  // ---------- panel reconcile ----------
  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' }); pushStatusMsg = '';
    sbReq = async () => [];`);
  await w.run(`pushReconcile()`);
  await drain();
  let panel = w.run(`notificationsPanelHTML()`);
  t('panel: local-on but NO server row -> plain warning, never the ✓ claim',
    panel.includes('no subscription on the server') && !panel.includes('✓ Push is on'), panel.slice(0, 240));
  t('panel: missing row offers one-tap re-enable',
    panel.includes('Turn push on again') && panel.includes('data-action="push-enable"'));

  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' }); pushStatusMsg = '';
    sbReq = async () => [{ id: 'push-x', endpoint: 'https://push.example.com/sub/device-1' }];`);
  await w.run(`pushReconcile()`);
  await drain();
  panel = w.run(`notificationsPanelHTML()`);
  t('panel: server row confirmed -> ✓ on, with the per-type toggles',
    panel.includes('✓ Push is on for this device.') && panel.includes('data-action="push-type-toggle"'));

  // while the check has not completed, the panel claims nothing
  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' }); pushStatusMsg = '';
    sbReq = () => new Promise(() => {});`);
  panel = w.run(`notificationsPanelHTML()`);
  t('panel: check still running -> "Checking…", no ✓ claim',
    panel.includes('Checking this device') && !panel.includes('✓ Push is on'), panel.slice(0, 240));

  // ---------- iOS: Home Screen lead ----------
  w = makeWorld({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', noPush: true, standalone: false });
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' }; pushStatusMsg = '';`);
  panel = w.run(`notificationsPanelHTML()`);
  t('ios: Safari tab LEADS with the Home Screen step',
    panel.includes('Add CRNA Hub to your Home Screen, then open it there and turn push on') &&
    panel.indexOf('Add CRNA Hub to your Home Screen') < panel.indexOf('Beta note'), panel.slice(0, 300));
  t('ios: not the dead-end "not available in this browser"',
    !panel.includes('Push is not available in this browser.'));

  // desktop: no lead
  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' }; pushStatusMsg = '';`);
  panel = w.run(`notificationsPanelHTML()`);
  t('desktop: no Home Screen lead off-iOS', !panel.includes('Add CRNA Hub to your Home Screen'));

  // ---------- test send: pruned subscription ----------
  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' });
    liveSyncPost = async () => ({ ok: true, delivered: false, results: [{ id: 'push-x', status: 410, pruned: true, delivered: false }] });`);
  await w.run(`pushTest()`);
  await drain();
  t('test: pruned (410) subscription surfaces the exact message',
    w.run(`pushStatusMsg`) === "Apple says this device's subscription is gone — turn push off and on again.", w.run(`pushStatusMsg`));
  t('test: pruned device local state is cleared (server row is gone)',
    !w.run(`pushLocalState().enabled`));

  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' });
    liveSyncPost = async () => ({ ok: true, delivered: true, results: [{ id: 'push-x', status: 201, pruned: false, delivered: true }] });`);
  await w.run(`pushTest()`);
  await drain();
  t('test: delivered result keeps the plain "Test sent" message',
    w.run(`pushStatusMsg`).includes('Test sent'));

  // ---------- wipe: both sides ----------
  w = makeWorld();
  w.run(`db = empty(); persist(); cloudSession = { user_id: 'u-1', access_token: 'tok' };
    pushLocalSet({ enabled: true, subId: 'push-x' });`);
  t('wipe: steps include both push tables',
    w.run(`wipeEraseSteps().map(s => s.label)`).includes('Push subscriptions') &&
    w.run(`wipeEraseSteps().map(s => s.label)`).includes('Push notification log'));
  w.run(`resetDeviceLocalState();`);
  t('wipe: device reset removes the push local state',
    w.store.has('crna-hub-push') === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
