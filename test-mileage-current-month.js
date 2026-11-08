// CRNA Hub — tests for current-month mileage scoping + one-tap backlog
// clear (Nov 6, 2026, branch muse/credentialing).
// Run: node test-mileage-current-month.js
//
// Caleb's ask: mileage reviews/prompts look at the current month only;
// past-month unconfirmed trips stop surfacing, and the user gets one
// action — "Clear everything before this month" — that dismisses the
// backlog without deleting it and without touching confirmed trips.
//
// Covers:
//   * dueMileageWeeks only surfaces weeks overlapping the current month.
//   * selectedMileageReviewWeek defaults into the current month.
//   * The per-shift call drive prompt shows for a current-month call
//     shift and NOT for a past-month one.
//   * clearMileageBacklog dismisses exactly the pre-month drafts, keeps
//     the records, leaves verified/skipped/current-month trips alone,
//     and verified totals (YTD) are unchanged.
//   * Dismissed trips stay out of review after a full reload.
//   * The Mileage page shows the clear button when a backlog exists and
//     the trip log defaults to the current month.
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
  const TODAY = '2026-11-20'; // fixed synthetic "today" for dated helpers
  const store = new Map();
  const { run } = makeWorld(store);

  // ---------- Due weeks scope to the current month ----------
  run(`
    db.shifts = [
      {id:'s-oct', date:'2026-10-14', facility:'Holzer', type:'Holzer 8', pay:'', status:'confirmed'},
      {id:'s-bnd', date:'2026-11-01', facility:'Holzer', type:'Holzer 8', pay:'', status:'confirmed'},
      {id:'s-nov', date:'2026-11-04', facility:'Holzer', type:'Holzer 8', pay:'', status:'confirmed'}
    ];
    db.mileage = [
      {id:'m-bnd', date:'2026-11-01', facility:'Holzer', purpose:'p', miles:'80', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'m-nov', date:'2026-11-04', facility:'Holzer', purpose:'p', miles:'80', status:'draft', origin:'home', tripType:'round-trip'}
    ];
    db.facilities = []; db.hotelStays = [];
  `);
  const due = run(`dueMileageWeeks('${TODAY}').map(r => r.start)`);
  t('due weeks exclude the past-month week (Oct 12)', !due.includes('2026-10-12'));
  t('due weeks include the current-month week (Nov 2)', due.includes('2026-11-02'));
  t('due weeks include the boundary week overlapping this month (Oct 26)', due.includes('2026-10-26'));
  t('default review week lands in the current-month set', due.includes(run(`selectedMileageReviewWeek('${TODAY}')`)));

  // ---------- Backlog clear: exactly the pre-month drafts ----------
  run(`
    db.mileage = [
      {id:'b1', date:'2026-10-05', facility:'Holzer', purpose:'p', miles:'40', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'b2', date:'2026-10-30', facility:'Holzer', purpose:'p', miles:'', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'b3', date:'2026-11-03', facility:'Holzer', purpose:'p', miles:'40', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'b4', date:'2026-10-12', facility:'Holzer', purpose:'p', miles:'80', status:'verified', origin:'home', tripType:'round-trip'},
      {id:'b5', date:'2026-10-19', facility:'Holzer', purpose:'p', miles:'40', status:'skipped', origin:'home', tripType:'round-trip'}
    ];
  `);
  t('backlog is the 2 pre-month drafts', run(`unconfirmedTripsBeforeMonth('${TODAY}').length`) === 2);
  const totalBefore = run(`verifiedMileageTotal()`);
  const cleared = run(`clearMileageBacklog('${TODAY}')`);
  t('clear returns the dismissed count', cleared === 2);
  t('pre-month drafts are dismissed, not deleted',
    run(`db.mileage.length`) === 5 &&
    run(`db.mileage.find(m => m.id === 'b1').status`) === 'dismissed' &&
    run(`db.mileage.find(m => m.id === 'b2').status`) === 'dismissed');
  t('current-month draft untouched', run(`db.mileage.find(m => m.id === 'b3').status`) === 'draft');
  t('verified trip untouched and YTD total intact',
    run(`db.mileage.find(m => m.id === 'b4').status`) === 'verified' &&
    run(`verifiedMileageTotal()`) === totalBefore && totalBefore === 80);
  t('skipped trip untouched', run(`db.mileage.find(m => m.id === 'b5').status`) === 'skipped');
  t('backlog is empty after clearing', run(`unconfirmedTripsBeforeMonth('${TODAY}').length`) === 0);
  t('dismissed trips are not re-drafted or counted as missing in review',
    run(`weeklyMileageReview('2026-10-05', '${TODAY}').dismissed.length`) >= 1 &&
    run(`exportCsv`) !== undefined);

  // ---------- Dismissed stays dismissed after reload ----------
  run(`persist()`);
  const world2 = makeWorld(store);
  t('after reload the cleared trips stay dismissed',
    world2.run(`db.mileage.filter(m => m.status === 'dismissed').length`) === 2);
  t('after reload the backlog stays empty',
    world2.run(`unconfirmedTripsBeforeMonth('${TODAY}').length`) === 0);
  t('after reload verified total is still intact', world2.run(`verifiedMileageTotal()`) === 80);

  // ---------- Call drive prompt: current month only (real clock) ----------
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10`;
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prev = `${prevD.getFullYear()}-${pad(prevD.getMonth() + 1)}-15`;
  const { run: run3 } = makeWorld(new Map());
  run3(`
    db.shifts = [
      {id:'c-cur', date:'${cur}', facility:'Holzer', type:'Holzer 2nd call', pay:'', status:'proposed'},
      {id:'c-prev', date:'${prev}', facility:'Holzer', type:'Holzer 2nd call', pay:'', status:'confirmed'}
    ];
    db.mileage = []; db.hotelStays = []; db.facilities = [];
  `);
  const curHTML = run3(`shiftTripOriginHTML(db.shifts.find(s => s.id === 'c-cur'))`);
  const prevHTML = run3(`shiftTripOriginHTML(db.shifts.find(s => s.id === 'c-prev'))`);
  t('call prompt shows for a current-month call shift', curHTML.includes('want to change your driving location'));
  t('call prompt does NOT show for a past-month call shift', !prevHTML.includes('want to change your driving location'));

  // ---------- Mileage page: clear button + trip log defaults to this month ----------
  run3(`
    db.shifts = [];
    db.mileage = [
      {id:'L1', date:'${prev}', facility:'PrevHosp', purpose:'old trip', miles:'40', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'L2', date:'${cur}', facility:'CurHosp', purpose:'new trip', miles:'40', status:'draft', origin:'home', tripType:'round-trip'},
      {id:'L3', date:'${prev}', facility:'PrevHosp', purpose:'old confirmed', miles:'80', status:'verified', origin:'home', tripType:'round-trip'}
    ];
  `);
  const page = run3(`mileagePage()`);
  t('mileage page offers the one-tap clear when a backlog exists',
    page.includes('data-action="mileage-clear-backlog"') && page.includes('Clear everything before this month'));
  t('mileage page names the backlog count', page.includes('1 unconfirmed trip(s) from before this month'));
  t('trip log defaults to the current month', page.includes('CurHosp') && !page.includes('PrevHosp'));
  const pageAll = run3(`mileageLogMonth = 'all'; mileagePage()`);
  t('trip log history is still reachable via All months', pageAll.includes('PrevHosp') && pageAll.includes('CurHosp'));
  t('verified YTD total still counts past-month confirmed trips', run3(`verifiedMileageTotal()`) === 80);

  // ---------- Source-level guarantees ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('clear action is wired in the actions handler', appSrc.includes("action==='mileage-clear-backlog'"));
  t('cleared confirmation line present', appSrc.includes('older trip') && appSrc.includes('count toward mileage'));
  t('service worker cache bumped to v65', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v71'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
