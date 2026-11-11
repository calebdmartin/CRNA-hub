'use strict';
// v134 (Nov 11, 2026) — three client-side pieces of the round:
//   A. SYNC PAYLOAD: a facility's saved code definitions travel
//      with the sync (facilityCodeDefsPayload), so the server can
//      classify titles only a definition can read.
//   B. DERIVED DEFINITIONS: a purely-duration code ("8s") at an
//      hourly-rate facility prices off its own name everywhere the
//      client prices (clarifiedRowPricing fallback, .ics import),
//      persists as a visibly-derived definition, and is replaced
//      by the user's own words. Asterisk codes (5**) NEVER
//      self-price — they stay unpriced for clarification.
//   C. WAITING-SUGGESTION LINKING: a "Hospitals noticed" card
//      whose name tolerantly matches an existing facility (the
//      calendar's "Holzer" vs the contract's "HOLZ") links to that
//      facility — alias saved, card gone, re-check queued —
//      instead of parking as a duplicate suggestion.
// (The nine-block server acceptance lives in the Deno suite,
// _shared/calendar.test.ts, driven through the loop's own path.)
const fs = require('fs'); const path = require('path'); const vm = require('vm');
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
const alerts = [];
const fetchCalls = [];
let canned = { providerChanges: [], pendingDeletions: [], imported: { sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 0, duplicates: 0, seen: 0, parsed: 0, suggestions: [], newFacilities: [] } };
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
  alert: (m) => { alerts.push(String(m)); },
  __alerts: alerts, __fetchCalls: fetchCalls,
  confirm: () => true,
  fetch: async (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    fetchCalls.push({ url, body });
    let data = { ok: true };
    if (body && body.function === 'sync-calendar' && body.action === 'sync') data = canned;
    else if (body && body.function === 'sync-calendar' && body.action === 'status') {
      data = { connections: [{ provider: 'apple', status: 'connected', autoDelete: false, lastSyncedAt: '2026-11-11T14:14:00Z', sourceCalendarUrl: 'cal-work', sourceCalendarName: 'Caleb Work Schedule' }] };
    } else if (body && body.function === 'sync-calendar' && body.action === 'log') data = { log: [] };
    return { status: 200, ok: true, text: async () => JSON.stringify(data) };
  },
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
const settle = () => new Promise((r) => setTimeout(r, 250));

const CAMC_HOURLY = { id: 'camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '', weekendDays: [0, 6], codeMap: {} };
const CAMC_DEFS = { id: 'camc', name: 'CAMC', aliases: '', address: '', hourlyRate: '250', paidHours8: '', rate8: '', rate10: '', rate12: '', rate24: '', weekendRate24: '', rateSecond: '', weekendRateSecond: '', callBonus: '', hourlyCall1st: '', weekendDays: [0, 6], codeMap: { '8': { label: '8-hour shift', hours: '8', canonicalType: '8-hour day', rulesConfirmed: true, viaWords: true } } };
const HOLZ = { id: 'holz', name: 'HOLZ', aliases: '', address: '', hourlyRate: '250', paidHours8: '8.5', rate8: '', rate10: '', rate12: '', rate24: '4800', weekendRate24: '4200', rateSecond: '3000', weekendRateSecond: '2000', callBonus: '', hourlyCall1st: '175', weekendDays: [0, 6], codeMap: {} };
const setup = (facilities) => run(`db = empty(); db.settings.scheduleName='Martin'; db.facilities=${JSON.stringify(facilities)}; db.shifts=[]; db.facilitySuggestions=[]; persist();`);
const ev = (uid, summary, ds, de) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART${ds}\r\nDTEND${de}\r\nEND:VEVENT\r\n`;
const cal = (...evs) => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + evs.join('') + 'END:VCALENDAR';
const toCalPreview = (text) => run(`
  (() => {
    const parsed = parseICS(${JSON.stringify(text)}, 'cal.ics');
    const rows = parsed.rows.map((r) => ({ ...r, source: 'calendar-file', sourceLabel: 'Calendar file', include: true, duplicate: false, incomplete: !String(r.pay || '').trim(), note: 'Imported from Calendar file (.ics): cal.ics' }));
    calPreview = { fileName: 'cal.ics', sourceLabel: 'Calendar file', sourceCode: 'calendar-file', rows };
    return rows;
  })()
`);
const camcShifts = () => run(`db.shifts.filter(s => s.facility === 'CAMC')`);
const sumPay = (arr) => arr.reduce((a, s) => a + (Number(s.pay) || 0), 0);

(async () => {
  // ---------- A. payload ----------
  setup([CAMC_DEFS]);
  const payload = run(`liveSyncFacilitiesPayload()`);
  t('A: sync payload carries the facility code definitions',
    payload.length === 1 && Array.isArray(payload[0].codeDefs) && payload[0].codeDefs.length === 1 &&
    payload[0].codeDefs[0].code === '8' && payload[0].codeDefs[0].hours === 8 && payload[0].codeDefs[0].canonicalType === '8-hour day',
    JSON.stringify(payload));
  t('A: an hourly-only facility ships an empty codeDefs list',
    JSON.stringify(run(`facilityCodeDefsPayload(${JSON.stringify(CAMC_HOURLY)})`)) === '[]');

  // ---------- B1. clarifiedRowPricing: self-describing + guards ----------
  setup([CAMC_HOURLY]);
  const cp8 = run(`clarifiedRowPricing(db.facilities[0], { code: '8s', date: '2026-08-10' })`);
  t('B1: "8s" prices off its own name at the hourly rate ($2,000)',
    cp8 && Number(cp8.pay) === 2000 && cp8.type === '8-hour day', JSON.stringify(cp8));
  const cp12 = run(`clarifiedRowPricing(db.facilities[0], { code: '12s', date: '2026-08-10' })`);
  t('B1: "12s" prices $3,000', cp12 && Number(cp12.pay) === 3000, JSON.stringify(cp12));
  const cpStar = run(`clarifiedRowPricing(db.facilities[0], { code: '5**', date: '2026-08-10' })`);
  t('B1: "5**" with no definition does NOT self-price (never $1,250)',
    cpStar === null, JSON.stringify(cpStar));
  const cp7 = run(`clarifiedRowPricing(db.facilities[0], { code: '7', date: '2026-08-10' })`);
  t('B1: bare "7" does NOT self-price', cp7 === null, JSON.stringify(cp7));
  setup([CAMC_DEFS]);
  run(`db.facilities[0].codeMap['8'].weekdayPay = '2100'`);
  const cpDef = run(`clarifiedRowPricing(db.facilities[0], { code: '8s', date: '2026-08-10' })`); // 2026-08-10 is a Monday
  t('B1: a saved definition outranks the derived reading (plural fold, $2,100)',
    cpDef && Number(cpDef.pay) === 2100, JSON.stringify(cpDef));
  t('B1: selfDescribingCodeHours mirrors the server rule',
    run(`[selfDescribingCodeHours('8s'), selfDescribingCodeHours('8 hr'), selfDescribingCodeHours('7'), selfDescribingCodeHours('5**'), selfDescribingCodeHours('24s'), selfDescribingCodeHours('9s')].join(',')`) === '8,8,,,,9');

  // ---------- B2. .ics import: hourly-only CAMC block + singles ----------
  setup([CAMC_HOURLY]);
  const blockICS = cal(ev('b1', 'CAMC 8s', ':20260810T070000Z', ':20260814T080000Z'));
  const rows = run(`parseICS(${JSON.stringify(blockICS)}, 'cal.ics').rows`);
  t('B2: hourly-only timed "CAMC 8s" block expands to 5 rows in the .ics path',
    rows.length === 5, 'rows=' + rows.length);
  t('B2: rows are priced $2,000/day, typed, and carry their code',
    rows.every(r => Number(r.pay) === 2000 && r.type === '8-hour day' && r.code === '8s'),
    JSON.stringify(rows.map(r => [r.date, r.type, r.pay, r.code])));
  toCalPreview(blockICS);
  run(`approveCalendarImport();`);
  t('B2: approve lands 5 shifts totalling $10,000',
    camcShifts().length === 5 && sumPay(camcShifts()) === 10000, 'n=' + camcShifts().length + ' total=' + sumPay(camcShifts()));
  const derivedDef = run(`db.facilities[0].codeMap['8s']`);
  t('B2: the derived definition persisted, visibly marked derived',
    !!derivedDef && derivedDef.derived === true && derivedDef.hours === '8' && derivedDef.canonicalType === '8-hour day',
    JSON.stringify(derivedDef));
  setup([CAMC_HOURLY]);
  const singlesICS = cal(
    ev('s1', 'CAMC 10s', ':20260810T070000Z', ':20260810T170000Z'),
    ev('s2', 'CAMC 12s', ':20260811T070000Z', ':20260811T190000Z'),
  );
  toCalPreview(singlesICS);
  run(`approveCalendarImport();`);
  t('B2: "CAMC 10s"/"CAMC 12s" singles price $2,500/$3,000 with zero clarification',
    camcShifts().length === 2 && sumPay(camcShifts()) === 5500 &&
    !!run(`db.facilities[0].codeMap['10s']`) && !!run(`db.facilities[0].codeMap['12s']`),
    JSON.stringify(camcShifts().map(s => s.pay)));
  setup([CAMC_HOURLY]);
  const starICS = cal(ev('s3', 'CAMC 5**', ':20260810T070000Z', ':20260810T170000Z'));
  const starRows = run(`parseICS(${JSON.stringify(starICS)}, 'cal.ics').rows`);
  t('B2: "CAMC 5**" with no definition stays unclassified + unpriced in the preview',
    starRows.length === 1 && starRows[0].type === 'Other' && !String(starRows[0].pay || '').trim() &&
    starRows[0].flags.some(f => f.includes('not classified')),
    JSON.stringify(starRows));
  toCalPreview(starICS);
  run(`approveCalendarImport();`);
  t('B2: the 5** shift lands incomplete — never priced as 5 hours ($1,250)',
    camcShifts().length === 1 && camcShifts()[0].incomplete === true && Number(camcShifts()[0].pay || 0) === 0 &&
    !run(`db.facilities[0].codeMap['5**']`),
    JSON.stringify(camcShifts()));

  // ---------- B3. .ics import: defined codes, plural fold ----------
  setup([CAMC_DEFS]);
  const defBlockICS = cal(ev('b2', 'CAMC 8s', ':20260810T070000Z', ':20260814T080000Z'));
  const defRows = run(`parseICS(${JSON.stringify(defBlockICS)}, 'cal.ics').rows`);
  t('B3: defined-code block expands via the saved "8" definition (plural fold)',
    defRows.length === 5 && defRows.every(r => Number(r.pay) === 2000 && r.type === '8-hour day'),
    'rows=' + defRows.length);

  // ---------- B4. the user's words replace a derived definition ----------
  setup([CAMC_HOURLY]);
  run(`ensureDerivedCodeDef(db.facilities[0], '8s', 8); persist();`);
  t('B4: derived def present before words', run(`!!db.facilities[0].codeMap['8s'].derived`) === true);
  run(`applyDescribedRules(db.facilities[0], { rates: {}, defs: { '8s': { label: '8-hour shift', hours: '8', weekdayPay: 2100 } }, weekendDays: null, unanswered: [] });`);
  const afterWords = run(`db.facilities[0].codeMap['8s']`);
  t('B4: confirming words for the code clears the derived mark and keeps their figure',
    !!afterWords && !afterWords.derived && String(afterWords.weekdayPay) === '2100', JSON.stringify(afterWords));
  setup([CAMC_HOURLY]);
  run(`ensureDerivedCodeDef(db.facilities[0], '8s', 8); persist();`);
  run(`applyDescribedRules(db.facilities[0], { rates: {}, defs: { '8': { label: '8-hour shift', hours: '8' } }, weekendDays: null, unanswered: [] });`);
  t('B4: words defining "8" remove the derived "8s" twin entirely',
    !run(`db.facilities[0].codeMap['8s']`) && !!run(`db.facilities[0].codeMap['8']`));

  // ---------- B5. derived persistence from a sync response ----------
  setup([CAMC_HOURLY]);
  run(`liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], shiftSync: [], imported: { sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 0, duplicates: 0, seen: 0, parsed: 0, suggestions: [], newFacilities: [], derivedCodes: [{ facility: 'CAMC', code: '10s', hours: 10 }] } })`);
  const syncDerived = run(`db.facilities[0].codeMap['10s']`);
  t('B5: a sync-reported derived code persists on the facility',
    !!syncDerived && syncDerived.derived === true && syncDerived.hours === '10', JSON.stringify(syncDerived));
  run(`liveSyncApplyChanges('apple', { providerChanges: [], pendingDeletions: [], shiftSync: [], imported: { sourceCalendarName: 'Caleb Work Schedule', created: 0, updated: 0, skipped: 0, duplicates: 0, seen: 0, parsed: 0, suggestions: [], newFacilities: [], derivedCodes: [{ facility: 'CAMC', code: '10s', hours: 10 }] } })`);
  t('B5: re-applying the same derived code changes nothing (idempotent)',
    run(`Object.keys(db.facilities[0].codeMap).length`) === 1);

  // ---------- C. suggestion linking ----------
  setup([HOLZ]);
  run(`mergeFacilitySuggestions('apple', [{ name: 'Holzer', count: 234, firstDate: '2025-06-16', lastDate: '2027-04-02', sampleTitles: ['Holzer 8'] }], 'Caleb Work Schedule')`);
  t('C: the "Holzer" suggestion does NOT park as a separate card',
    run(`db.facilitySuggestions.length`) === 0 && run(`activeFacilitySuggestions().length`) === 0,
    JSON.stringify(run(`db.facilitySuggestions`)));
  t('C: the calendar spelling became an alias of the existing HOLZ facility',
    run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true,
    JSON.stringify(run(`db.facilities[0].aliases`)));
  const links = run(`takePendingSuggestionLinks()`);
  t('C: a re-check of the provider is queued for the linked facility',
    links.length === 1 && links[0].provider === 'apple' && links[0].name === 'HOLZ', JSON.stringify(links));
  t('C: the queue drains (second take is empty)', run(`takePendingSuggestionLinks().length`) === 0);
  // Stored suggestion from before the linking existed heals itself.
  setup([HOLZ]);
  run(`db.facilitySuggestions = [{ id: 'sg1', name: 'Holzer', count: 234, firstDate: '2025-06-16', lastDate: '2027-04-02', provider: 'apple', dismissed: false, createdAt: '2026-11-11T00:00:00Z', lastSeenAt: '2026-11-11T00:00:00Z' }]; persist();`);
  t('C: linkStoredSuggestions links a pre-existing stored card',
    run(`linkStoredSuggestions()`) === true && run(`db.facilitySuggestions.length`) === 0 &&
    run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true &&
    run(`takePendingSuggestionLinks().length`) === 1);
  // An unrelated hospital still parks as a suggestion, untouched.
  setup([HOLZ]);
  run(`mergeFacilitySuggestions('apple', [{ name: 'CAMC', count: 12, firstDate: '2026-12-01', lastDate: '2026-12-05' }], 'Caleb Work Schedule')`);
  t('C: an unrelated hospital still parks as a suggestion',
    run(`db.facilitySuggestions.length`) === 1 && run(`takePendingSuggestionLinks().length`) === 0);
  // Ambiguous spelling (two candidate facilities) links nothing.
  setup([{ ...HOLZ, id: 'holzer', name: 'Holzer', aliases: '' }, { ...HOLZ, id: 'holzman', name: 'Holzman', aliases: '' }]);
  run(`mergeFacilitySuggestions('apple', [{ name: 'Holz', count: 3, firstDate: '2026-12-01', lastDate: '2026-12-03' }], 'Caleb Work Schedule')`);
  t('C: an ambiguous match (Holzer + Holzman) leaves the suggestion for the user',
    run(`db.facilitySuggestions.length`) === 1 && run(`takePendingSuggestionLinks().length`) === 0,
    JSON.stringify(run(`db.facilitySuggestions.map(x => x.name)`)));

  // ---------- C2. the drain: a sync pulls the linked facility ----------
  setup([HOLZ]);
  run(`cloudSession = { access_token: 'test-token', expires_at: Math.floor(Date.now()/1000) + 3600 };`);
  run(`db.facilitySuggestions = [{ id: 'sg2', name: 'Holzer', count: 234, firstDate: '2025-06-16', lastDate: '2027-04-02', provider: 'apple', dismissed: false, createdAt: '2026-11-11T00:00:00Z', lastSeenAt: '2026-11-11T00:00:00Z' }]; persist();`);
  fetchCalls.length = 0;
  await run(`liveSyncNow('apple', true)`);
  await settle();
  const syncCalls = fetchCalls.filter(c => c.body && c.body.function === 'sync-calendar' && c.body.action === 'sync');
  t('C2: the sync drained the link into a second (rescan) sync',
    syncCalls.length >= 2, 'sync calls=' + syncCalls.length);
  t('C2: after the drain the card is gone and the alias is saved',
    run(`db.facilitySuggestions.length`) === 0 && run(`facilityAliases(db.facilities[0]).includes('Holzer')`) === true);

  console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
})();
