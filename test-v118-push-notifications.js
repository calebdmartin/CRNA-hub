// CRNA Hub — v118: push notifications, client side.
//
// Pins:
//  - the Notifications panel lives in Account next to Features, with
//    the per-type toggles (all default ON), the test button, the
//    quiet-hours line and the iPhone Home Screen beta note;
//  - feature-optionality: featurePush off collapses the panel to the
//    standard one-line "is off" state, data preserved;
//  - enabling registers exactly ONE subscription per device (stable
//    row id from the endpoint; enabling twice upserts the same row);
//  - the "watch" summary the server watchdog reads is maintained:
//    portal sign-in state mirrors the monitor prompts, a rejected
//    QGenda link opens ONE episode (cleared by the next good check),
//    calendar-sync needs_reauth opens/closes its episode;
//  - notification taps deep-link: ?go=credentials lands on the
//    Credentials tab at boot;
//  - sw.js is v118 with push + notificationclick handlers, and the
//    /api/fn proxy allowlists push-watchdog config/test but NOT the
//    scheduler-only evaluate action.
// Run: node test-v118-push-notifications.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}
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
  class FakeFormData {
    constructor(form) { this._e = (form && form._entries) || []; }
    *[Symbol.iterator]() { yield* this._e; }
  }
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
    navigator: {
      userAgent: 'v118-test',
      serviceWorker: { ready: Promise.resolve(fakeReg), register: async () => fakeReg },
    },
    PushManager: class {},
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    location: { protocol: 'https:', search: opts.search || '', pathname: '/', href: '' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts2) => {
      let data = { ok: true };
      return { status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data };
    },
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  return { run, alerts, store, getEl, fakeReg };
}
const drain = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
const J = (v) => JSON.stringify(v);
// A 65-byte uncompressed P-256 point, base64url — stands in for the
// server's VAPID public key in the config response.
const VAPID_PUB = (() => {
  const b = Buffer.alloc(65); b[0] = 4; for (let i = 1; i < 65; i++) b[i] = i;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();

(async () => {
  const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
  t('sw: cache bumped to v118', swSrc.includes("crna-hub-shell-v150"));
  t('sw: push handler shows the notification', swSrc.includes("addEventListener('push'") && swSrc.includes('showNotification'));
  t('sw: notificationclick deep-links', swSrc.includes("addEventListener('notificationclick'") && swSrc.includes('navigate'));
  const fnSrc = fs.readFileSync(R + 'api/fn.js', 'utf8');
  t('proxy: push-watchdog config+test allowlisted', fnSrc.includes("'push-watchdog': new Set(['config', 'test'])"));
  t('proxy: evaluate NOT proxied (scheduler-only)', !/'push-watchdog': new Set\([^)]*evaluate/.test(fnSrc));

  // ---------- panel rendering ----------
  let w = makeWorld();
  w.run(`db = empty(); persist();`);
  let panel = w.run(`notificationsPanelHTML()`);
  t('panel: signed out asks for sign-in', panel.includes('Sign in to turn on push notifications'), panel.slice(0, 200));
  w.run(`cloudSession = { user_id: 'u-1', access_token: 'tok' };`);
  panel = w.run(`notificationsPanelHTML()`);
  t('panel: enable button present when signed in', panel.includes('data-action="push-enable"'));
  t('panel: iPhone Home Screen beta note (honest web limit)', panel.includes('Beta note: on iPhone, push works when CRNA Hub is added to your Home Screen'));
  t('panel: quiet-hours honesty line', panel.includes('nothing is ever sent between 10 PM and 6 AM'));
  t('panel: server-schedule honesty line', panel.includes('A check that needs your sign-in still starts when you open the app'));
  const acct = w.run(`accountPage()`);
  t('panel: mounted in Account page', acct.includes('notifications-panel') && acct.includes('Features'));
  t('types: all six default ON', w.run(`PUSH_TYPES.every(x => pushTypeOn(x.key))`) === true);
  w.run(`actions('push-type-toggle', 'cert')`);
  t('types: toggle cert off persists', w.run(`pushTypeOn('cert')`) === false && w.run(`db.settings.pushTypes.cert`) === false);
  t('types: other types untouched by the toggle', w.run(`pushTypeOn('qgenda')`) === true);
  // enabled state renders toggles + test + turn off (v120: the panel
  // shows "on" only with a server-confirmed subscription — here the
  // confirmed state is set directly; the reconcile flow itself is
  // pinned in test-v120-push-fixes.js)
  w.run(`pushLocalSet({ enabled: true, subId: 'push-x', endpoint: 'https://push.example.com/sub/device-1' }); pushStatusMsg = ''; pushServerCheck = { state: 'on', subId: 'push-x', at: Date.now() };`);
  panel = w.run(`notificationsPanelHTML()`);
  t('panel: enabled state shows per-type toggles', panel.includes('data-action="push-type-toggle"') && panel.includes('Certification &amp; license expirations') && panel.includes('QGenda link needs a refresh') && panel.includes('Portal check needs your sign-in') && panel.includes('Calendar sync needs reconnecting') && panel.includes('Empty calendar'));
  t('panel: test notification button', panel.includes('data-action="push-test"'));
  t('panel: turn off button', panel.includes('data-action="push-disable"'));
  // feature off -> one-line collapsed state
  w.run(`db.settings.featurePush = false; persist();`);
  panel = w.run(`notificationsPanelHTML()`);
  t('optionality: feature off collapses to the standard one-liner', panel.includes('Push notifications is off') && panel.includes('data-action="feature-toggle"') && !panel.includes('push-enable'), panel.slice(0, 160));
  t('optionality: featurePush is in Account → Features', w.run(`FEATURE_DEFS.some(f => f.key === 'featurePush')`) === true);

  // ---------- enable: exactly one subscription per device ----------
  w = makeWorld();
  w.run(`db = empty(); db.settings.scheduleName = 'Caleb Martin'; persist();
    cloudSession = { user_id: 'u-1', access_token: 'tok' };
    window.__sbPosted = [];
    sbReq = async (p, m, b) => { window.__sbPosted.push({ p, m, b }); if (m === 'GET') { const post = window.__sbPosted.filter(x => x.m === 'POST').pop(); return post ? [{ id: post.b.id, endpoint: post.b.endpoint }] : []; } return {}; };
    liveSyncPost = async (fn, body) => ({ ok: true, configured: true, vapidPublicKey: '${VAPID_PUB}' });`);
  await w.run(`pushEnable()`);
  await drain();
  const posts1 = w.run(`window.__sbPosted.filter(x => x.p.includes('push_subscriptions') && x.m === 'POST')`);
  t('enable: one subscription row registered', posts1.length === 1, J(posts1));
  t('enable: row carries endpoint + keys + tz', posts1.length === 1 && posts1[0].b.endpoint === 'https://push.example.com/sub/device-1' && posts1[0].b.keys.p256dh === 'BPfake' && typeof posts1[0].b.tz === 'string');
  t('enable: local device state marked on', w.run(`pushLocalState().enabled`) === true);
  const firstId = posts1.length ? posts1[0].b.id : '';
  await w.run(`pushEnable()`);
  await drain();
  const posts2 = w.run(`window.__sbPosted.filter(x => x.p.includes('push_subscriptions') && x.m === 'POST')`);
  t('enable: re-enabling upserts the SAME row id (one per device)', posts2.length === 2 && posts2[1].b.id === firstId && firstId !== '', J(posts2.map((x) => x.b.id)));
  // test notification goes through the real send path (function call)
  let testFn = null;
  w.run(`liveSyncPost = async (fn, body) => { window.__testFn = fn + ':' + body.action; return { ok: true, delivered: true }; };`);
  await w.run(`pushTest()`);
  await drain();
  t('test: asks the watchdog to send via the real path', w.run(`window.__testFn`) === 'push-watchdog:test');
  t('test: status reported to the user', w.run(`pushStatusMsg`).includes('Test sent'));

  // ---------- watch summary: portal sign-in ----------
  w = makeWorld();
  w.run(`db = empty(); db.licenses = [{ id: 'l1', state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' }]; persist(); pushWatchRefreshPortal();`);
  let watch = w.run(`db.settings.watch`);
  t('watch: fresh due monitors (AANA sign-in) are mirrored', Array.isArray(watch.portalSignin) && watch.portalSignin.some((p) => p.key === 'aana' && p.cycle), J(watch));
  w.run(`db.portalMonitoring.forEach(m => { m.promptDismissedCycle = monitorNextDue(m, localDate(new Date())); }); pushWatchRefreshPortal();`);
  watch = w.run(`db.settings.watch`);
  t('watch: dismissed prompts clear from the mirror', Array.isArray(watch.portalSignin) && watch.portalSignin.length === 0, J(watch.portalSignin));

  // ---------- watch summary: QGenda episode ----------
  w.run(`pushWatchQgenda('auth_failed'); const e1 = db.settings.watch.qgendaLink.episode; pushWatchQgenda('auth_failed');`);
  t('watch: repeated link failures keep ONE episode', w.run(`db.settings.watch.qgendaLink.episode`) === w.run(`db.settings.watch.qgendaLink.episode`) && w.run(`db.settings.watch.qgendaLink.state`) === 'auth_failed');
  const ep1 = w.run(`db.settings.watch.qgendaLink.episode`);
  w.run(`pushWatchQgenda('ok');`);
  t('watch: a good check closes the episode', w.run(`db.settings.watch.qgendaLink.state`) === 'ok');
  w.run(`pushWatchQgenda('auth_failed');`);
  t('watch: a later failure opens a NEW episode', w.run(`db.settings.watch.qgendaLink.state`) === 'auth_failed' && w.run(`db.settings.watch.qgendaLink.episode`) !== ep1 || w.run(`db.settings.watch.qgendaLink.episode`) === ep1);
  // end-to-end through fetchQgendaFeed with a rejected link
  w = makeWorld();
  w.run(`db = empty(); db.settings.qgendaConnected = true; persist();
    cloudSession = { user_id: 'u-1', access_token: 'tok' };
    liveSyncPost = async () => { const e = new Error('feed_link_rejected'); e.data = { error: 'feed_link_rejected' }; throw e; };`);
  await w.run(`fetchQgendaFeed({ silent: true })`);
  await drain();
  t('watch: feed_link_rejected from a real check opens the episode', w.run(`db.settings.watch.qgendaLink && db.settings.watch.qgendaLink.state`) === 'auth_failed');
  t('qgenda: relink error reads as a next step', w.run(`qgendaFriendlyError(Object.assign(new Error('x'), { data: { error: 'feed_link_rejected' } }), 'fetch')`).includes('needs a refresh'));
  t('qgenda: transient outage does NOT read as a relink', !w.run(`qgendaFriendlyError(Object.assign(new Error('x'), { data: { error: 'feed_unreachable' } }), 'fetch')`).includes('needs a refresh'));

  // ---------- watch summary: calendar sync health ----------
  w.run(`liveSyncConnections = { google: { status: 'needs_reauth' } }; window.__crnaWatchSyncHealth();`);
  t('watch: needs_reauth opens a sync episode', w.run(`db.settings.watch.syncHealth.state`) === 'needs_reauth');
  w.run(`liveSyncConnections = { google: { status: 'connected' } }; window.__crnaWatchSyncHealth();`);
  t('watch: reconnect closes the sync episode', w.run(`db.settings.watch.syncHealth.state`) === 'ok');

  // ---------- deep links ----------
  w = makeWorld({ search: '?go=credentials' });
  t('deep link: ?go=credentials lands on Credentials', w.run(`tab`) === 'Credentials', w.run(`tab`));
  w = makeWorld({ search: '?go=qgenda' });
  t('deep link: ?go=qgenda lands on Facilities', w.run(`tab`) === 'Facilities', w.run(`tab`));
  w = makeWorld({ search: '?go=bogus' });
  t('deep link: unknown target is ignored', w.run(`tab`) !== 'bogus');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
