// CRNA Hub — v164: Assistant answers render safely, a normal follow-up
// no longer falls back just because it was asked quickly, and the
// on-device month-income answer carries ONE headline total.
//
// DIAGNOSIS (Nov 13, 2026, Caleb's real-account video): the income
// question did not fail because of account scale. The preceding Live
// AI answer completed at ~15s in the recording; the income question
// was submitted at ~20s and was already labelled On-device at ~21s.
// askAssistantLive() threw `rate_limited_client` BEFORE any network
// call whenever a follow-up arrived within ASSISTANT_MIN_INTERVAL_MS
// (10s) of the previous live success. A large fixture proves the
// scale theories out: 300+ shifts / 3 facilities / 3 pay schedules /
// full credentials / expenses build a ~2k summary that passes the
// Edge Function's own allow/deny + 20k rules and answers live when
// the call is actually attempted. THE FIX: a follow-up inside the
// spacing window waits in "Thinking…" until the window opens, then
// makes the live call. The throttle still spaces live calls; it no
// longer manufactures an "unavailable" fallback.
//
// Fallback defect: answerQuestion() printed the paycheck-basis
// headline AND the differently-based worked C/P totals in one answer
// ($39,832.50 landing vs $39,825.00 worked on the real account),
// unlabeled as different bases. It now returns the Dashboard headline
// only, with its basis named, and no second month total.
//
// Markdown defect: assistantChatInner() escaped the whole answer, so
// model markdown (**Shift Management**) showed as literal asterisks.
// Assistant answers now go through assistantMarkdownHTML(): escape
// first, then a safe subset (bold, italic, code, bullet / numbered
// lists, paragraphs + line breaks). User text stays plain-escaped.
//
// Proposed-email addendum (Caleb, Nov 13, 2026): the picker sheet is
// money-free too — rows are date + shift type only, exactly what the
// scheduler receives. The v163 picker-price pins are superseded in
// test-v163-email-override-pricing.js with this reason recorded.
// Run: node test-v164-assistant.js
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
    querySelectorAll: () => [], querySelector: () => null,
    setAttribute() {}, getAttribute: () => null,
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
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => el(), body: { append() {} },
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
const cssSrc = fs.readFileSync(R + 'styles.css', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
const edgeSrc = fs.readFileSync(R + 'supabase/functions/assistant-chat/index.ts', 'utf8');
run(fs.readFileSync(R + 'supabase-config.js', 'utf8'));
run(appSrc);
run(fs.readFileSync(R + 'live-sync.js', 'utf8'));

// ---------- large, real-account-shaped fixture ----------
run(`
  db = empty();
  db.facilities = [
    { id:'lf-h', name:'Holzer', aliases:'HOLZ', rate8:'2125', rate10:'2625', rate12:'3000', rate24:'4800', rateSecond:'3000', weekendRate24:'4200', weekendRateSecond:'2000', hourlyRate:'250', paidHours8:'8.5', notes:'NEVER SENT' },
    { id:'lf-r', name:'River General', aliases:'RG', rate8:'2000', rate10:'2500', rate12:'3000', rate24:'4500', rateSecond:'2800', weekendRate24:'4000', weekendRateSecond:'1900', hourlyRate:'250', paidHours8:'8', notes:'NEVER SENT' },
    { id:'lf-s', name:'Summit Medical', aliases:'SM', rate8:'1800', rate10:'2250', rate12:'2700', rate24:'4100', rateSecond:'2600', weekendRate24:'3900', weekendRateSecond:'1800', hourlyRate:'225', paidHours8:'8', notes:'NEVER SENT' }
  ];
  const D = (id, date, type, pay, status) => ({ id, date, facility:'Holzer', type, pay:String(pay), status:status || 'confirmed', source:'calendar' });
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
  // Scale: one shift on every remaining 2026 date outside November,
  // rotating across the three facilities — 330+ records in total.
  const facNames = ['Holzer','River General','Summit Medical'];
  const kinds = [['8-hour day','2125'],['10-hour day','2500'],['Second call','3000'],['24-hour call','4200']];
  let seq = 0;
  for (let m = 0; m < 12; m++) {
    if (m === 10) continue;
    const days = new Date(2026, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const iso = '2026-' + String(m + 1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      if (db.shifts.some(x => x.date === iso && x.facility === 'Holzer')) continue;
      const kind = kinds[seq % kinds.length];
      // September + October belong to Holzer in this fixture: the
      // other two facilities' monthly schedules step back into
      // November from their December pay dates, and a Sep 1–Oct 1
      // period full of their shifts would land a November check and
      // move the pinned November headline off the real-account figures.
      db.shifts.push({ id:'bulk-' + seq, date:iso, facility:m === 8 || m === 9 ? 'Holzer' : facNames[seq % 3], type:kind[0], pay:kind[1], status:seq % 13 === 0 ? 'proposed' : 'confirmed', source:seq % 4 ? 'calendar' : 'manual' });
      seq++;
    }
  }
  db.payStubs = [
    { id:'lp-h', agency:'Premier Anesthesia Group, PC', facility:'Holzer', frequency:'biweekly', periodStart:'2026-10-19', periodEnd:'2026-11-01', payDate:'2026-11-10', gross:'12757.50', net:'', source:'paystub' },
    { id:'lp-r', agency:'River Staffing LLC', facility:'River General', frequency:'monthly', periodStart:'2026-10-01', periodEnd:'2026-10-31', payDate:'2026-12-02', gross:'', net:'', source:'manual' },
    { id:'lp-s', agency:'Summit Locums LLC', facility:'Summit Medical', frequency:'monthly', periodStart:'2026-10-01', periodEnd:'2026-10-31', payDate:'2026-12-05', gross:'', net:'', source:'manual' }
  ];
  db.nbcrna = { status:'Certified', number:'', periodStart:'2023-05-01', periodEnd:'2027-04-30', renewalDeadline:'2027-04-30', classA:'103', classB:'2', macEd:'60', macDev:'40', macEdRequired:60, macDevRequired:40, reminders:'90,60,30,7', source:'agent_read' };
  db.aana = { status:'Active', number:'', expiration:'2027-08-31', reminders:'90,60,30,7', source:'agent_read' };
  db.licenses = [
    { state:'West Virginia', type:'RN', status:'Active', expiry:'2028-06-30', reminders:'90,60,30,7', source:'agent_read' },
    { state:'West Virginia', type:'APRN-CRNA', status:'Active', expiry:'2027-06-30', reminders:'90,60,30,7', source:'agent_read' },
    { state:'Ohio', type:'RN', status:'Active', expiry:'2028-06-30', reminders:'90,60,30,7', source:'agent_read' },
    { state:'Ohio', type:'APRN-CRNA', status:'Active', expiry:'2027-10-31', reminders:'90,60,30,7', source:'agent_read' }
  ];
  db.documents = [
    { certType:'BLS', expiry:'2028-01-31', expirySource:'extracted' },
    { certType:'ACLS', expiry:'2028-01-31', expirySource:'extracted' },
    { certType:'PALS', expiry:'2028-01-31', expirySource:'extracted' }
  ];
  db.credentials = [{ name:'TNCC', expiry:'2028-12-31' }];
  db.expenses = Array.from({ length:48 }, (_, i) => ({ id:'le-' + i, date:'2026-11-' + String((i % 28) + 1).padStart(2,'0'), vendor:'Vendor ' + (i % 7), amount:String(25 + i), category:'Supplies', type:'business' }));
  db.mileage = []; db.pto = []; db.nbcrnaCE = []; db.aanaCE = []; db.assistantChat = [];
  db.settings = Object.assign({}, db.settings, { employmentType:'1099', monthlyIncomeGoal:40000, scheduleName:'Large Fixture' });
  persist();
`);

t('fixture: 300+ shifts across the year', run(`db.shifts.length`) > 300, String(run(`db.shifts.length`)));
t('fixture: 3 facilities, 3 pay schedules, full credentials, expenses',
  run(`db.facilities.length`) === 3 && run(`db.payStubs.length`) === 3 &&
  run(`db.expenses.length`) === 48 && run(`buildAssistantSummary().credentials.onFile.length`) >= 8);
t('fixture: November headline is the pinned paycheck basis $39,832.50 (worked $39,825)',
  run(`monthHeadline('2026-11').gross`) === 39832.5 && run(`monthIncomeSplit('2026-11').p`) === 39825,
  JSON.stringify(run(`monthHeadline('2026-11')`)));

// ---------- scale ruled out: the summary passes the function's own rules ----------
function parseKeySet(src, constName) {
  const m = src.match(new RegExp('const ' + constName + ' = new Set\\(\\[([\\s\\S]*?)\\]\\);'));
  return m ? new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])) : null;
}
const ALLOWED = parseKeySet(edgeSrc, 'ALLOWED_TOP_KEYS');
const DENIED = parseKeySet(edgeSrc, 'DENIED_KEYS');
const summary = run(`buildAssistantSummary()`);
const summaryJson = JSON.stringify(summary);
let deniedHit = null;
(function walk(v, p) {
  if (deniedHit || !v || typeof v !== 'object') return;
  for (const [k, val] of Object.entries(v)) {
    if (DENIED && DENIED.has(k)) { deniedHit = p + k; return; }
    walk(val, p + k + '.');
  }
})(summary, '');
t('scale: summary is far under the 20,000-char Edge limit', summaryJson.length < 20000, String(summaryJson.length));
t('scale: every top-level key is allowed and no denied key appears at any depth',
  !!ALLOWED && Object.keys(summary).every(k => ALLOWED.has(k)) && deniedHit === null, deniedHit || Object.keys(summary).join(','));
t('scale: summary month is the one headline ($39,832.50, paycheck basis)',
  summary.month.gross === 39832.5 && summary.month.basis === 'paycheck', JSON.stringify(summary.month));

// ---------- the three exact questions at large-fixture scale ----------
const calls = [];
sandbox.liveSyncPost = async (name, body) => {
  calls.push({ name, body });
  if (/credentials are expiring/i.test(body.question)) {
    return { ok: true, answer: 'Nothing is expiring soon. The soonest item on file is your NBCRNA certification, which expires on April 30, 2027.', model: 'gpt-4o-mini' };
  }
  if (/how can CRNA Hub help/i.test(body.question)) {
    return { ok: true, answer: 'CRNA Hub can help by managing your scheduling and administrative tasks, including:\n\n1. **Shift Management**: Keep all your shifts in one calendar.\n2. **Income Forecasting**: Estimate your income and paychecks.\n\n- Track licenses and certifications\n- Log mileage for verified trips\n\nIt uses *your* records only.', model: 'gpt-4o-mini' };
  }
  return { ok: true, answer: 'Your projected income this month is $39,832.50, on the paycheck basis.', model: 'gpt-4o-mini' };
};
run(`cloudSession = { access_token:'test-token', expires_at:9999999999 }; assistantChatLastLiveAt = 0; db.assistantChat = []; persist();`);

(async () => {
  // (1) Credentials — the path Caleb confirmed works; no regression.
  await run(`askAssistantLive('What credentials are expiring soon?')`);
  let last = run(`db.assistantChat[db.assistantChat.length - 1]`);
  t('Q1 credentials: answered by Live AI (not the fallback)', last.source === 'live', JSON.stringify(last));
  t('Q1 credentials: names the soonest item — NBCRNA, April 30, 2027',
    /NBCRNA/.test(last.text) && /April 30, 2027/.test(last.text), last.text);
  t('Q1 credentials: the captured request carried the full summary contract',
    calls.length === 1 && calls[0].name === 'assistant-chat' && calls[0].body.summary.credentials.onFile.length >= 8);

  // (2) Help — Live AI markdown renders as formatting, never asterisks.
  run(`assistantChatLastLiveAt = 0;`);
  await run(`askAssistantLive('How can CRNA Hub help me?')`);
  last = run(`db.assistantChat[db.assistantChat.length - 1]`);
  t('Q2 help: answered by Live AI', last.source === 'live', JSON.stringify(last));
  const chatHtml = run(`assistantChatInner()`);
  t('Q2 help: rendered answer contains <strong>Shift Management</strong>',
    chatHtml.includes('<strong>Shift Management</strong>'), chatHtml.slice(0, 600));
  t('Q2 help: rendered answer contains NO literal ** anywhere',
    !chatHtml.includes('**'), chatHtml.slice(0, 600));
  t('Q2 help: numbered + bullet lists and italics render as HTML',
    chatHtml.includes('<ol>') && chatHtml.includes('<li>') && chatHtml.includes('<ul>') && chatHtml.includes('<em>your</em>'), chatHtml.slice(0, 900));

  // Markdown safety: raw HTML from a model is escaped, never injected.
  const safe = run(`assistantMarkdownHTML('Safe **bold** <script>alert(1)</script> and [x](https://example.com)')`);
  t('markdown: raw HTML is escaped (no <script> tag survives)',
    safe.includes('&lt;script&gt;') && !safe.includes('<script>'), safe);
  t('markdown: paragraphs and line breaks render',
    run(`assistantMarkdownHTML('One\\nTwo\\n\\nThree')`) === '<p>One<br>Two</p><p>Three</p>');

  // (3) Income — asked 100ms BEFORE the 10s spacing window opens
  // after the previous live success (the video's shape, compressed):
  // pre-fix this fell back instantly without any network call; now it
  // waits for the window and answers live.
  const callsBefore = calls.length;
  run(`assistantChatLastLiveAt = Date.now() - (ASSISTANT_MIN_INTERVAL_MS - 100);`);
  await run(`askAssistantLive("What's my projected income this month?")`);
  last = run(`db.assistantChat[db.assistantChat.length - 1]`);
  t('Q3 income: the live call was actually attempted inside the old fallback window',
    calls.length === callsBefore + 1 && calls[calls.length - 1].body.question === "What's my projected income this month?",
    'calls ' + callsBefore + ' -> ' + calls.length);
  t('Q3 income: answered by Live AI at large-fixture scale (not the fallback)',
    last.source === 'live' && last.text.includes('$39,832.50'), JSON.stringify(last));

  // Forced fallback: exactly ONE month total, the banner's basis.
  sandbox.liveSyncPost = async () => { throw new Error('network-down'); };
  run(`assistantChatLastLiveAt = 0;`);
  await run(`askAssistantLive("What's my projected income this month?")`);
  last = run(`db.assistantChat[db.assistantChat.length - 1]`);
  const money = last.text.match(/\$[\d,]+\.\d{2}/g) || [];
  t('fallback income: labelled On-device with the unavailability note',
    last.source === 'local' && last.text.includes('Live AI was unavailable'), JSON.stringify(last));
  t('fallback income: exactly ONE currency total in the whole answer',
    money.length === 1, JSON.stringify(money) + ' — ' + last.text);
  t('fallback income: the one total is the Dashboard headline $39,832.50 (paycheck basis, named)',
    money[0] === '$39,832.50' && /paycheck basis/.test(last.text) && /November/.test(last.text), last.text);
  t('fallback income: the worked-basis $39,825.00 appears nowhere; no C/P split, no by-facility totals',
    !last.text.includes('$39,825') && !/C \(confirmed/.test(last.text) && !/By facility/.test(last.text), last.text);
  const direct = run(`answerQuestion("What's my projected income this month?")`);
  t('fallback income (direct): one total, matching monthHeadline exactly',
    (direct.match(/\$[\d,]+\.\d{2}/g) || []).length === 1 && direct.includes(run(`currency(monthHeadline('2026-11').gross)`)), direct);

  // CSS + SW pins.
  t('css: assistant markdown elements are styled (p / ul / ol / code)',
    cssSrc.includes('.msg.assistant p') && cssSrc.includes('.msg.assistant ul') && cssSrc.includes('.msg.assistant code'));
  t('sw: cache bumped to v164', swSrc.includes('crna-hub-shell-v164'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
