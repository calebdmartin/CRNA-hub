// CRNA Hub — floating assistant button + sheet (Nov 7, 2026).
// Caleb: "add a floating AI assistant icon that is available on every
// page so the user can quickly ask it questions." The Assistant already
// lived as a tab; this build adds the floating access point:
//   * a navy chat/sparkle button fixed bottom-right on every tab
//     EXCEPT the Assistant tab itself, safe-area aware, z-index below
//     every sheet so it never floats over an open overlay;
//   * tapping it opens the SAME assistant as a sheet (one conversation
//     in db.assistantChat shared with the tab — ask in one, see it in
//     the other), with quick-prompt chips wired to askAssistantLive();
//   * opening/closing touches ONLY the overlay: the day sheet, an
//     editor draft and the page underneath survive the round-trip;
//   * a guided portal check started from a chip ends the sheet and
//     lands on the Assistant tab with its step state intact, and the
//     sheet never renders over the guided-check panels.
// This suite drives the real render()/actions() wiring through a DOM
// shim, like test-calendar-editing.js. Signed out, askAssistantLive()
// falls back to the deterministic engine — exactly what is asserted.
// Run: node test-assistant-fab.js
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
    append() {}, click() {}, remove() {}, scrollIntoView() {}, focus() {}, querySelectorAll: () => [],
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
function forms() {
  const html = elements['app'] ? elements['app'].innerHTML : '';
  const out = [];
  const re = /<form\b[^>]*data-kind="[^"]*"[^>]*>/g; let m;
  while ((m = re.exec(html))) { const f = el(''); f.dataset = parseAttrs(m[0]); f._entries = []; out.push(f); }
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
      if (sel === 'form[data-kind]') return forms();
      return [];
    },
    querySelector: () => null,
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
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
const appHTML = () => elements['app'].innerHTML;
const tick = () => new Promise(r => setTimeout(r, 0));
function tap(pred, label) {
  run(`render()`);
  const hit = actionButtons().find(pred);
  if (!hit) { t('tap target exists: ' + label, false); return null; }
  run(`actions(${JSON.stringify(hit.dataset.action)}, ${JSON.stringify(hit.dataset.id || '')}, ${JSON.stringify(hit.dataset.date || '')}, ${JSON.stringify(hit.dataset.from || '')})`);
  return hit;
}

// ---------- Caleb-shaped fixture (same November + Premier stub as the
// calendar-editing suite, so the next paycheck is $27,075) ----------
run(`
  db.facilities = [{id:'f1', name:'Holzer', hourlyRate:'250', paidHours8:'8.5', rateSecond:'3000', weekendRateSecond:'2000', rate24:'4800', weekendRate24:'4200', callBonus:'1000', hourlyCall1st:'175'}];
  db.payStubs = [
    {id:'pc', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'12757.50', source:'ai-vision'}
  ];
  const D = (id, date, type, pay, status) => ({id, date, facility:'Holzer', type, pay:String(pay), status:status || 'confirmed', source:'calendar-apple', sources:['calendar-apple'], updatedAt:'2026-11-01T12:00:00.000Z'});
  const PROP = ['n5','n6','n7','n8','n9','n10','n11'];
  const S = (id, date, type, pay) => D(id, date, type, pay, PROP.includes(id) ? 'proposed' : 'confirmed');
  db.shifts = [
    S('o1','2026-10-22','Second call',3000),
    S('o2','2026-10-26','8-hour day',2125), S('o3','2026-10-27','8-hour day',2125),
    S('o4','2026-10-28','8-hour day',2125), S('o5','2026-10-29','8-hour day',2125),
    S('n1','2026-11-02','8-hour day',2125), S('n2','2026-11-03','Second call',3000),
    S('n3','2026-11-04','8-hour day',2125), S('n4','2026-11-05','8-hour day',2125),
    S('n5','2026-11-06','Second call',3000), S('n6','2026-11-07','24-hour call',4200),
    S('n7','2026-11-08','Second call',2000), S('n8','2026-11-10','8-hour day',2125),
    S('n9','2026-11-11','8-hour day',2125), S('n10','2026-11-12','8-hour day',2125),
    S('n11','2026-11-13','8-hour day',2125),
    S('n12','2026-11-16','8-hour day',2125), S('n13','2026-11-17','8-hour day',2125),
    S('n14','2026-11-18','8-hour day',2125), S('n15','2026-11-19','8-hour day',2125),
    S('n16','2026-11-20','8-hour day',2125), S('n17','2026-11-30','8-hour day',2125)
  ];
  db.mileage = []; db.hotelStays = []; db.documents = []; db.assistantChat = [];
  month = new Date(2026, 10, 1);
  selected = '2026-11-03'; dayViewOpen = false; paycheckEdit = null; editId = null; showShiftForm = false; assistantSheetOpen = false;
  tab = 'Dashboard';
`);
t('fixture: next paycheck total is $27,075', run(`paystubOccurrences(db.payStubs[0],'2026-11-01','2026-11-30').find(o=>o.date==='2026-11-24').total`) === 27075);

(async () => {
  // ---------- 1. The button: present on every tab but Assistant ----------
  for (const tb of ['Dashboard', 'Facilities', 'Credentials', 'Mileage', 'Account']) {
    run(`tab = '${tb}'; render()`);
    t(`button renders on the ${tb} tab`, appHTML().includes('class="assistant-fab"') && appHTML().includes('data-action="assistant-open"'));
    t(`button is an inline SVG glyph (app-styled, no emoji)`, appHTML().includes('<svg') && appHTML().includes('aria-label="Ask the assistant"'));
    t(`no assistant sheet yet on ${tb}`, !appHTML().includes('assistant-sheet'));
  }
  run(`tab = 'Assistant'; render()`);
  t('button hidden on the Assistant tab itself', !appHTML().includes('assistant-fab'));
  t('Assistant tab renders the shared panel (starters + form)',
    appHTML().includes('Ask the assistant to check my portals') && appHTML().includes('id="assistantForm"'));

  // ---------- 2. Tap the button -> sheet, shared conversation ----------
  run(`tab = 'Dashboard'; render()`);
  tap(b => b.dataset.action === 'assistant-open', 'floating button');
  t('tap opens the assistant sheet as an overlay (backdrop + sheet)',
    appHTML().includes('sheet-backdrop assistant-backdrop') && appHTML().includes('class="sheet assistant-sheet"'));
  t('the button itself steps aside while its sheet is open', !appHTML().includes('assistant-fab'));
  t('sheet carries the quick-prompt chips',
    ["What&#39;s my next paycheck?", 'What do I make this month?', "What&#39;s expiring soon?"].every(q => appHTML().includes(`data-action="ask" data-id="${q}"`)));
  t('sheet carries the shared question form', appHTML().includes('id="assistantForm"') && appHTML().includes('id="assistantInput"'));

  // ---------- 3. Quick chip -> deterministic answer ($27,075) ----------
  tap(b => b.dataset.action === 'ask' && b.dataset.id === "What&#39;s my next paycheck?", 'quick chip: next paycheck');
  await tick(); await tick();
  t('chip answer landed in the shared history', run(`(db.assistantChat||[]).length`) >= 2);
  t('deterministic answer names the $27,075 paycheck (Nov 24)',
    run(`(db.assistantChat||[]).some(m=>m.role==='assistant' && m.text.includes('$27,075.00'))`) === true);
  t('answer is labelled honestly (on-device fallback, signed out)',
    run(`(db.assistantChat||[]).some(m=>m.role==='assistant' && m.source==='local')`) === true);
  run(`render()`);
  t('sheet re-renders with the answer in its chat', appHTML().includes('$27,075.00') && appHTML().includes('assistant-sheet'));
  tap(b => b.dataset.action === 'assistant-close', 'sheet close (× / backdrop)');
  t('closing drops only the sheet — still on Dashboard, button back',
    run(`assistantSheetOpen`) === false && run(`tab`) === 'Dashboard' && appHTML().includes('assistant-fab') && !appHTML().includes('assistant-sheet'));

  // ---------- 4. Same conversation from the tab side ----------
  run(`tab = 'Assistant'; render()`);
  t('Assistant tab shows the question asked from the sheet',
    appHTML().includes('my next paycheck?') && appHTML().includes('$27,075.00'));
  tap(b => b.dataset.action === 'ask' && b.dataset.id === 'What credentials are expiring soon?', 'tab starter: expiring');
  await tick(); await tick();
  const histLen = run(`(db.assistantChat||[]).length`);
  run(`tab = 'Mileage'; render()`);
  tap(b => b.dataset.action === 'assistant-open', 'open sheet from Mileage');
  t('sheet opened from another tab shows the tab-side exchange too',
    appHTML().includes('What credentials are expiring soon?') && histLen >= 4);
  tap(b => b.dataset.action === 'assistant-close', 'close sheet again');

  // ---------- 5. Round-trip over an open day sheet + editor draft ----
  run(`tab = 'Dashboard'; render()`);
  tap(b => b.dataset.action === 'day' && b.dataset.date === '2026-11-03', 'day Nov 3');
  tap(b => b.dataset.action === 'edit-shifts' && b.dataset.id === 'n2', 'edit shift n2');
  t('setup: shift editor stacked over the day sheet',
    appHTML().includes('id="day-view"') && appHTML().includes('data-kind="shifts"'));
  t('button hides while the day sheet + editor own the screen', !appHTML().includes('assistant-fab'));
  run(`assistantSheetOpen = true; render()`);
  t('assistant sheet stacks ABOVE the editor (later in DOM => paints on top)',
    appHTML().indexOf('assistant-sheet') > appHTML().indexOf('data-kind="shifts"') &&
    appHTML().indexOf('assistant-backdrop') > appHTML().indexOf('data-kind="shifts"'));
  tap(b => b.dataset.action === 'assistant-close', 'close sheet over editor');
  t('after the round-trip the editor is still open on the same shift',
    run(`editId`) === 'n2' && run(`showShiftForm`) === true && appHTML().includes('data-kind="shifts"'));
  t('and the day sheet is still open underneath', run(`dayViewOpen`) === true && appHTML().includes('id="day-view"'));
  tap(b => b.dataset.action === 'cancel', 'cancel editor');
  tap(b => b.dataset.action === 'close-day', 'close day sheet');
  t('button returns once the overlays close', appHTML().includes('assistant-fab'));

  // ---------- 6. Delete confirmation also owns the screen ----------
  run(`shiftDeleteConfirm = {id:'n2', also:false}; render()`);
  t('button hidden while the delete confirmation is up', !appHTML().includes('assistant-fab'));
  run(`shiftDeleteConfirm = null; render()`);

  // ---------- 7. Portal guided check: chip -> sheet closes, state lives
  run(`tab = 'Credentials'; render()`);
  tap(b => b.dataset.action === 'assistant-open', 'open sheet from Credentials');
  tap(b => b.dataset.action === 'assistant-portal-check' && b.dataset.id === 'NBCRNA', 'portal check button in sheet panel');
  await tick(); await tick();
  t('sheet yielded to the guided-check route (closed, Assistant tab)',
    run(`assistantSheetOpen`) === false && run(`tab`) === 'Assistant');
  run(`actions('assistant-portal-check','NBCRNA','','')`);
  t('guided check is in flight with its step state',
    !!run(`portalCheck`) && run(`portalCheck.source`) === 'nbcrna' && run(`portalCheck.step`) === 'collect');
  t('no floating button or sheet over the guided check', !appHTML().includes('assistant-fab') && !appHTML().includes('assistant-sheet'));
  t('guided-check panel renders intact on the Assistant tab', appHTML().includes('id="assistantForm"'));
  run(`portalCheck = null; portalStatePersist(); persist();`);

  // ---------- 8. Z-order + placement, from the stylesheet ----------
  const css = fs.readFileSync(R + 'styles.css', 'utf8');
  const zi = (sel) => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*z-index:(\\d+)')); return m ? +m[1] : null; };
  t('stylesheet pins the floating button', css.includes('.assistant-fab{position:fixed'));
  t('button is thumb-sized (54–56px) and safe-area aware',
    css.includes('width:56px;height:56px') && css.includes('env(safe-area-inset-bottom)') && css.includes('env(safe-area-inset-right)'));
  t('button z-index sits below every sheet backdrop', zi('.assistant-fab') === 55 && zi('.sheet-backdrop') === 60 && zi('.assistant-fab') < zi('.sheet-backdrop'));
  t('assistant sheet stacks above the stacked-editor tier', zi('.assistant-backdrop') === 80 && zi('.assistant-sheet') === 81 && zi('.assistant-backdrop') > zi('.sheet-backdrop-over'));
  t('sheet input stays above the keyboard: form pinned, chat scrolls',
    css.includes('.assistant-sheet .chat-form{flex:0 0 auto}') && css.includes('.assistant-sheet .chat{flex:1 1 auto'));
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('keyboard handling wired (visualViewport pins sheet height)', appSrc.includes('visualViewport') && appSrc.includes("e.target.id==='assistantInput'"));
  t('service worker cache bumped to v80', fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v110'));

  console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
})();
