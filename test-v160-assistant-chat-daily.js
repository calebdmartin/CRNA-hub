// CRNA Hub — v160 (Nov 13, 2026): Assistant chat daily auto-clear.
//
// Caleb's words: the Assistant chat history clears itself every day —
// on first Assistant open of a new local calendar day, the thread
// starts fresh. Implemented as assistantDailyReset(): a stored
// last-open date (settings.assistantChatDay, riding the chat's own
// persisted state) compared against today at panel render AND at ask
// time (so a first question asked before any render also starts
// fresh, and never eats the question just asked). The manual
// "Clear chat history" button is REMOVED — obsolete once clearing is
// automatic.
//
// What this pins:
//  1 new-day open wipes: stale stamp + seeded history -> rendering the
//    panel empties the thread and stamps today.
//  2 same-day open preserves: stamp today + seeded history -> the
//    history renders untouched.
//  3 day-after-next open wipes again (the stamp moves, not just once).
//  4 the floating sheet surface behaves the same (one conversation,
//    two surfaces — same panel, same reset).
//  5 no clear-history control remains in the view: neither the tab
//    page nor the sheet render a "Clear chat history" button or a
//    clear-chat action target, and the string is gone from app.js.
// Run: node test-v160-assistant-chat-daily.js
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

const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
run(appSrc);

const today = run(`localDate(new Date())`);
const yesterday = run(`localDate(new Date(Date.now() - 864e5))`);
t('0 harness dates are sane (today != yesterday)', today !== yesterday, today + ' vs ' + yesterday);

// ---------- 1: new-day open wipes ----------
run(`
  db.assistantChat = [
    { role: 'user', text: 'yesterday question marker' },
    { role: 'assistant', text: 'yesterday answer marker', source: 'live' }
  ];
  db.settings.assistantChatDay = '${yesterday}';
`);
const html1 = run(`assistantPanelHTML(['chip'])`);
t('1a new-day open: the old thread is wiped from the rendered panel',
  !html1.includes('yesterday question marker') && !html1.includes('yesterday answer marker'));
t('1b new-day open: db.assistantChat is empty and the stamp moved to today',
  run(`(db.assistantChat || []).length`) === 0 && run(`db.settings.assistantChatDay`) === today,
  run(`db.settings.assistantChatDay`));
t('1c new-day open: the panel shows the fresh-thread prompt',
  html1.includes('Ask about your schedule, income, credentials, mileage'));

// ---------- 2: same-day open preserves ----------
run(`
  db.assistantChat = [
    { role: 'user', text: 'today question marker' },
    { role: 'assistant', text: 'today answer marker', source: 'live' }
  ];
`);
const html2 = run(`assistantPanelHTML(['chip'])`);
t('2a same-day open: the thread renders untouched',
  html2.includes('today question marker') && html2.includes('today answer marker'));
t('2b same-day open: history length and stamp unchanged',
  run(`(db.assistantChat || []).length`) === 2 && run(`db.settings.assistantChatDay`) === today);

// ---------- 3: the NEXT day wipes again ----------
run(`db.settings.assistantChatDay = '${yesterday}';`);
const html3 = run(`assistantPanelHTML(['chip'])`);
t('3 a later new day wipes again (reset is per-day, not one-shot)',
  !html3.includes('today question marker') && run(`(db.assistantChat || []).length`) === 0 &&
  run(`db.settings.assistantChatDay`) === today);

// ---------- 4: the floating sheet surface behaves the same ----------
run(`
  db.assistantChat = [{ role: 'user', text: 'sheet stale marker' }];
  db.settings.assistantChatDay = '${yesterday}';
  assistantSheetOpen = true;
`);
const sheet = run(`assistantSheetHTML()`);
t('4 sheet open on a new day also starts fresh',
  !sheet.includes('sheet stale marker') && run(`(db.assistantChat || []).length`) === 0);
run(`assistantSheetOpen = false;`);

// ---------- 5: no clear-history control remains ----------
const page = run(`assistantPage()`);
t('5a Assistant tab page renders no "Clear chat history" control',
  !page.includes('Clear chat history') && !page.includes('clear-chat'));
t('5b sheet renders no "Clear chat history" control',
  !sheet.includes('Clear chat history') && !sheet.includes('clear-chat'));
t('5c no clear-chat control wiring remains in app.js (button target + action)',
  !appSrc.includes('data-action="clear-chat"') && !appSrc.includes("action==='clear-chat'") &&
  !appSrc.includes('>Clear chat history</button>'));
t('5d the ask form and starter chips still render (panel otherwise intact)',
  page.includes('id="assistantForm"') && page.includes('data-action="ask"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
