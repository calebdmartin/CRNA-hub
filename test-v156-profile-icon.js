// CRNA Hub — v156 (Nov 12, 2026): the Account tab is gone; the
// Account view opens from a profile icon in the header.
// Caleb: "Hide the tab — move it behind a small profile icon."
//
// What this pins:
//  1 the tab bar renders WITHOUT Account: Dashboard, Facilities,
//    Credentials, Mileage, Assistant — in that order, nothing else.
//  2 the header carries the profile button (index.html markup + CSS),
//    and render() fills it: initials from the profile name ("CM" for
//    Caleb Martin), person glyph when there is no name, an active
//    state while the Account view is open.
//  3 tapping the icon (its click listener) opens the Account view with
//    all five v155 group headings; openAccountView() is the same door.
//  4 signed out: no Account tab anywhere, and the Account view still
//    shows the v126 split sign-in form (email + password only, New
//    here? switch) — the icon is the way in, never a dead end.
//  5 post-sign-in landing (REWRITTEN in v157, Caleb directed Nov 12,
//    2026: "after an interactive sign-in, the app must land on the
//    Dashboard, not the Account view"): cloudAfterSignIn now lands on
//    the Dashboard via setTab('Dashboard') — pinned behaviorally in
//    test-v157-assistant-live.js. 'Account' stays a valid internal
//    view even though it has no tab button.
//  6 every existing route still resolves: onboarding step targets
//    (onboard-goto with 'Account', the first-day card's step 1), the
//    goto-account / connect-calendar actions, and the ?go=account
//    push deep link.
//  7 copy audit: no user-facing string in app.js, live-sync.js or
//    index.html still says "Account tab"; the Assistant's sync answer
//    points at the profile icon instead.
//  8 SW cache is v156.
// Run: node test-v156-profile-icon.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
process.on('unhandledRejection', () => {});
const store = new Map();
function el() {
  const e = {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    className: '', dataset: {}, style: {}, __listeners: {},
    addEventListener(type, fn) { (e.__listeners[type] = e.__listeners[type] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {},
    querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null,
  };
  return e;
}
const elements = {};
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: class { *[Symbol.iterator]() {} },
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: (id) => elements[id] || (elements[id] = el()),
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
    addEventListener() {},
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '[]', json: async () => [] }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.liveSyncPost = async () => ({}); // live-sync.js is not loaded in this harness
vm.createContext(sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const liveSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
const indexSrc = fs.readFileSync(R + 'index.html', 'utf8');
const cssSrc = fs.readFileSync(R + 'styles.css', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

(async () => {
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(appSrc, sandbox);

  // ---------- 7 (source level) + 8: copy audit & SW ----------
  t('7a no "Account tab" string left in app.js / live-sync.js / index.html',
    !appSrc.includes('Account tab') && !liveSrc.includes('Account tab') && !indexSrc.includes('Account tab'));
  t('8 SW cache is v156', swSrc.includes('crna-hub-shell-v164'));
  t('2a header markup: profile button in a header-right cluster',
    indexSrc.includes('id="profileBtn"') && indexSrc.includes('class="header-right"') &&
    indexSrc.includes('class="profile-btn"'));
  t('2b CSS: profile-btn is a circle with an active state',
    cssSrc.includes('.profile-btn{') && cssSrc.includes('border-radius:50%') && cssSrc.includes('.profile-btn.active'));

  // ---------- 1: the tab bar ----------
  t('1a tabs array is exactly the five, in order',
    run(`tabs.join('|')`) === 'Dashboard|Facilities|Credentials|Mileage|Assistant');
  run(`render()`);
  const nav = elements.nav.innerHTML;
  const order = ['Dashboard', 'Facilities', 'Credentials', 'Mileage', 'Assistant']
    .map(x => nav.indexOf('data-tab="' + x + '"'));
  t('1b nav renders the five tabs in order, no Account button',
    order.every(i => i >= 0) && order.every((v, i, a) => i === 0 || v > a[i - 1]) &&
    !nav.includes('data-tab="Account"'), nav.slice(0, 200));

  // ---------- 2: the icon's face ----------
  run(`db.settings.scheduleName = ''; render()`);
  t('2c no name: person glyph', elements.profileBtn.textContent === '\uD83D\uDC64',
    JSON.stringify(elements.profileBtn.textContent));
  run(`db.settings.scheduleName = 'Caleb Martin'; render()`);
  t('2d initials from the profile name ("CM" for Caleb Martin)',
    elements.profileBtn.textContent === 'CM', JSON.stringify(elements.profileBtn.textContent));
  t('2e not active on the Dashboard', !elements.profileBtn.className.includes('active'));

  // ---------- 3: the icon opens the Account view ----------
  run(`cloudSession = { email: 'caleb@example.com', access_token: 'tok' };
       db.settings.featureTestingTools = true; render()`);
  const clickFns = elements.profileBtn.__listeners.click || [];
  t('3a icon has a click listener bound by render', clickFns.length >= 1);
  clickFns[clickFns.length - 1]();
  t('3b icon tap lands on the Account view', run(`tab`) === 'Account');
  const acct = elements.app.innerHTML;
  t('3c Account view shows all five v155 group headings',
    ['Profile', 'Features', 'Sync &amp; calendars', 'Your data', 'Advanced']
      .every(g => acct.includes('account-group-title">' + g + '</h2>')));
  t('3d icon shows the active state while Account is open',
    elements.profileBtn.className.includes('active'));
  t('3e Testing tools toggle survived the move',
    acct.includes('Testing tools (advanced)') && acct.includes('data-action="feature-toggle" data-id="featureTestingTools"'));
  run(`setTab('Dashboard'); openAccountView()`);
  t('3f openAccountView() is the same door', run(`tab`) === 'Account');

  // ---------- 4: signed out — v126 split intact, icon is the way in ----------
  run(`cloudSession = null; cloudAuthResetForm(); cloudAuthStatus = ''; setTab('Dashboard'); openAccountView(); render()`);
  const signedOut = elements.app.innerHTML;
  t('4a signed-out Account view is the v126 sign-in form',
    signedOut.includes('id="cloudAuthForm"') && signedOut.includes('name="email"') &&
    signedOut.includes('name="password"') && signedOut.includes('<button type="submit">Sign in</button>') &&
    signedOut.includes('New here?'));
  t('4b signed-out sign-in form carries NO profile fields (split intact)',
    !signedOut.includes('id="f_scheduleName"') && !signedOut.includes('id="f_incomeGoalStep1"'));
  t('4c still no Account tab while signed out', !elements.nav.innerHTML.includes('data-tab="Account"'));
  t('4d signed out, the icon still shows the on-device profile initials',
    elements.profileBtn.textContent === 'CM', JSON.stringify(elements.profileBtn.textContent));

  // ---------- 5: post-sign-in landing (v157: Dashboard, per Caleb Nov 12) ----------
  t('5 cloudAfterSignIn lands via setTab(\'Dashboard\') (v157 — Caleb directed Nov 12: sign-in lands on Dashboard)',
    /async function cloudAfterSignIn\(\) \{ cloudAuthResetForm\(\); await cloudAutoMerge\(\); render\(\); setTab\('Dashboard'\);/.test(appSrc));

  // ---------- 6: existing routes resolve ----------
  t('6a onboarding steps still target the Account view for steps 1-2',
    run(`onboardingSteps().filter(s => s.tab === 'Account').length`) >= 2);
  run(`actions('onboard-goto', 'Account', 'live-sync-panel')`);
  t('6b onboard-goto Account resolves to the Account view', run(`tab`) === 'Account');
  t('6c first-day card step 1 still jumps to Account / live-sync-panel',
    run(`firstDayDashboardHTML()`).includes('data-action="onboard-goto" data-id="Account" data-date="live-sync-panel"'));
  run(`actions('goto-account')`);
  t('6d goto-account action still lands on the Account view', run(`tab`) === 'Account');
  run(`actions('connect-calendar')`);
  t('6e connect-calendar action still lands on the Account view', run(`tab`) === 'Account');
  run(`location.search = '?go=account'; pushDeepLinkApply()`);
  t('6f ?go=account deep link still resolves', run(`tab`) === 'Account');
  run(`location.search = ''; setTab('Dashboard')`);

  // ---------- 7 (rendered level): Assistant copy ----------
  run(`cloudSession = null`);
  const ans = run(`cloudAssistantAnswer()`);
  t('7b Assistant sync answer points at the profile icon, not a tab',
    ans.includes('profile icon') && !ans.includes('Account tab'), ans.slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL harness error: ' + (e && e.stack || e)); process.exitCode = 1; });
