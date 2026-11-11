// CRNA Hub — tests for the mileage export month picker (Nov 7, 2026,
// branch muse/credentialing).
// Run: node test-mileage-export-months.js
//
// Caleb's ask: let the user SELECT WHICH MONTHS to export mileage
// for. His case: he starts using CRNA Hub mid-year but already
// tracked mileage elsewhere up to today — a forced full-year export
// would double-count against those records. Before this build the
// mileage CSV was all-or-nothing (every confirmed trip, one tap, both
// from the Mileage tab and Account > Backup & restore).
//
// Covers:
//   * Default selection is the CURRENT month only — never a full year.
//   * Multi-month selection exports exactly those months' confirmed
//     trips; drafts/skipped/dismissed and other months are excluded.
//   * The CSV download the app performs carries exactly those rows
//     under a range filename (single month, contiguous range).
//   * Filename rules: mileage-2026-nov.csv / mileage-2026-sep-nov.csv.
//   * Live totals-line math ("N months · M trips · X mi").
//   * Quick actions: This month / Year to date / All / None.
//   * Months with no confirmed trips are listed but disabled.
//   * The picker is ONE shared implementation, reachable from the
//     Mileage tab (summary + trip log) and Account backup; the old
//     one-tap full export action is gone from the source.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store, downloads) {
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
    Blob: class { constructor(parts) { this.parts = parts; } },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake'; };
  sandbox.URL.revokeObjectURL = () => {};
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
  const downloads = [];
  const { run } = makeWorld(new Map(), downloads);

  // Fixtures are relative to the REAL current month so the
  // "current month" default is exercised honestly on any run date.
  run(`
    (() => {
      const pad = n => String(n).padStart(2, '0');
      const now = new Date();
      const mk = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
      const curY = now.getFullYear(), curM = now.getMonth();
      const rel = (off, d) => { const dt = new Date(curY, curM + off, 1); return mk(dt.getFullYear(), dt.getMonth(), d); };
      const trip = (id, date, miles, status) => ({id, date, facility:'Holzer', purpose:'work', miles:String(miles), status, origin:'home', tripType:'round-trip', oneWayMiles:'', milesSource:'manual', hotelAddress:''});
      window.__FX = {
        prev2: rel(-2, 5), prev1: rel(-1, 7), cur: rel(0, 3), draftOnly: rel(-3, 9),
      };
      const F = window.__FX;
      db.mileage = [
        trip('p2a', F.prev2, 100, 'verified'),
        trip('p2b', F.prev2, 50, 'verified'),
        trip('p2d', F.prev2, 999, 'draft'),
        trip('p1a', F.prev1, 200, 'verified'),
        trip('p1s', F.prev1, 888, 'skipped'),
        trip('c1',  F.cur,  25.5, 'verified'),
        trip('c2',  F.cur,  30, 'verified'),
        trip('cd',  F.cur,  777, 'draft'),
        trip('cx',  F.cur,  666, 'dismissed'),
        trip('d1',  F.draftOnly, 555, 'draft'),
      ];
      db.shifts = []; db.facilities = []; db.hotelStays = [];
      mileageExportYear = ''; mileageExportSel = null; mileageExportOpen = false;
    })();
  `);
  const FX = run(`window.__FX`);
  const pre2 = FX.prev2.slice(0, 7), pre1 = FX.prev1.slice(0, 7), curP = FX.cur.slice(0, 7);

  // ---------- Default selection: current month only ----------
  run(`mileageExportInit()`);
  t('default selection is exactly the current month', JSON.stringify(run(`mileageExportSelected()`)) === JSON.stringify([curP]));
  t('default trips are the current month confirmed ones only',
    JSON.stringify(run(`mileageExportTrips(mileageExportSelected()).map(m => m.id).sort()`)) === JSON.stringify(['c1', 'c2']));
  t('default totals line: 1 month · 2 trips · 55.5 mi',
    run(`mileageExportTotalsLine()`) === '1 month · 2 trips · 55.5 mi');
  t('single-month filename reflects the month',
    run(`mileageExportFilename(['${curP}'])`) === `mileage-${curP.slice(0, 4)}-${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][+curP.slice(5, 7) - 1]}.csv`);

  // ---------- Multi-month selection: exact contents ----------
  run(`mileageExportSel = new Set(['${pre2}', '${curP}'])`);
  t('two selected months yield exactly their confirmed trips',
    JSON.stringify(run(`mileageExportTrips(mileageExportSelected()).map(m => m.id).sort()`)) === JSON.stringify(['c1', 'c2', 'p2a', 'p2b']));
  t('unconfirmed trips are excluded even inside selected months',
    !run(`mileageExportTrips(mileageExportSelected()).some(m => ['p2d','p1s','cd','cx','d1'].includes(m.id))`));
  t('unselected month trips are excluded',
    !run(`mileageExportTrips(mileageExportSelected()).some(m => m.id === 'p1a')`));
  const sum = run(`mileageExportSummary(mileageExportSelected())`);
  t('summary math: 2 months · 4 trips · 205.5 mi', sum.months === 2 && sum.trips === 4 && sum.miles === 205.5);
  t('totals line matches the summary', run(`mileageExportTotalsLine()`) === '2 months · 4 trips · 205.5 mi');

  // ---------- The actual CSV download ----------
  run(`mileageExportDownload()`);
  t('one download happened', downloads.length === 1);
  const csv = downloads[0].parts.join('');
  const lines = csv.split('\r\n');
  t('CSV header matches the existing mileage columns',
    lines[0] === 'date,facility,purpose,miles,tripType,oneWayMiles,milesSource,origin,hotelAddress,status,vehicle');
  t('CSV has exactly the 4 selected confirmed rows', lines.length === 5);
  t('CSV rows are date-sorted and carry the right dates',
    lines[1].startsWith(FX.prev2) && lines[4].startsWith(FX.cur));
  t('CSV contains no draft/skipped/dismissed miles',
    !/(999|888|777|666|555)/.test(csv));

  // ---------- Filename rules ----------
  t('contiguous range filename is start-end month',
    run(`mileageExportFilename(['${pre2}', '${pre1}', '${curP}'])`)
      .endsWith('-' + ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][+pre2.slice(5, 7) - 1] + '-' + ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][+curP.slice(5, 7) - 1] + '.csv'));
  t('filename carries the year', run(`mileageExportFilename(['${pre2}', '${curP}'])`).startsWith(`mileage-${pre2.slice(0, 4)}-`));

  // ---------- Quick actions ----------
  run(`mileageExportYear = '${curP.slice(0, 4)}'; mileageExportApplyQuick('all')`);
  t('All selects every month with confirmed trips in the year',
    JSON.stringify(run(`mileageExportSelected()`)) === JSON.stringify([pre2, pre1, curP].filter(p => p.slice(0, 4) === curP.slice(0, 4))));
  run(`mileageExportApplyQuick('none')`);
  t('None empties the selection', run(`mileageExportSelected().length`) === 0 && run(`mileageExportTotalsLine()`) === '0 months · 0 trips · 0.0 mi');
  run(`mileageExportApplyQuick('ytd')`);
  const ytd = run(`mileageExportSelected()`);
  t('Year to date selects confirmed months up to the current month',
    ytd.includes(curP) && ytd.every(p => p <= curP));
  run(`mileageExportApplyQuick('this-month')`);
  t('This month reselects only the current month', JSON.stringify(run(`mileageExportSelected()`)) === JSON.stringify([curP]));

  // ---------- Picker HTML: months, disabled state, copy ----------
  run(`mileageExportOpen = true; mileageExportYear = '${curP.slice(0, 4)}'`);
  const picker = run(`mileageExportPickerHTML()`);
  t('picker states the confirmed-only rule in one line', picker.includes('Only confirmed trips export'));
  t('picker offers all four quick actions',
    ['mileage-export-this-month', 'mileage-export-ytd', 'mileage-export-all', 'mileage-export-none'].every(a => picker.includes(`data-action="${a}"`)));
  t('picker renders a checkbox per month with trips', (picker.match(/class="mileageExportMonth"/g) || []).length >= 3);
  t('picker shows the live totals line', picker.includes('id="mileageExportTotals"') && picker.includes(run(`mileageExportTotalsLine()`)));
  t('month with only drafts is listed as having no confirmed trips',
    picker.includes('no confirmed trips'));

  // ---------- Reachable from both homes, one implementation ----------
  const mileageHTML = run(`mileagePage()`);
  t('Mileage page: summary Export CSV button present', mileageHTML.includes('data-action="export-mileage"'));
  t('Mileage page: trip log has an Export mileage entry', mileageHTML.includes('Trip log') && mileageHTML.includes('Export mileage'));
  t('Mileage page renders the shared picker when open', mileageHTML.includes('id="mileageExportPicker"'));
  const accountHTML = run(`accountPage()`);
  t('Account backup renders the same shared picker when open', accountHTML.includes('id="mileageExportPicker"'));
  t('one picker implementation only', (fs.readFileSync(R + 'app.js', 'utf8').match(/function mileageExportPickerHTML/g) || []).length === 1);

  // ---------- The old one-tap full export is gone ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('no remaining direct all-trips mileage CSV action',
    !appSrc.includes(`exportCsv('crna-hub-mileage.csv'`) && !appSrc.includes('crna-hub-mileage.csv'));
  t('export-mileage now opens the picker', appSrc.includes(`action==='export-mileage'){mileageExportInit();mileageExportOpen=true`));
  t('download goes through the selection', appSrc.includes('mileageExportDownload()'));
  t('service worker cache bumped to v67', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v126'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
