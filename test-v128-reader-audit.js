// Nov 11, 2026 — v128 reader audit (second scope extension:
// "Make sure all ai readers in the app get that same
// update"). Every reader surface gets the same three
// guarantees as the pay-words describer: (a) varied
// real-world input resolves, (b) NOTHING is silently
// dropped — what can't be read is named, never guessed or
// vanished, (c) layered reads merge as a union.
//
// This file covers the readers exercisable as pure client
// functions, with a variation corpus proportionate to each
// domain. The remaining surfaces are covered where they
// live: the pay-words describer by
// test-v128-universal-reader.js; the QGenda feed parser and
// the contract/schedule/paystub/portal AI normalizers by
// their Deno suites (qgenda-feed/parse.test.ts,
// extract-contract/normalize.test.ts — 55/55 with the one
// stale grid-field expectation refreshed); the client
// QGenda / schedule-grid / portal flows by their existing
// node suites, re-run this round.
//
// Readers audited here:
//  5. Pay-stub reader (parsePaystubText): employer, period,
//     pay date, gross across varied stub layouts; a field
//     the stub does not state is ABSENT from `found` and
//     null/empty in the result — surfaced as a blank the
//     user fills, never a fabricated value.
//  7. Portal screenshot reader, text half
//     (parsePortalCheckText): every field it cannot find on
//     the page lands in `missing` by name; a page that is
//     not the expected portal reads as all-missing, never
//     as a verified state.
//  6. Certification/credential reader
//     (extractExpiryDateInfo): expiry dates across varied
//     cert layouts; text with no readable date yields no
//     date — flagged by the caller, never invented.
//  2. Contract reader, deterministic half
//     (contractExtractRates): rate phrasings across varied
//     contract language resolve to the same rate fields.
//
// Run: node test-v128-reader-audit.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [],
    createElement: () => el(), body: { append() {} },
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
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) { fails++; process.exitCode = 1; } };
const J = (v) => JSON.stringify(v);

// ---------- 5. Pay-stub reader ----------
{
  const stub = (txt) => run(`parsePaystubText(${J(txt)})`);
  const s1 = stub('Premier Anesthesia Group, PC\nEmployer: Premier Anesthesia Group, PC\nPayment Date: 11/10/2026\nPay Period: 10/19/2026 - 11/01/2026\nGross Pay: $12,757.50');
  t('S1 Caleb-shaped stub: agency, pay date, period, gross all read', s1.agency.includes('Premier') && s1.payDate === '2026-11-10' && s1.periodStart === '2026-10-19' && s1.periodEnd === '2026-11-01' && s1.gross === 12757.5 && s1.frequency === 'biweekly', J(s1));
  const s2 = stub('Company Name: ACME Staffing LLC\nCheck Date 11/24/2026\nPeriod: 11/02/2026 to 11/15/2026\nTotal Gross $27,075.00\nNet Pay: $21,340.10');
  t('S2 variant labels + ISO-free dates + net read', s2.agency.includes('ACME') && s2.payDate === '2026-11-24' && s2.periodStart === '2026-11-02' && s2.periodEnd === '2026-11-15' && s2.gross === 27075 && s2.net === 21340.1, J(s2));
  const s3 = stub('Agency - Locums R Us\nPay Date: November 10, 2026\nPay period: October 19, 2026 through November 1, 2026\nGross earnings: 12757.50');
  t('S3 long-form month names read', s3.payDate === '2026-11-10' && s3.periodStart === '2026-10-19' && s3.periodEnd === '2026-11-01' && Number(s3.gross) === 12757.5, J(s3));
  const s4 = stub('Employer: Weekly Pay Co\nPay Date: 2026-11-06\nPay Period: 2026-10-26 - 2026-11-01\nGross amount: $4,800.00\nPay frequency: weekly');
  t('S4 ISO dates + stated weekly frequency read', s4.payDate === '2026-11-06' && s4.periodStart === '2026-10-26' && s4.periodEnd === '2026-11-01' && s4.gross === 4800 && s4.frequency === 'weekly', J(s4));
  const s5 = stub('Employer: Mystery Agency\nSome earnings statement text with no labeled amounts or dates at all.');
  t('S5 SURFACE: nothing labeled → nothing fabricated; found names only what was read (agency only)', s5.gross === null && s5.payDate === '' && s5.periodStart === '' && !s5.found.includes('Gross pay') && !s5.found.includes('Pay date') && s5.found.includes('Agency / employer'), J(s5));
  const s6 = stub('Payroll statement\nGross Pay: $1,234.56');
  t('S6 SURFACE: gross alone reads as gross alone — no invented agency, dates, or frequency', s6.gross === 1234.56 && s6.agency === '' && s6.payDate === '' && s6.periodStart === '' && s6.frequency === '' && J(s6.found) === '["Gross pay"]', J(s6));
}

// ---------- 7. Portal screenshot reader (deterministic text half) ----------
{
  const pc = (txt, src) => run(`parsePortalCheckText(${J(txt)}, ${J(src)}, {})`);
  const nb = pc('NBCRNA Certification Status: Certified. Certification Period: May 1, 2023 - April 30, 2027. Certification Number: 126402. CPC Check-In Status: Complete.', 'nbcrna');
  t('R1 NBCRNA page: status, number, period read and reported found', nb.fields.status === 'Certified' && nb.fields.number === '126402' && nb.fields.periodStart === '2023-05-01' && nb.fields.periodEnd === '2027-04-30' && nb.found.includes('Certification status'), J(nb));
  const wrong = pc('Welcome to your bank. Your checking balance is $4,210.55. Last login Tuesday.', 'nbcrna');
  t('R2 SURFACE: the WRONG page reads as all-missing — never a verified state', wrong.found.length === 0 && wrong.missing.length >= 3 && !wrong.fields.status, J(wrong));
  const blank = pc('', 'wv');
  t('R3 SURFACE: a blank page reads as all-missing', blank.found.length === 0 && blank.missing.length >= 2, J(blank));
  const wv = pc('West Virginia Board of Nursing License Lookup. License Number: 86131. Status: Active. Expiration Date: June 30, 2028.', 'wv');
  t('R4 WV license page: number + status read', wv.fields.number === '86131' && /active/i.test(wv.fields.status || '') && wv.found.includes('License status'), J(wv));
}

// ---------- 6. Certification / credential expiry reader ----------
{
  const ex = (txt) => run(`extractExpiryDateInfo(${J(txt)}, {})`);
  const layouts = [
    ['Expires: 06/30/2027', '2027-06-30'],
    ['Expiration Date: April 30, 2027', '2027-04-30'],
    ['Valid through 2027-10-31', '2027-10-31'],
    ['Renewal date: 30 Jun 2027', '2027-06-30'],
    ['Card expires 12/2028', '2028-12'],
  ];
  let okN = 0; const det = [];
  for (const [txt, want] of layouts) { const r = ex(txt); const iso = r && (r.iso || r.date || ''); if (String(iso).startsWith(want)) okN++; else det.push(txt + ' → ' + J(r)); }
  t('E1 expiry dates read across 5 cert layouts', okN === layouts.length, det.join('; ') || undefined);
  const none = ex('American Association of Nurse Anesthetists. This card belongs to the person named below. No dates appear anywhere on it.');
  t('E2 SURFACE: a cert with no readable date yields NO date — flagged by the caller, never invented', !(none && (none.iso || none.date)), J(none));
}

// ---------- 2. Contract reader (deterministic rates half) ----------
{
  const cr = (txt) => run(`contractExtractRates(${J(txt)})`);
  const variants = [
    ['Day shifts pay $250/hr', 250],
    ['hourly rate of $250 per hour', 250],
    ['$250 an hour for day shifts', 250],
    ['250/hr for all day work', 250],
    ['$250 hourly', 250],
  ];
  let okN = 0; const det = [];
  for (const [txt, want] of variants) { const r = cr(txt); const v = r && (r.hourly != null ? r.hourly : r.hourlyRate); if (Number(v) === want) okN++; else det.push(txt + ' → ' + J(r)); }
  t('K1 hourly rate read across 5 contract phrasings', okN === variants.length, det.join('; ') || undefined);
  const callTxt = 'First call (24 hour) pays $4,800 on weekdays and $4,200 on weekends. Second call pays $3,000 weekdays, $2,000 weekends.';
  const callP = run(`describeParseLocal(${J(callTxt)}, null, [{ code: 'HOLZ - Call 1', ctype: '24-hour call' }, { code: 'HOLZ - Call 2', ctype: 'Second call' }])`);
  t('K2 call splits read from prose — each call keeps its OWN amounts', Number(callP.rates.rate24) === 4800 && Number(callP.rates.weekendRate24) === 4200 && Number(callP.rates.rateSecond) === 3000 && Number(callP.rates.weekendRateSecond) === 2000, J(callP.rates));
}

console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
