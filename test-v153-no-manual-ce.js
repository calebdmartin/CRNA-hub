// CRNA Hub — v153 (Nov 12, 2026): the manual CE form is REMOVED.
// Caleb, with a screenshot of the Continuing education section:
// "Let's get rid of the manual CE tab." CE records are never typed
// in — they arrive from portal reads (CE Broker agent reads file
// the transcript; AANA reads file their totals) with licState /
// licType / category already set, so the v150 progress math keeps
// working untouched. The Continuing education section REMAINS as
// the read-only home for courses on file: BOTH lists (NBCRNA CE +
// AANA CE) with their totals and per-record source labels, no
// toggle, no form, no edit affordances. The CE Broker card's
// backup no longer offers typing — there is no typing fallback
// for a transcript; its button just scrolls to view the courses.
// Storage, the cloud round-trip, the assignment sidecar, the
// filing door and the watchdog are all untouched.
// Run: node test-v153-no-manual-ce.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {},
  };
}
const elements = {};
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
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
  fetch: async (url, opts) => {
    if (((opts && opts.method) || 'GET') === 'GET') return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
    return { status: 201, ok: true, text: async () => '', json: async () => ({}) };
  },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);
const panelTag = (html, id) => {
  const m = html.match(new RegExp('<details class="panel collapse-panel" id="' + id + '"( open)?>'));
  return m ? m[0] : null;
};
const seg = (html, fromId, toId) => {
  const a = html.indexOf('id="' + fromId + '"');
  const b = toId ? html.indexOf('id="' + toId + '"') : html.length;
  return a < 0 ? '' : html.slice(a, b < 0 ? html.length : b);
};
const RESET = `
  db = empty();
  editId = null; manualType = 'NBCRNA'; onboardStep = 0;
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = '';
  cloudSession = null; cloudActive = false; cloudPortals = []; cloudSyncTimes = {};
  portalAttemptFailed = {}; portalDepartureCache = null; portalDepartureLoaded = false;
  try { localStorage.removeItem('crna-hub-portal-departure'); } catch (e) {}
`;

(async () => {
  // ---------- Source: the form and its wiring are gone ----------
  t('source: no ceForm component remains',
    !appSrc.includes('function ceForm('));
  t('source: no ceType state / ceTypeSelect wiring remains',
    !appSrc.includes('ceType') && !appSrc.includes('ceTypeSelect'));
  t('source: no Add CE record / Save CE record button text remains',
    !appSrc.includes('Add CE record') && !appSrc.includes('Save CE record'));
  t('source: the picker helpers went with the form',
    !appSrc.includes('function ceCountsTowardPairs(') && !appSrc.includes('function ceCategoryLabels('));

  // ---------- Empty state ----------
  run(RESET + `globalThis.__page0 = credentialsPage();`);
  const seg0 = seg(sandbox.__page0, 'credentials-ce-panel', 'cert-documents');
  t('empty: the friendly empty-state line renders',
    seg0.includes('No courses on file yet — they arrive here from your AANA and CE Broker reads.'));
  t('empty: no totals lines, no lists, no form fields',
    !seg0.includes('Recorded totals') && !seg0.includes('Recorded total:') &&
    !seg0.includes('<form') && !seg0.includes('Course / activity'));
  t('empty: the section starts open (nothing on file yet)',
    panelTag(sandbox.__page0, 'credentials-ce-panel').includes(' open'));

  // ---------- Both lists, display-only ----------
  run(RESET + `
    db.nbcrnaCE = [
      { id: 'n1', title: 'Anesthesia Pharmacology', date: '2026-03-01', credits: '3', class: 'Class A', source: 'cebroker' },
      { id: 'n2', title: 'Regional Techniques', date: '2026-02-01', credits: '2', class: 'Class B', source: 'user_entered' }
    ];
    db.aanaCE = [
      { id: 'a1', title: 'Airway Management', date: '2026-04-15', credits: '7', source: 'cebroker' }
    ];
    globalThis.__page1 = credentialsPage();
  `);
  const seg1 = seg(sandbox.__page1, 'credentials-ce-panel', 'cert-documents');
  t('lists: BOTH lists render at once under their own headings (no toggle)',
    seg1.includes('<h3>NBCRNA CE</h3>') && seg1.includes('<h3>AANA CE</h3>') &&
    !seg1.includes('ceTypeSelect'));
  t('lists: totals lines render from the records on file',
    seg1.includes('Recorded totals — Class A: 3 · Class B: 2 · All: 5') &&
    seg1.includes('Recorded total: 7 credits'));
  t('lists: every record renders (title, date, credits)',
    seg1.includes('Anesthesia Pharmacology') && seg1.includes('Regional Techniques') &&
    seg1.includes('Airway Management'));
  t('lists: CE Broker-sourced records are labelled, others are not',
    (seg1.match(/Read from CE Broker/g) || []).length === 2, J(seg1.match(/Read from CE Broker/g)));
  t('lists: display-only — no Edit/Delete affordances for CE records',
    !seg1.includes('data-action="edit-nbcrnaCE"') && !seg1.includes('data-action="delete-nbcrnaCE"') &&
    !seg1.includes('data-action="edit-aanaCE"') && !seg1.includes('data-action="delete-aanaCE"') &&
    !seg1.includes('>Edit</button>') && !seg1.includes('>Delete</button>'));
  t('lists: no form fields anywhere in the section',
    !seg1.includes('<form') && !seg1.includes('name="countsToward"') && !seg1.includes('name="category"') &&
    !seg1.includes('name="title"') && !seg1.includes('Course / activity'));
  t('header: summary counts the courses on file; section rests collapsed',
    sandbox.__page1.includes('Continuing education · 3 courses on file') &&
    !panelTag(sandbox.__page1, 'credentials-ce-panel').includes(' open'));
  t('page: no CE-kind form exists anywhere on the Credentials page',
    !sandbox.__page1.includes('data-kind="nbcrnaCE"') && !sandbox.__page1.includes('data-kind="aanaCE"'));

  // ---------- CE Broker card backup: no typing fallback ----------
  const cbSeg = seg(sandbox.__page1, 'credentials-cebroker-panel', 'credentials-ce-panel');
  t('CE Broker backup: honest copy — no typing fallback for a transcript',
    cbSeg.includes('there’s no typing fallback for a transcript') &&
    !cbSeg.includes('type the courses in yourself') && !cbSeg.includes('Add courses by hand'));
  t('CE Broker backup: the button only views — "See my courses" (ce-section-goto kept)',
    cbSeg.includes('data-action="ce-section-goto"') && cbSeg.includes('See my courses'));
  run(`tab = 'Dashboard'; actions('ce-section-goto'); globalThis.__gotoTab = tab;`);
  t('ce-section-goto: lands on Credentials (scroll-to-view only)',
    sandbox.__gotoTab === 'Credentials');
  run(RESET + `
    globalThis.__guard = applyPortalCheckRecord('cebroker', { status: 'Active', expiry: '2027-01-01' }, '2026-11-12T00:00:00.000Z');
  `);
  t('guided-check refusal: points at the read-only section, never at hand entry',
    String(sandbox.__guard).includes('Continuing education section') &&
    !String(sandbox.__guard).includes('by hand') && run(`db.licenses.length`) === 0);

  // ---------- Manual entry still has no CE types (v151 holds) ----------
  run(RESET + `globalThis.__pageM = credentialsPage();`);
  t('manual panel: Entry type offers no CE record types',
    !sandbox.__pageM.includes('>NBCRNA CE record<') && !sandbox.__pageM.includes('>AANA CE record<') &&
    sandbox.__pageM.includes('>NBCRNA</option>') && sandbox.__pageM.includes('>Other credential</option>'));

  // ---------- The pipeline is untouched: progress off filed records ----------
  run(RESET + `
    db.licenses = [{ id: 'wv-aprn', state: 'WV', type: 'APRN-CRNA', number: '103459', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7' }];
    db.aanaCE = [{ id: 'f1', title: 'Pharm course', date: '2026-01-15', credits: '4', licState: 'West Virginia', licType: 'APRN-CRNA', category: 'pharmacotherapeutics', source: 'cebroker' }];
    globalThis.__prog = ceProgressFor(db.licenses[0], ceRequirementFor(db.licenses[0]));
  `);
  t('pipeline: v150 progress still counts records filed by reads (no form involved)',
    sandbox.__prog && sandbox.__prog.total === 4 &&
    sandbox.__prog.subs.find(s => s.label === 'pharmacotherapeutics').have === 4, J(sandbox.__prog));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
