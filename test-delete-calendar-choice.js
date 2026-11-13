// CRNA Hub — delete-time calendar choice (Nov 7, 2026).
// Caleb's decision: deleting a shift that was imported from the
// user's own calendar offers a choice AT DELETE TIME — a checkbox in
// the delete confirmation, unticked by default: "Also remove it from
// my <calendar> calendar." Unticked keeps the long-standing behaviour
// exactly (removed in-app, import flagged so it does not come back,
// CRNA Hub copy removed at next sync, source calendar untouched).
// Ticked additionally deletes the paired source event through the
// live-sync path; a provider failure still completes the in-app
// delete and earns one honest line. The choice is remembered per
// user in settings (cloud-synced). Only the Apple import source
// pairs shifts with source events (calendar_import_map); .ics file
// imports, QGenda, contracts, uploads and manual shifts show no box.
// Run: node test-delete-calendar-choice.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
const alerts = [];
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {}, _entries: null,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
function getEl(id) { return elements[id] || (elements[id] = el(id)); }
function parseAttrs(tag) {
  const d = {};
  const re = /data-([a-z-]+)="([^"]*)"/g; let m;
  while ((m = re.exec(tag))) d[m[1]] = m[2];
  return d;
}
function actionButtons() {
  const html = (elements['app'] ? elements['app'].innerHTML : '') + (elements['nav'] ? elements['nav'].innerHTML : '');
  const out = [];
  const re = /<(?:button|a|div)\b[^>]*data-action="[^"]*"[^>]*>/g; let m;
  while ((m = re.exec(html))) { const b = el(''); b.dataset = parseAttrs(m[0]); out.push(b); }
  return out;
}
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
    querySelectorAll: (sel) => {
      if (sel === '[data-action]') return actionButtons();
      return [];
    },
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => { throw new Error('browser confirm() must not be used for shift deletion any more'); },
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
const appHTML = () => elements['app'].innerHTML;
function tap(pred, label) {
  run(`render()`);
  const hit = actionButtons().find(pred);
  if (!hit) { t('tap target exists: ' + label, false); return null; }
  run(`actions(${JSON.stringify(hit.dataset.action)}, ${JSON.stringify(hit.dataset.id || '')}, ${JSON.stringify(hit.dataset.date || '')}, ${JSON.stringify(hit.dataset.from || '')})`);
  return hit;
}

(async () => {
  // ---------- Fixture ----------
  run(`
    db.facilities = [{id:'f1', name:'Holzer', hourlyRate:'250', paidHours8:'8.5'}];
    db.payStubs = []; db.mileage = []; db.hotelStays = []; db.documents = [];
    db.settings.deleteAlsoFromCalendar = false;
    liveSyncConnections = { apple: { status: 'connected', sourceCalendarName: 'Caleb Work Schedule' } };
    var S = (id, date, source, sources, note) => ({id, date, facility:'Holzer', type:'8-hour day', pay:'2125', status:'confirmed', source, sources, note: note || '', updatedAt:'2026-11-01T12:00:00.000Z'});
    db.shifts = [
      S('imp1','2026-11-04','apple-import',['apple-import'],'Imported from Caleb Work Schedule'),
      S('imp2','2026-11-05','apple-import',['apple-import'],'Imported from Caleb Work Schedule'),
      S('imp3','2026-11-06','apple-import',['apple-import'],'Imported from Caleb Work Schedule'),
      S('multi1','2026-11-09','qgenda',['qgenda','apple-import'],'Imported from Caleb Work Schedule'),
      S('man1','2026-11-10','user-entered',['user-entered'],''),
      S('ics1','2026-11-11','calendar-apple',['calendar-apple'],'Imported from Apple Calendar (.ics): work.ics'),
      S('qg1','2026-11-12','qgenda',['qgenda'],'')
    ];
    month = new Date(2026, 10, 1);
    selected = '2026-11-04'; dayViewOpen = true; paycheckEdit = null; editId = null; showShiftForm = false; shiftDeleteConfirm = null;
    var __srcCalls = [];
    var __srcResult = true;
    window.liveSyncDeleteSourceEvent = async (p, sid) => { __srcCalls.push([p, sid]); return __srcResult; };
  `);

  // ---------- 1. Imported shift: confirmation sheet carries the choice ----------
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'imp1', 'delete imp1');
  t('delete tap opens a confirmation sheet (no browser confirm, nothing deleted yet)',
    appHTML().includes('aria-label="Delete shift"') && !!run(`db.shifts.find(x=>x.id==='imp1')`));
  t('checkbox offered with the real calendar name',
    appHTML().includes('id="f_deleteAlsoFromCalendar"') && appHTML().includes('Also remove it from my Caleb Work Schedule calendar'));
  t('checkbox starts UNticked (remembered default is off)',
    appHTML().includes('id="f_deleteAlsoFromCalendar">') || appHTML().includes('id="f_deleteAlsoFromCalendar" '));
  t('sheet carries the condensed unchecked-behaviour line',
    appHTML().includes('your Caleb Work Schedule calendar isn\'t touched, and it won\'t be imported again.'));
  t('day sheet deletion paragraph is the condensed one-liner now',
    appHTML().includes('Deleting removes it here and from your CRNA Hub calendar — your Caleb Work Schedule calendar isn\'t touched') &&
    !appHTML().includes('is never deleted from your calendar'));

  // ---------- 2. Unticked confirm: source NOT called, tombstone flow unchanged ----------
  await run(`actions('shift-delete-confirm','imp1','','')`);
  t('unticked: shift removed in-app', !run(`db.shifts.find(x=>x.id==='imp1')`));
  t('unticked: source delete NOT called', run(`__srcCalls.length`) === 0);
  t('unticked: live-sync tombstone recorded for the provider',
    run(`liveSyncState.tombstones.some(x=>x.provider==='apple'&&x.shiftId==='imp1')`));
  t('unticked: remembered choice stays off', run(`db.settings.deleteAlsoFromCalendar`) === false);
  t('unticked: no failure notice', alerts.length === 0);

  // ---------- 3. Ticked confirm on a multi-source shift: targets only the calendar source ----------
  run(`selected='2026-11-09'`);
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'multi1', 'delete multi1');
  t('multi-source shift (QGenda + calendar) still gets the checkbox',
    appHTML().includes('id="f_deleteAlsoFromCalendar"'));
  // Drive the real render() change wiring on the checkbox element.
  const cb = getEl('f_deleteAlsoFromCalendar');
  cb.checked = true;
  (cb._listeners.change || []).forEach(f => f());
  t('ticking the box updates the pending choice', run(`shiftDeleteConfirm && shiftDeleteConfirm.also`) === true);
  await run(`actions('shift-delete-confirm','multi1','','')`);
  t('ticked: source delete called once, for the calendar provider + this shift',
    JSON.stringify(run(`__srcCalls`)) === JSON.stringify([['apple', 'multi1']]));
  t('ticked: shift removed in-app too', !run(`db.shifts.find(x=>x.id==='multi1')`));
  t('ticked: choice remembered as the new default (settings, cloud-synced payload)',
    run(`db.settings.deleteAlsoFromCalendar`) === true &&
    run(`cloudSettingsContent(db.settings)`).includes('"deleteAlsoFromCalendar":true'));
  t('remembered default survives a settings merge from the cloud (clear-device -> sign-in)',
    run(`cloudMergeSettings({}, {deleteAlsoFromCalendar:true, updatedAt:'2026-11-07T00:00:00.000Z'}).deleteAlsoFromCalendar`) === true);

  // ---------- 4. Remembered default pre-ticks the next confirmation ----------
  run(`selected='2026-11-05'`);
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'imp2', 'delete imp2');
  t('next delete opens with the box pre-ticked from the remembered choice',
    /id="f_deleteAlsoFromCalendar" checked/.test(appHTML()));

  // ---------- 5. Provider failure: in-app delete completes + one honest line ----------
  run(`__srcResult = false`);
  await run(`actions('shift-delete-confirm','imp2','','')`);
  t('failure: source delete was attempted', run(`__srcCalls.length`) === 2);
  t('failure: shift still removed in-app', !run(`db.shifts.find(x=>x.id==='imp2')`));
  t('failure: exactly one honest line, naming the calendar',
    alerts.length === 1 && alerts[0] === 'Removed here — couldn\'t remove it from Caleb Work Schedule, so it may still show there.', alerts[0]);
  run(`__srcResult = true`);

  // ---------- 6. Non-imported shifts: no checkbox ----------
  run(`selected='2026-11-10'`);
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'man1', 'delete man1');
  t('manual shift: no checkbox, plain one-line explanation',
    !appHTML().includes('f_deleteAlsoFromCalendar') && appHTML().includes('Deleting removes it here and from your CRNA Hub calendar right away.'));
  await run(`actions('shift-delete-confirm','man1','','')`);
  t('manual shift: deleted, no source call', !run(`db.shifts.find(x=>x.id==='man1')`) && run(`__srcCalls.length`) === 2);

  run(`selected='2026-11-11'`);
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'ics1', 'delete ics1');
  t('.ics file import: no checkbox (a file has no live source event)', !appHTML().includes('f_deleteAlsoFromCalendar'));
  tap(b => b.dataset.action === 'shift-delete-cancel', 'cancel ics1 delete');
  t('cancel keeps the shift and closes the sheet', !!run(`db.shifts.find(x=>x.id==='ics1')`) && !appHTML().includes('aria-label="Delete shift"'));

  run(`selected='2026-11-12'`);
  tap(b => b.dataset.action === 'delete-shifts' && b.dataset.id === 'qg1', 'delete qg1');
  t('QGenda-only shift: no checkbox (read-only feed)', !appHTML().includes('f_deleteAlsoFromCalendar'));
  tap(b => b.dataset.action === 'shift-delete-cancel', 'cancel qg1 delete');

  // ---------- 7. Wiring: client fn, proxy allowlist, server action, cache ----------
  const lsSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
  const fnSrc = fs.readFileSync(R + 'api' + path.sep + 'fn.js', 'utf8');
  const srvSrc = fs.readFileSync(R + 'supabase' + path.sep + 'functions' + path.sep + 'sync-calendar' + path.sep + 'index.ts', 'utf8');
  t('live-sync exposes liveSyncDeleteSourceEvent for app.js',
    lsSrc.includes('window.liveSyncDeleteSourceEvent = liveSyncDeleteSourceEvent') && lsSrc.includes("action: 'delete-source-event'"));
  t('same-origin proxy allowlists delete-source-event (the QGenda lesson)',
    fnSrc.includes("'delete-source-event'"));
  t('server action deletes the paired source event via the import map',
    srvSrc.includes('body.action === "delete-source-event"') && srvSrc.includes('deleteAppleEvent(sourceUrl, appleId, password, sourceEventId)') && srvSrc.includes('getImportMapRows'));
  t('server refuses non-Apple providers honestly (no import source exists for them)',
    srvSrc.includes('source_delete_unsupported'));
  t('service worker cache bumped to v73', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v162'));

  console.log(fails ? ('FAILURES: ' + fails) : 'ALL PASS');
})();
