// CRNA Hub — v160 (Nov 13, 2026): the Assistant's credentials summary.
//
// THE BUG (diagnosed Nov 13, 2026): buildAssistantSummary() filled its
// `credentials` entry from credentialDeadlines() — the <=90-day
// REMINDER-WINDOW list. A fully-loaded account whose deadlines are all
// >90 days out therefore sent credentials: [] and the live AI answered
// "no credentials on file."
//
// THE FIX (summary builder ONLY): credentials is now an object
// { onFile, dueSoon } under the same allowed top-level key —
//   onFile  = dedupeDeadlines(collectDeadlineItems()), date-sorted,
//             slim {label,date,days}, up to 12 — EVERYTHING recorded.
//   dueSoon = the existing credentialDeadlines() result, slim-mapped,
//             up to 8 — the reminder window, unchanged.
// credentialDeadlines() itself is NOT widened: its window semantics are
// what reminders and the watchdog rely on (pinned below: still []).
//
// What this pins:
//  1 a full credential set seeded ENTIRELY outside the window (portal-
//    source row shapes) -> credentialDeadlines() still returns [].
//  2 the summary's credentials.onFile carries ALL of them, date-sorted,
//    slim-shaped; credentials.dueSoon is [] (window truthfully empty).
//  3 the v157 contract re-pinned: client top keys subset of the
//    function's ALLOWED_TOP_KEYS (parsed from index.ts) and no
//    DENIED_KEYS entry at any depth of the summary.
//  4 a near-window control (+30 days) appears in BOTH halves: onFile
//    (as the soonest item) and dueSoon.
//  5 SYSTEM_PROMPT carries the onFile/dueSoon sentence, so the model
//    never reads an empty dueSoon as "no credentials on file".
// Run: node test-v160-assistant-credentials.js
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
sandbox.liveSyncPost = async () => ({});
vm.createContext(sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : (extra ? '  [' + extra + ']' : '')));
  if (cond) pass++; else fail++;
};

const edgeSrc = fs.readFileSync(R + 'supabase/functions/assistant-chat/index.ts', 'utf8');
run(fs.readFileSync(R + 'app.js', 'utf8'));

// ---------- full credential set, ALL dates far outside the window ----------
// Portal-source row shapes (what the agent reads file into the app).
run(`
  db.nbcrna = { status: 'Certified', number: '', periodStart: '2027-05-01', periodEnd: '2031-04-30', renewalDeadline: '2031-04-30', classA: '103', classB: '2', macEd: '60', macDev: '40', macEdRequired: 60, macDevRequired: 40, reminders: '90,60,30,7', source: 'agent_read' };
  db.aana = { status: 'Active', number: '', expiration: '2028-08-31', reminders: '90,60,30,7', source: 'agent_read' };
  db.licenses = [
    { state: 'West Virginia', type: 'RN', status: 'Active', expiry: '2028-06-30', reminders: '90,60,30,7', source: 'agent_read' },
    { state: 'West Virginia', type: 'APRN-CRNA', status: 'Active', expiry: '2029-06-30', reminders: '90,60,30,7', source: 'agent_read' },
    { state: 'Ohio', type: 'RN', status: 'Active', expiry: '2028-06-30', reminders: '90,60,30,7', source: 'agent_read' },
    { state: 'Ohio', type: 'APRN-CRNA', status: 'Active', expiry: '2028-10-31', reminders: '90,60,30,7', source: 'agent_read' }
  ];
  db.documents = [
    { certType: 'ACLS', expiry: '2028-05-31', expirySource: 'extracted' },
    { certType: 'BLS', expiry: '2028-03-31', expirySource: 'extracted' },
    { certType: 'PALS', expiry: '2028-09-30', expirySource: 'extracted' }
  ];
  db.credentials = [{ name: 'TNCC', expiry: '2028-12-31' }];
  db.shifts = []; db.facilities = []; db.mileage = []; db.pto = []; db.nbcrnaCE = []; db.aanaCE = [];
`);

const EXPECTED = [
  ['BLS certification', '2028-03-31'],
  ['ACLS certification', '2028-05-31'],
  ['West Virginia RN', '2028-06-30'],
  ['Ohio RN', '2028-06-30'],
  ['AANA membership', '2028-08-31'],
  ['PALS certification', '2028-09-30'],
  ['Ohio APRN-CRNA', '2028-10-31'],
  ['TNCC', '2028-12-31'],
  ['West Virginia APRN-CRNA', '2029-06-30'],
  ['NBCRNA certification', '2031-04-30'],
];

// ---------- 1: the reminder window itself is NOT widened ----------
const win = run(`credentialDeadlines()`);
t('1 credentialDeadlines() still returns [] (window semantics untouched)',
  Array.isArray(win) && win.length === 0, JSON.stringify(win));

// ---------- 2: onFile carries everything, date-sorted, slim ----------
const summary = run(`buildAssistantSummary()`);
const cred = summary.credentials || {};
const onFile = Array.isArray(cred.onFile) ? cred.onFile : [];
t('2a credentials is the { onFile, dueSoon } object under the same key',
  !!cred && Array.isArray(cred.onFile) && Array.isArray(cred.dueSoon),
  JSON.stringify(Object.keys(cred || {})));
t('2b onFile carries ALL 10 recorded deadlines',
  onFile.length === EXPECTED.length,
  'got ' + onFile.length + ': ' + onFile.map(x => x.label + '|' + x.date).join(', '));
t('2c onFile items are exactly the recorded set (label|date)',
  EXPECTED.every(([l, d]) => onFile.some(x => x.label === l && x.date === d)) &&
  onFile.every(x => EXPECTED.some(([l, d]) => x.label === l && x.date === d)));
t('2d onFile is date-sorted ascending',
  onFile.every((x, i) => i === 0 || onFile[i - 1].date <= x.date),
  onFile.map(x => x.date).join(','));
t('2e onFile items are slim {label,date,days} with days > 90 (outside the window)',
  onFile.every(x => {
    const ks = Object.keys(x).sort().join(',');
    return ks === 'date,days,label' && typeof x.days === 'number' && x.days > 90;
  }), JSON.stringify(onFile[0] || {}));
t('2f dueSoon is [] — the window is truthfully empty, the inventory is not',
  Array.isArray(cred.dueSoon) && cred.dueSoon.length === 0, JSON.stringify(cred.dueSoon));

// ---------- 3: the v157 contract, re-pinned ----------
function parseKeySet(src, constName) {
  const m = src.match(new RegExp('const ' + constName + ' = new Set\\(\\[([\\s\\S]*?)\\]\\);'));
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
}
const ALLOWED = parseKeySet(edgeSrc, 'ALLOWED_TOP_KEYS');
const DENIED = parseKeySet(edgeSrc, 'DENIED_KEYS');
t('3a contract: every client top-level key is allowed by the function',
  !!ALLOWED && Object.keys(summary).every(k => ALLOWED.has(k)),
  'client keys: ' + Object.keys(summary).join(','));
let deniedHit = null;
(function walk(v, p) {
  if (deniedHit || !v || typeof v !== 'object') return;
  for (const [k, val] of Object.entries(v)) {
    if (DENIED && DENIED.has(k)) { deniedHit = p + k; return; }
    walk(val, p + k + '.');
  }
})(summary, '');
t('3b contract: no denied key appears at any depth (onFile/dueSoon/label/date/days are safe)',
  deniedHit === null, deniedHit || '');

// ---------- 4: near-window control appears in BOTH halves ----------
const d30 = new Date(Date.now() + 30 * 864e5);
const pad = (n) => String(n).padStart(2, '0');
const d30s = d30.getFullYear() + '-' + pad(d30.getMonth() + 1) + '-' + pad(d30.getDate());
run(`db.licenses.push({ state: 'Delaware', type: 'RN', status: 'Active', expiry: '${d30s}', reminders: '90,60,30,7', source: 'agent_read' });`);
const win2 = run(`credentialDeadlines()`);
t('4a control: credentialDeadlines() now returns exactly the +30d item',
  win2.length === 1 && win2[0].label === 'Delaware RN' && win2[0].date === d30s,
  JSON.stringify(win2));
const summary2 = run(`buildAssistantSummary()`);
t('4b control: dueSoon carries the +30d item',
  summary2.credentials.dueSoon.length === 1 && summary2.credentials.dueSoon[0].label === 'Delaware RN' &&
  summary2.credentials.dueSoon[0].date === d30s,
  JSON.stringify(summary2.credentials.dueSoon));
t('4c control: onFile carries it too, first (soonest date)',
  summary2.credentials.onFile.length === EXPECTED.length + 1 &&
  summary2.credentials.onFile[0].label === 'Delaware RN' && summary2.credentials.onFile[0].date === d30s,
  JSON.stringify(summary2.credentials.onFile[0] || {}));

// ---------- 5: the prompt sentence ----------
const flat = edgeSrc.replace(/"\s*\+\s*"/g, '').replace(/\s+/g, ' ');
t('5 SYSTEM_PROMPT explains onFile vs dueSoon (empty dueSoon != nothing on file)',
  flat.includes('In the credentials section, onFile lists everything recorded and dueSoon lists only what is expired or due within its reminder window; an empty dueSoon never means no credentials are on file — when dueSoon is empty, say nothing is expiring soon and name the soonest item in onFile.'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
