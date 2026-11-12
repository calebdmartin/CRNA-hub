// CRNA Hub — v155 (Nov 12, 2026): the POLISH ROUND, Caleb-approved
// items 1–4 + 6 of Jewel's recommendation list (motion was item 5
// and is NOT in this round):
//  1 consistency: ONE set of shared spacing/type values (CSS vars)
//     behind every panel/heading/button on every tab.
//  2 Account tab grouped (Profile / Features / Sync & calendars /
//     Your data / Advanced) + Testing tools becomes a Features
//     toggle — ON for accounts that already have records, OFF for
//     brand-new accounts, panel absent while off.
//  3 first-day Dashboard: a signed-in account with zero shifts AND
//     zero facilities gets ONE start card (three onboard-goto steps)
//     instead of the empty overview/calendar stack.
//  4 color discipline: amber = proposed only · red = attention
//     only · green = verified/OK only · navy/teal = brand. Fixed:
//     .hint (amber tint -> neutral brand tint), .pill.warn (amber
//     tint -> red tint), .warning (amber-brown -> red), .chip.call
//     (amber-family peach -> blue family), the just-saved day flash
//     (amber ring -> teal), the double-booking conflict borders
//     (amber #b45309 -> red), the mileage "can't be calculated"
//     box (amber tint -> red tint), and the facility "Not taken
//     here" note (attention class -> muted; it is pure information).
//     Left alone as meaning-correct: .chip.proposed amber (that IS
//     proposed), .success/.expired, button.danger, and the green
//     paycheck tint (a money-in event marker, not a status claim).
//  6 "last synced" whisper on the Dashboard from cloudLastSync —
//     relative text, and NO line at all when signed out / never
//     synced.
// Run: node test-v155-polish.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store) {
  function el() {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, files: [],
      addEventListener() {}, append() {}, click() {}, remove() {},
      dataset: {}, style: {}, scrollIntoView() {},
    };
  }
  const elements = {};
  class FakeFormData {
    constructor(form) { this._e = (form && form._entries) || []; }
    *[Symbol.iterator]() { yield* this._e; }
  }
  const sandbox = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
    crypto: require('crypto').webcrypto,
    FormData: FakeFormData,
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => elements[id] || (elements[id] = el()),
      querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
      addEventListener() {}, hidden: false,
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: () => {}, confirm: () => true, prompt: () => null,
    fetch: async () => ({ status: 200, ok: true, text: async () => '[]', json: async () => [] }),
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const css = fs.readFileSync(R + 'styles.css', 'utf8');
const SESSION = `cloudSession = { access_token: 'x', email: 'crna@example.com' };`;

// ---------- 1: shared spacing/type values ----------
t('css declares the shared values (panel pad/gap/radius, button pad/radius, h2/h3 sizes)',
  css.includes('--panel-pad:20px') && css.includes('--panel-pad-sm:13px') &&
  css.includes('--panel-gap:16px') && css.includes('--panel-radius:16px') &&
  css.includes('--btn-pad:10px 14px') && css.includes('--btn-radius:9px') &&
  css.includes('--h2-size:20px') && css.includes('--h3-size:15px'));
t('.panel (every tab\'s card) derives padding/radius/gap from the shared values',
  css.includes('border-radius:var(--panel-radius);padding:var(--panel-pad);margin:0 0 var(--panel-gap)'));
t('headings derive from the shared sizes', css.includes('h2{font-size:var(--h2-size)') && css.includes('h3{font-size:var(--h3-size)'));
t('buttons derive padding/radius from the shared values',
  css.includes('border-radius:var(--btn-radius)') && css.includes('padding:var(--btn-pad)'));
t('mobile panel padding + collapse-panel head/body derive from the shared values',
  css.includes('.panel{padding:var(--panel-pad-sm)}') && css.includes('padding:16px var(--panel-pad)') &&
  css.includes('padding:0 var(--panel-pad) 18px') && css.includes('padding:0 var(--panel-pad-sm) 14px'));
t('representative panels across tabs ride the shared .panel class',
  appSrc.includes('class="panel collapse-panel"') && appSrc.includes('<section class="panel"><h2>Overview') &&
  appSrc.includes('class="panel" id="my-facilities-panel"'));

// ---------- 4: color discipline ----------
t('.hint is a neutral brand tint now, not amber', css.includes('.hint{padding:12px;border-radius:9px;background:#eaf3f8;color:#385b72'));
t('.pill.warn is a red attention tint now, not amber', css.includes('.pill.warn{background:#fbe9ec;color:#a32c3c}'));
t('.warning text is the red attention color', css.includes('.warning{color:#a32c3c}'));
t('call chips left the amber family (blue now)', css.includes('.chip.call{background:#c9e2f4}'));
t('the just-saved day flash is teal, not amber', css.includes('box-shadow:0 0 0 3px #0f7f8a inset;background:#e2f5f2'));
t('no amber info tints remain in the stylesheet', !css.includes('#fef5dc') && !css.includes('#a35d13') && !css.includes('#fce5c8') && !css.includes('#f59e0b'));
t('double-booking conflict boxes wear the red border, not amber',
  appSrc.includes('border:2px solid #a32c3c') && !appSrc.includes('#b45309'));
t('the mileage "can\'t be calculated" box is a red attention tint, not amber',
  appSrc.includes('border:1px solid #a32c3c;background:#fdf1f3') && !appSrc.includes('#fdf6e0'));
t('the facility "Not taken here" note is muted information, not attention',
  appSrc.includes('<span class="muted">Not taken here:'));
t('meaning-correct colors stay: proposed amber, success green, danger red',
  css.includes('.chip.proposed{background:#fde68a') && css.includes('.success{color:#22744c}') && css.includes('button.danger{background:#aa3443}'));

// ---------- 2 + 3 + 6: fresh (brand-new) account world ----------
{
  const w = makeWorld(new Map());
  const run = w.run;
  t('fresh account: testing tools flag defaults OFF (no records yet)',
    run(`db.settings.featureTestingTools === false && featureOn('featureTestingTools') === false`));
  run(SESSION);
  const acct = run(`accountPage()`);
  t('fresh account: Account renders the group headings',
    ['Profile', 'Features', 'Sync &amp; calendars', 'Your data'].every(g => acct.includes(`account-group-title">${g}</h2>`)));
  t('fresh account: group order is Profile < Features < Sync & calendars < Your data',
    acct.indexOf('account-group-title">Profile') < acct.indexOf('account-group-title">Features') &&
    acct.indexOf('account-group-title">Features') < acct.indexOf('account-group-title">Sync &amp; calendars') &&
    acct.indexOf('account-group-title">Sync &amp; calendars') < acct.indexOf('account-group-title">Your data'));
  t('fresh account: panels still live inside their groups (features + backup + live sync present)',
    acct.includes('id="features-panel"') && acct.includes('id="backup-panel"') && acct.includes('id="live-sync-panel"'));
  t('fresh account: Testing tools panel is ABSENT, and so is its Advanced group',
    !acct.includes('testing-tools-panel') && !acct.includes('account-group-title">Advanced</h2>'));
  t('fresh account: the Features panel offers the Testing tools toggle, reading Off',
    acct.includes('Testing tools (advanced)') && acct.includes('data-action="feature-toggle" data-id="featureTestingTools"'));
  run(`actions('feature-toggle', 'featureTestingTools')`);
  const acct2 = run(`accountPage()`);
  t('fresh account: toggling Testing tools on brings the panel (and Advanced group) back',
    run(`db.settings.featureTestingTools === true`) && acct2.includes('testing-tools-panel') && acct2.includes('account-group-title">Advanced</h2>'));

  // first-day dashboard
  const dash = run(`dashboard()`);
  t('first-day: signed-in + zero shifts + zero facilities shows the start card, not the overview stack',
    dash.includes('first-day') && dash.includes('Welcome to CRNA Hub') && !dash.includes('Overview ·'));
  t('first-day: one light line + the three steps with the right jump targets',
    dash.includes('Let’s get you set up — three quick steps.') &&
    dash.includes('Sync a calendar or upload a schedule') && dash.includes('Add your first facility') && dash.includes('Connect your credentials') &&
    dash.includes('data-action="onboard-goto" data-id="Account" data-date="live-sync-panel"') &&
    dash.includes('data-action="onboard-goto" data-id="Facilities"') &&
    dash.includes('data-action="onboard-goto" data-id="Credentials"'));
  run(`db.facilities.push({id:'f1', name:'Holzer'})`);
  const dash2 = run(`dashboard()`);
  t('first-day: the moment a facility exists the card never shows (normal dashboard returns)',
    !dash2.includes('first-day') && dash2.includes('Overview ·'));
  run(`db.facilities = []; db.shifts.push({id:'s1', date: localDate(new Date()), facility:'Holzer', type:'8', pay:'2125', status:'confirmed'});`);
  t('first-day: a shift alone also retires the card', !run(`dashboard()`).includes('first-day'));

  // sync whisper
  run(`cloudLastSync = new Date(Date.now() - 2*3600*1000).toISOString();`);
  t('whisper: 2h-old sync renders "Synced 2h ago" as a quiet muted line',
    run(`dashboard()`).includes('<p class="muted sync-whisper">Synced 2h ago</p>'));
  run(`cloudLastSync = new Date().toISOString();`);
  t('whisper: a fresh sync renders "Synced just now"', run(`dashboard()`).includes('>Synced just now</p>'));
  run(`cloudLastSync = new Date(Date.now() - 26*3600*1000).toISOString();`);
  t('whisper: a day-old sync renders "Synced yesterday"', run(`dashboard()`).includes('>Synced yesterday</p>'));
  run(`cloudLastSync = '';`);
  t('whisper: never synced -> no line at all', !run(`dashboard()`).includes('sync-whisper'));
  run(`cloudLastSync = new Date().toISOString(); cloudSession = null;`);
  t('whisper: signed out -> no line, even with a stored timestamp', !run(`dashboard()`).includes('sync-whisper'));
  t('first-day: signed OUT with zero data never sees the start card', !run(`dashboard()`).includes('first-day'));
}

// ---------- 2: existing account (records on file) keeps Testing tools ----------
{
  const store = new Map();
  const today = new Date().toISOString().slice(0, 10);
  store.set('crna-hub-v2', JSON.stringify({
    shifts: [{ id: 's1', date: today, facility: 'Holzer', type: '8', pay: '2125', status: 'confirmed' }],
    facilities: [{ id: 'f1', name: 'Holzer' }],
    settings: {},
  }));
  const w = makeWorld(store);
  const run = w.run;
  t('existing account: testing tools flag defaults ON (records predate the toggle)',
    run(`db.settings.featureTestingTools === true && featureOn('featureTestingTools') === true`));
  run(SESSION);
  const acct = run(`accountPage()`);
  t('existing account: Testing tools panel renders under the Advanced group',
    acct.includes('testing-tools-panel') && acct.includes('account-group-title">Advanced</h2>'));
  t('Caleb fixture: a populated dashboard never shows the first-day card',
    !run(`dashboard()`).includes('first-day') && run(`dashboard()`).includes('Overview ·'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
