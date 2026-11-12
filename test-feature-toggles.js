// CRNA Hub — tests for optional feature toggles (Nov 7, 2026,
// branch muse/credentialing).
// Run: node test-feature-toggles.js
//
// Caleb's direction: every optional feature (Mileage tracking,
// Paycheck estimates, Credential tracking & portal monitoring,
// QGenda feed) gets an on/off choice. Off = the panel collapses to
// one quiet line, data is preserved untouched, automations and
// prompts go quiet, and turning it back on restores everything.
// Flags live in db.settings so they ride the user_settings cloud
// sync and survive clear-device -> sign-in. Defaults: all ON.
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
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  const store = new Map();
  const { run } = makeWorld(store);
  const today = run(`localDate(new Date())`);
  const prefix = today.slice(0, 7);

  // ---------- Fresh account: features default ON ----------
  // v155 SUPERSEDED PIN, rewritten with reason: FEATURE_DEFS gained
  // featureTestingTools, whose default is deliberately OFF for a
  // brand-new, still-empty account (beta users must not meet the
  // ERASE panel unless they turn it on). The original features still
  // default on; an account WITH records gets Testing tools on —
  // pinned in test-v155-polish.js.
  t('fresh settings default the original features on; testing tools off while the account is empty',
    run(`FEATURE_DEFS.filter(f => f.key !== 'featureTestingTools').every(f => db.settings[f.key] === true) && db.settings.featureTestingTools === false`));
  t('featureOn true for the original features on a fresh account; testing tools off',
    run(`FEATURE_DEFS.filter(f => f.key !== 'featureTestingTools').every(f => featureOn(f.key)) && featureOn('featureTestingTools') === false`));

  // ---------- Legacy settings (no flags) load as all-on ----------
  run(`db.settings = { monthlyIncomeGoal: 40000, mileageTripType: 'round-trip' }; normalizeFeatureFlags(db);`);
  t('legacy settings without flags are filled in as ON, other values untouched',
    run(`db.settings.featureMileage === true && db.settings.featurePaychecks === true && db.settings.featureCredentials === true && db.settings.featureQgenda === true && db.settings.monthlyIncomeGoal === 40000`));
  run(`db.settings = empty().settings;`);

  // ---------- Account page carries the Features section ----------
  const acct = run(`accountPage()`);
  t('Account page shows a Features section with all four toggles',
    acct.includes('Features') && ['Mileage tracking', 'Paycheck estimates', 'Credential tracking', 'QGenda feed'].every(x => acct.includes(x)));
  t('Features section shows On state for a fresh account', acct.includes('On — tap to turn off'));

  // ---------- Mileage: off collapses, preserves, quiets; on restores ----------
  run(`
    db.mileage = [
      {id:'m1', date:'${today}', facility:'Holzer', purpose:'Work', miles:'42', oneWayMiles:21, tripType:'round-trip', milesSource:'manual', origin:'home', status:'verified'},
      {id:'m2', date:'${today}', facility:'Holzer', purpose:'Work', miles:'', oneWayMiles:null, tripType:'round-trip', milesSource:'', origin:'home', status:'draft'}
    ];
    db.shifts = [{id:'sh1', date:'${today}', facility:'Holzer', type:'Second call', pay:'3000', status:'confirmed'}];
    persist();
  `);
  const totalBefore = run(`verifiedMileageTotal()`);
  t('mileage page renders in full while on', run(`mileagePage()`).includes('Log business mileage'));
  t('per-shift drive-from picker shows while mileage on', run(`shiftTripOriginHTML(db.shifts[0])`).includes('Drive from'));
  run(`actions('feature-toggle', 'featureMileage')`);
  t('toggle flips the stored flag off', run(`db.settings.featureMileage === false && featureOn('featureMileage') === false`));
  t('flag persisted to local storage', JSON.parse(store.get('crna-hub-v2')).settings.featureMileage === false);
  const offPage = run(`mileagePage()`);
  t('mileage off: tab collapses to the one quiet line with Turn on',
    offPage.includes('Mileage tracking is off') && offPage.includes('Turn on') && !offPage.includes('Log business mileage') && !offPage.includes('Weekly mileage review'));
  t('mileage off: trips preserved untouched (count + verified total)',
    run(`db.mileage.length`) === 2 && run(`verifiedMileageTotal()`) === totalBefore);
  t('mileage off: per-shift drive-from prompt is gone', run(`shiftTripOriginHTML(db.shifts[0])`) === '');
  t('mileage off: dashboard mileage nudge is quiet', run(`dashboardMileageNudgeHTML()`) === '');
  run(`actions('feature-toggle', 'featureMileage')`);
  t('mileage back on: full page restored, totals identical',
    run(`mileagePage()`).includes('Log business mileage') && run(`verifiedMileageTotal()`) === totalBefore && run(`db.mileage.length`) === 2);

  // ---------- Paychecks: off kills chips + headline basis, stub intact ----------
  const payday = today;
  const pEnd = run(`addDaysStr('${today}', -9)`);
  const pStart = run(`addDaysStr('${pEnd}', -13)`);
  run(`
    db.shifts = [
      {id:'ps1', date:'${pStart}', facility:'Holzer', type:'Holzer 8', pay:'2125', status:'confirmed'},
      {id:'ps2', date:'${pEnd}', facility:'Holzer', type:'Holzer 8', pay:'2125', status:'confirmed'}
    ];
    db.payStubs = [{id:'stub1', agency:'Premier Anesthesia Group', facility:'Holzer', frequency:'biweekly', payDate:'${payday}', periodStart:'${pStart}', periodEnd:'${pEnd}', gross:'', net:'', source:'manual'}];
    persist();
  `);
  t('paychecks on: occurrences are produced for the month', run(`paystubOccurrencesInMonth('${prefix}').length`) >= 1);
  t('paychecks on: calendar shows a paycheck chip', run(`calendar()`).includes('chip paycheck'));
  t('paychecks on: headline uses the paycheck basis', run(`monthHeadline('${prefix}').scheduled`) === true);
  run(`setFeature('featurePaychecks', false)`);
  t('paychecks off: no occurrences (no chips, worked-basis headline)',
    run(`paystubOccurrencesInMonth('${prefix}').length`) === 0 && run(`monthHeadline('${prefix}').scheduled`) === false);
  t('paychecks off: calendar has no paycheck chip', !run(`calendar()`).includes('chip paycheck'));
  t('paychecks off: Upcoming paychecks panel collapses to the off line',
    run(`paystubUpcomingHTML()`).includes('Paycheck estimates is off'));
  t('paychecks off: pay-stub panel on Facilities collapses too',
    run(`paystubPanelHTML()`).includes('Paycheck estimates is off'));
  t('paychecks off: stub data intact', run(`db.payStubs.length`) === 1 && run(`db.payStubs[0].agency`) === 'Premier Anesthesia Group');
  run(`setFeature('featurePaychecks', true)`);
  t('paychecks back on: occurrences and chips return',
    run(`paystubOccurrencesInMonth('${prefix}').length`) >= 1 && run(`calendar()`).includes('chip paycheck'));

  // ---------- Credentials: off hides prompts/stat/sweep, data intact ----------
  run(`
    db.nbcrna = {...db.nbcrna, status:'Certified', periodEnd:'2027-04-30', renewalDeadline:'2027-04-30'};
    db.licenses = [{id:'lic1', state:'West Virginia', type:'APRN', number:'103459', expiry:'2027-06-30', reminders:'90,60,30,7', source:'user_entered'}];
    db.portalMonitoring = [];
    persist();
  `);
  t('credentials on: page renders the NBCRNA panel', run(`credentialsPage()`).includes('Connect NBCRNA'));
  t('credentials on: dashboard shows the credential deadlines stat', run(`dashboard()`).includes('Credential & certification deadlines (90 days)'));
  await run(`monitorBackgroundSweep()`);
  // (v142: the sweep no longer auto-attempts any portal check — the
  // server pull is retired and checks are agent reads. With the
  // feature ON the sweep keeps the monitors current and the due
  // prompt surfaces; it records no attempt and stamps nothing.)
  const cycleOn = run(`(ensurePortalMonitoring().find(m => m.source === 'nbcrna') || {}).autoAttemptCycle || ''`);
  const outcomeOn = run(`(ensurePortalMonitoring().find(m => m.source === 'nbcrna') || {}).lastOutcome || ''`);
  t('credentials on: background sweep runs but attempts no portal check (agent reads now)',
    cycleOn === '' && outcomeOn === '' && run(`monitorDuePromptsHTML()`).includes('NBCRNA check due'));
  run(`db.portalMonitoring.forEach(m => { m.autoAttemptCycle = ''; }); persist(); setFeature('featureCredentials', false);`);
  const credOff = run(`credentialsPage()`);
  t('credentials off: tab collapses to the off line (no Checks due strip, no panels)',
    credOff.includes('Credential tracking &amp; portal monitoring is off') && !credOff.includes('Checks due') && !credOff.includes('Connect NBCRNA'));
  t('credentials off: dashboard credential stat collapses', !run(`dashboard()`).includes('Credential & certification deadlines'));
  await run(`monitorBackgroundSweep()`);
  t('credentials off: background sweep stays quiet (no check attempted)',
    run(`(ensurePortalMonitoring().find(m => m.source === 'nbcrna') || {}).autoAttemptCycle || ''`) === '');
  t('credentials off: credential data intact',
    run(`db.licenses.length`) === 1 && run(`db.nbcrna.status`) === 'Certified');
  run(`setFeature('featureCredentials', true)`);
  t('credentials back on: full page restored', run(`credentialsPage()`).includes('Connect NBCRNA'));

  // ---------- QGenda: off collapses the panel and stops polling ----------
  const qOn = run(`syncSectionHTML()`);
  t('QGenda on: panel offers the connect form', qOn.includes('qgendaForm') || qOn.includes('QGenda feed connected'));
  run(`setFeature('featureQgenda', false)`);
  const qOff = run(`syncSectionHTML()`);
  t('QGenda off: panel collapses to the off line, no connect form',
    qOff.includes('QGenda feed is off') && !qOff.includes('qgendaForm'));
  run(`qgendaStatusError = '';`);
  await run(`fetchQgendaFeed()`);
  t('QGenda off: fetch does nothing (no status churn, no error)', run(`qgendaStatusError`) === '');
  run(`qgendaStatusLoaded = false; qgendaStatusRefresh();`);
  t('QGenda off: status refresh does not start a poll', run(`qgendaStatusLoaded`) === false);
  run(`setFeature('featureQgenda', true)`);
  t('QGenda back on: panel restored', run(`syncSectionHTML()`).includes('qgendaForm') || run(`syncSectionHTML()`).includes('QGenda feed connected'));

  // ---------- Settings survive the cloud path (clear-device -> sign-in) ----------
  run(`setFeature('featureMileage', false)`);
  t('settings content sent to the cloud carries the flags',
    run(`cloudSettingsContent(db.settings)`).includes('"featureMileage":false'));
  const merged = run(`
    (() => {
      const cloud = {...empty().settings, featureMileage:false, featureQgenda:false, updatedAt:'2026-11-07T12:00:00.000Z'};
      const freshLocal = {...empty().settings}; // what a cleared device boots with
      return cloudMergeSettings(freshLocal, cloud);
    })()
  `);
  t('clear-device -> sign-in: cloud flags restore onto a fresh device',
    merged.featureMileage === false && merged.featureQgenda === false && merged.featurePaychecks === true);
  const merged2 = run(`
    (() => {
      const local = {...empty().settings, featureMileage:false, updatedAt:'2026-11-07T13:00:00.000Z'};
      const cloud = {...empty().settings, featureMileage:true, updatedAt:'2026-11-07T12:00:00.000Z'};
      return cloudMergeSettings(local, cloud);
    })()
  `);
  t('newer local toggle wins over an older cloud copy', merged2.featureMileage === false);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
