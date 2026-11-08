// CRNA Hub — cross-source shift dedupe (Nov 6, 2026). Caleb's
// scenario: a user syncs their calendar, uploads a contract, AND
// connects QGenda. The same shift arriving from more than one source
// must land as ONE shift, priced once:
//   * identity = date + facility + shift type/code (facility by its
//     canonical saved name, type case/space-insensitive; start time
//     decides only when both records carry one);
//   * on a match: one record, survivor keeps its id, richest data
//     wins per field, status never downgrades, and the record
//     remembers every source in `sources`;
//   * removing the shift from ONE source unlinks only that source —
//     the record dies only with its last source;
//   * same day + different facility or different type = two shifts;
//   * duplicates already stored collapse on the dedupe pass (the
//     same pass boot and the cloud merge run).
// Run: node test-shift-dedupe.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = fs.existsSync(path.join(__dirname, 'repo', 'app.js'))
  ? path.join(__dirname, 'repo') + path.sep
  : __dirname + path.sep;
const store = new Map();
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
  Blob,
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
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const liveSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

// ---------- Wiring: every door uses the identity rule ----------
t('wiring: calendar sync create merges by identity (no exact-string skip)',
  liveSrc.includes('findSameShift(recIn, db.shifts)') && liveSrc.includes('mergeShiftInto(byIdIn || twinIn, recIn)'));
t('wiring: QGenda + schedule + .ics previews flag duplicates by identity',
  (appSrc.match(/shiftsSameShift\(x,\{date,facility,type\}\)/g) || []).length >= 2 &&
  appSrc.includes('shiftsSameShift(x,r)') && appSrc.includes('shiftsSameShift(x,{date,facility,type})'));
t('wiring: approvals + CSV + contract + manual add enter via addShiftDeduped',
  (appSrc.match(/addShiftDeduped\(\{/g) || []).length >= 4 && appSrc.includes('addShiftDeduped(rec).shift.id'));
t('wiring: cloud merge collapses + tombstones absorbed ids; boot runs the pass',
  appSrc.includes("dedupeShiftsInPlace((absorbedId) => { cloudRecordTombstone('shifts', absorbedId); })") &&
  appSrc.includes('const bootDedupe=dedupeShiftsInPlace()'));
t('service worker cache bumped to v65', swSrc.includes('crna-hub-shell-v74'));

// ---------- Setup: Holzer saved as a facility ----------
run(`
  db.facilities = [{ id: 'fac-holzer', name: 'Holzer', aliases: '', address: '', rate8: '2125', rate10: '', rate12: '', rate24: '', rateSecond: '', weekendRateSecond: '', hourlyRate: '250', paidHours8: '8.5', callBonus: '', distance: '', notes: '' }];
  db.shifts = [];
  db.settings.scheduleName = 'Martin';
  liveSyncState.pending = []; liveSyncState.shiftSync = {}; liveSyncState.tombstones = [];
`);

// ---------- 1. The triple-source scenario ----------
// (a) Calendar sync brings the shift first (past date -> confirmed, priced).
run(`
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'create', shift: { id: 'cal-1', date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', note: 'Imported from Caleb Work Schedule', source: 'apple-import', updatedAt: null } },
  ], pendingDeletions: [], imported: null });
`);
t('calendar arrival creates the shift', run(`db.shifts.length`) === 1 && run(`db.shifts[0].id`) === 'cal-1');

// (b) QGenda feed shows the same shift, unpriced. Its preview row is a
// flagged duplicate — approving must merge it in, not add a copy.
run(`
  schedulePreview = { fileName: 'QGenda feed', source: 'qgenda-feed', matchedName: 'Martin', noNamesInFile: false, ai: false, rows: [
    { date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: true, flags: ['already in CRNA Hub — will merge, not double'], source: 'qgenda-feed', incomplete: true },
  ]};
  approveScheduleImport();
`);
t('QGenda arrival merges — still exactly one shift, id stable',
  run(`db.shifts.length`) === 1 && run(`db.shifts[0].id`) === 'cal-1');
t('the one record remembers calendar + QGenda sources',
  run(`shiftSourcesList(db.shifts[0]).includes('apple-import') && shiftSourcesList(db.shifts[0]).includes('qgenda-feed')`));
t('merge kept the priced, confirmed copy (no downgrade)',
  run(`db.shifts[0].pay`) === '2125' && run(`db.shifts[0].status`) === 'confirmed' && run(`db.shifts[0].incomplete`) === false);

// (c) A schedule upload shows it a third time — same outcome.
run(`
  schedulePreview = { fileName: 'nov-schedule.csv', source: 'schedule-import', matchedName: 'Martin', noNamesInFile: false, ai: false, rows: [
    { date: '2026-11-03', facility: 'Holzer', type: '8-hour day', pay: '2125', name: 'Martin', matchedName: 'Martin', match: 'matched', include: true, duplicate: true, flags: [], source: 'schedule-import', incomplete: false },
  ]};
  approveScheduleImport();
`);
t('schedule-upload arrival merges too — one shift, three sources',
  run(`db.shifts.length`) === 1 && run(`shiftSourcesList(db.shifts[0]).length`) === 3 &&
  run(`shiftSourcesList(db.shifts[0]).includes('schedule-import')`));

// Income: priced ONCE in C/P (past + confirmed -> C year-to-date).
t('C/P counts the triple-sourced shift once ($2,125, not $6,375)',
  run(`yearIncomeSplit(2026).c.ytd`) === 2125 &&
  run(`yearIncomeSplit(2026).p.ytd`) === 2125 &&
  run(`monthIncomeSplit('2026-11').total`) === 1);

// ---------- 2. Removal from ONE source unlinks only that source ----------
run(`
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'delete', shiftId: 'cal-1' },
  ], pendingDeletions: [], imported: null });
`);
t('calendar removal leaves the shift (QGenda + upload still show it)',
  run(`db.shifts.length`) === 1 &&
  run(`!shiftSourcesList(db.shifts[0]).includes('apple-import')`) &&
  run(`shiftSourcesList(db.shifts[0]).includes('qgenda-feed')`) &&
  run(`shiftSourcesList(db.shifts[0]).includes('schedule-import')`));

// Removing it from its last sources behaves like a normal delete.
run(`
  db.shifts[0].sources = ['apple-import']; db.shifts[0].source = 'apple-import';
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'delete', shiftId: 'cal-1' },
  ], pendingDeletions: [], imported: null });
`);
t('removal from the last source deletes the record', run(`db.shifts.length`) === 0);

// Single-source calendar shift: create then delete -> gone (old behaviour).
run(`
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'create', shift: { id: 'cal-2', date: '2026-11-05', facility: 'Holzer', type: '8-hour day', pay: '2125', note: '', source: 'apple-import', updatedAt: null } },
  ], pendingDeletions: [], imported: null });
  liveSyncApplyChanges('apple', { providerChanges: [
    { action: 'delete', shiftId: 'cal-2' },
  ], pendingDeletions: [], imported: null });
`);
t('single-source create + delete still round-trips', run(`db.shifts.length`) === 0);

// ---------- 3. Different shifts on the same day are NOT merged ----------
run(`
  addShiftDeduped({ id: 'm-1', date: '2026-11-10', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed', source: 'user-entered', incomplete: false });
  addShiftDeduped({ id: 'm-2', date: '2026-11-10', facility: 'Holzer', type: 'Second call', pay: '3000', status: 'proposed', source: 'user-entered', incomplete: false });
  addShiftDeduped({ id: 'm-3', date: '2026-11-10', facility: 'CAMC', type: '8-hour day', pay: '2000', status: 'proposed', source: 'user-entered', incomplete: false });
`);
t('same day, different type and different facility stay separate',
  run(`db.shifts.length`) === 3);
run(`
  globalThis.__m = addShiftDeduped({ id: 'm-4', date: '2026-11-10', facility: 'Holzer', type: '8-Hour Day', pay: '', status: 'proposed', source: 'csv-import', incomplete: true });
`);
t('type matching is case-insensitive — the variant merges, richest pay kept',
  run(`db.shifts.length`) === 3 && run(`globalThis.__m.merged`) === true && run(`db.shifts.find(x=>x.id==='m-1').pay`) === '2125');

// ---------- 4. Pre-duplicated data collapses, best data kept ----------
run(`
  db.shifts = [
    { id: 'dup-a', date: '2026-11-12', facility: 'Holzer', type: '8-hour day', pay: '', status: 'proposed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: true, note: '', updatedAt: '2026-11-01T00:00:00Z' },
    { id: 'dup-b', date: '2026-11-12', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false, note: 'Imported from Caleb Work Schedule', updatedAt: '2026-11-02T00:00:00Z' },
    { id: 'dup-c', date: '2026-11-12', facility: 'Holzer', type: '8-hour day', pay: '', status: 'submitted', source: 'extracted-from-contract', sources: ['extracted-from-contract'], incomplete: true, note: '', contractId: 'contract-9', updatedAt: '2026-11-03T00:00:00Z' },
    { id: 'keep-1', date: '2026-11-13', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'proposed', source: 'user-entered', incomplete: false },
  ];
  globalThis.__absorbed = [];
  globalThis.__dd = dedupeShiftsInPlace((absorbedId, survivorId) => { globalThis.__absorbed.push(absorbedId + '>' + survivorId); });
`);
t('pre-duplicated dataset collapses to one record per identity',
  run(`db.shifts.length`) === 2 && run(`globalThis.__dd.collapsed`) === 2);
t('survivor keeps the calendar id (pairing key) and the best data',
  run(`db.shifts.some(x=>x.id==='dup-b')`) &&
  run(`db.shifts.find(x=>x.date==='2026-11-12').pay`) === '2125' &&
  run(`db.shifts.find(x=>x.date==='2026-11-12').status`) === 'confirmed' &&
  run(`db.shifts.find(x=>x.date==='2026-11-12').contractId`) === 'contract-9');
t('no source link is lost in the collapse',
  run(`shiftSourcesList(db.shifts.find(x=>x.date==='2026-11-12')).length`) === 3);
t('absorbed ids are reported for tombstoning; the different-day shift is untouched',
  run(`globalThis.__absorbed.length`) === 2 && run(`db.shifts.some(x=>x.id==='keep-1' && x.status==='proposed')`));

// ---------- 5. Cloud merge path: by-id union, then identity collapse ----------
run(`
  const localL = [{ id: 'loc-1', date: '2026-11-15', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'apple-import', sources: ['apple-import'], incomplete: false, updatedAt: '2026-11-02T00:00:00Z' }];
  const cloudL = [{ id: 'cloud-9', date: '2026-11-15', facility: 'Holzer', type: '8-hour day', pay: '', status: 'proposed', source: 'qgenda-feed', sources: ['qgenda-feed'], incomplete: true, updatedAt: '2026-11-01T00:00:00Z' }];
  db.shifts = cloudMergeSyncedList(localL, cloudL, 'shifts');
  globalThis.__preCollapse = db.shifts.length;
  globalThis.__cloudAbsorbed = [];
  dedupeShiftsInPlace((absorbedId) => { globalThis.__cloudAbsorbed.push(absorbedId); });
`);
t('cloud union of the same shift under two ids collapses to one, absorbed id tombstoned',
  run(`globalThis.__preCollapse`) === 2 && run(`db.shifts.length`) === 1 &&
  run(`globalThis.__cloudAbsorbed.join(',')`) === 'cloud-9' &&
  run(`shiftSourcesList(db.shifts[0]).includes('qgenda-feed')`));

console.log('DONE');
