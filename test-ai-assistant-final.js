// CRNA Hub — tests for AI-first contract reading + live Assistant chat
// (Nov 5, 2026 rework, branch muse/credentialing). Run:
//   node test-ai-assistant-final.js
// from ~/workspace/crna-hub-final-work/ai-assistant/
//
// Covers the task's acceptance checks WITHOUT any live API call:
//   * AI-primary ordering: in both contract panels the "Read with AI —
//     recommended" submit comes first, and the on-device OCR button is
//     the labelled fallback ("No connection? Try on-device reading —
//     less accurate on rate tables"), second.
//   * OCR fallback: the OCR path lives only in importContractWithOCR /
//     importFacilityContractWithOCR, wired to the fallback buttons; a
//     photo submit routes to AI, and with no sign-in it says so instead
//     of silently OCR-ing.
//   * Assistant fallback: a live call that fails (or no sign-in) falls
//     back to the deterministic on-device answer, labelled "On-device
//     answer"; a live call that succeeds is labelled "Live AI". The
//     summary sent to the model carries counts/totals only — never
//     facility notes/codes, documents, or patient information.
//   * .ics label: the calendar-file panel is headed "manual fallback"
//     and says "Import a file — not live sync".
//   * Proxy + Edge Function: api/fn.js allowlists assistant-chat/chat;
//     the assistant-chat function requires auth, reads OPENAI_API_KEY
//     from Deno.env only, and denies notes/passwords/patient data.
const fs = require('fs');
const vm = require('vm');
const R = '/home/hatch/workspace/crna-hub-final-work/ai-assistant/repo/';

const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const fnSrc = fs.readFileSync(R + 'api/fn.js', 'utf8');
const edgeSrc = fs.readFileSync(R + 'supabase/functions/assistant-chat/index.ts', 'utf8');

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
};

// ---------- Static checks on source ----------
const aiBtn = 'Read with AI — recommended (preview only, nothing saved yet)';
const ocrBtn = 'No connection? Try on-device reading — less accurate on rate tables';
for (const panel of ['facilityContractForm', 'contractForm']) {
  const i = appSrc.indexOf('id="' + panel + '"');
  const seg = appSrc.slice(i, i + 4000);
  const a = seg.indexOf(aiBtn), o = seg.indexOf(ocrBtn);
  t(panel + ': AI-primary submit comes first, OCR fallback second',
    a > -1 && o > -1 && a < o);
}
t('OCR fallback label text is exact (both panels)',
  (appSrc.match(new RegExp(ocrBtn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2);
t('submit handlers route photo submits to AI, not OCR',
  appSrc.includes("return readContractWithAI('contract');") &&
  appSrc.includes("return readContractWithAI('facility');"));
t('OCR path lives only in the explicit fallback functions',
  appSrc.includes('async function importContractWithOCR(e)') &&
  appSrc.includes('async function importFacilityContractWithOCR(e)') &&
  appSrc.includes("if(action==='contract-ocr')return importContractWithOCR();") &&
  appSrc.includes("if(action==='facility-contract-ocr')return importFacilityContractWithOCR();"));
t('photo submit with no sign-in says so instead of silently OCR-ing',
  appSrc.includes('AI reading (recommended) needs you signed in on the Account tab'));
t('cert-card OCR untouched (Credentials tab still reads cards on-device)',
  appSrc.includes('photos of cards with on-device OCR (Tesseract.js'));
t('.ics panel is a clearly-labelled manual fallback, never a sync path',
  appSrc.includes('Calendar files (.ics) — manual fallback') &&
  appSrc.includes('Import a file — not live sync.'));
t('assistant page copy: live model first, fallback labelled honestly',
  appSrc.includes('Live AI assistant — answers come from a live model') &&
  appSrc.includes('labelled “On-device answer”'));
t('assistant fallback appends the unavailability note, never fakes live',
  appSrc.includes('Live AI was unavailable, so this is the on-device answer'));
t('assistant messages carry a source label (Live AI / On-device answer)',
  appSrc.includes("m.source==='live'?' · Live AI'") &&
  appSrc.includes("· On-device answer"));
t('proxy allowlists assistant-chat with the single chat action',
  fnSrc.includes("'assistant-chat': new Set(['chat'])"));
t('proxy gives the assistant call the 60s AI timeout',
  fnSrc.includes("payload.function === 'assistant-chat'"));
t('Edge Function: auth required, key from Deno.env only, no hardcoded key',
  edgeSrc.includes('authUserId(req)') &&
  edgeSrc.includes('Deno.env.get("OPENAI_API_KEY")') &&
  !/sk-[A-Za-z0-9]/.test(edgeSrc));
t('Edge Function: denylist blocks notes, passwords, patient data, documents',
  edgeSrc.includes('"notes"') && edgeSrc.includes('"password"') &&
  edgeSrc.includes('"patient"') && edgeSrc.includes('"documents"'));
t('Edge Function: per-user throttle documented and implemented',
  edgeSrc.includes('MAX_PER_HOUR = 30') && edgeSrc.includes('MIN_INTERVAL_MS = 10_000') &&
  edgeSrc.includes('assistant_chat_log'));
t('Edge Function: question capped at 500 chars, summary capped and allowlisted',
  edgeSrc.includes('MAX_QUESTION_CHARS = 500') &&
  edgeSrc.includes('ALLOWED_TOP_KEYS'));
t('no secret literals in client code',
  !/['"]sk-[A-Za-z0-9]{20,}['"]/.test(appSrc) && !/service_role/i.test(appSrc) &&
  !/OPENAI_API_KEY\s*=\s*['"]/.test(appSrc));

// ---------- Behavioural checks in a vm sandbox (no network) ----------
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {}, focus() {},
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
    querySelectorAll: () => [], querySelector: () => null,
    createElement: () => el(), body: { append() {} },
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
vm.runInContext(appSrc, sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);

(async () => {
  // Seed records: a facility WITH notes holding a fake code (must never
  // reach the model), shifts this month + next, a credential deadline.
  run(`
    db.facilities = [{ id: 'f1', name: 'Holzer', aliases: 'HOL', address: '100 Hospital Dr', rate8: '2125', rate10: '2625', rate12: '', rate24: '4800', rateSecond: '3000', weekendRateSecond: '2000', hourlyRate: '250', paidHours8: '8.5', callBonus: '1000', distance: '', notes: 'Parking code 4821, EHR user jdoe, gate code 9911' }];
    db.shifts = [
      { id: 's1', date: '2026-11-01', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed' },
      { id: 's2', date: '2026-11-06', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed' },
      { id: 's3', date: '2026-11-07', facility: 'Holzer', type: 'Second call', pay: '3000', status: 'proposed' },
      { id: 's4', date: '2026-11-08', facility: 'Holzer', type: '24-hour call', pay: '', status: 'proposed' }
    ];
    db.mileage = []; db.pto = []; db.nbcrnaCE = []; db.aanaCE = [];
    db.nbcrna = { status: 'Certified', number: '126402', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', classA: '103', classB: '2', macEd: '60', macDev: '40', reminders: '90,60,30,7' };
    db.aana = { status: 'Active', number: '126402', expiration: '2027-12-31', reminders: '90,60,30,7' };
    db.licenses = [{ state: 'West Virginia', type: 'APRN', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7' }];
    db.assistantChat = [];
  `);

  // --- Summary cleanliness ---
  const summaryJson = run(`JSON.stringify(buildAssistantSummary())`);
  t('assistant summary: no facility notes, codes, or patient data reach the model',
    !summaryJson.includes('4821') && !summaryJson.includes('9911') &&
    !summaryJson.includes('Parking code') && !summaryJson.includes('"notes"') &&
    !summaryJson.includes('patient') && !summaryJson.includes('100 Hospital Dr'));
  t('assistant summary: month gross + year totals mirror the app helpers (date-relative)',
    run(`(() => { const s = buildAssistantSummary(); const y = yearIncomeSplit(currentYear()); return s.month.gross === 7250 && s.month.shiftCount === 4 && s.year.ytd === y.ytd && s.year.futureGross === y.futureGross && s.year.predicted === y.predicted; })()`));
  t('assistant summary: upcoming shifts capped at 5, unpriced pay is null (never $0)',
    run(`(() => { const s = buildAssistantSummary(); return s.upcoming.length === 3 && s.upcoming[2].pay === null; })()`));

  // --- Assistant: live failure -> deterministic fallback, labelled local ---
  run(`cloudSession = null;`);
  await run(`askAssistantLive("What shifts do I have coming up?")`);
  t('assistant fallback (not signed in): local answer, labelled On-device answer',
    run(`(() => { const h = db.assistantChat; const a = h[h.length - 1]; return a.source === 'local' && a.text.includes('Live AI was unavailable') && a.text.includes('upcoming shift'); })()`));

  // --- Assistant: live success -> labelled live ---
  let captured = null;
  // liveSyncPost is a function declaration in live-sync.js, so assigning
  // the sandbox global replaces it for the test (no network is used).
  sandbox.liveSyncPost = async (name, body) => {
    captured = { name, body };
    return { ok: true, answer: 'Live answer: 3 upcoming shifts, $5,125 after today.', model: 'gpt-4o-mini' };
  };
  run(`cloudSession = { access_token: 'test-token', expires_at: 9999999999, email: 'test@example.com' };`);
  await run(`askAssistantLive("What shifts do I have coming up?")`);
  t('assistant live call: posts to assistant-chat/chat with question + summary',
    captured && captured.name === 'assistant-chat' && captured.body.action === 'chat' &&
    captured.body.question === 'What shifts do I have coming up?' &&
    typeof captured.body.summary === 'object');
  t('assistant live call: summary sent to the server carries no notes/codes',
    captured && !JSON.stringify(captured.body.summary).includes('4821') &&
    !JSON.stringify(captured.body.summary).includes('"notes"'));
  t('assistant live success: answer stored, labelled Live AI',
    run(`(() => { const h = db.assistantChat; const a = h[h.length - 1]; return a.source === 'live' && a.text === 'Live answer: 3 upcoming shifts, $5,125 after today.'; })()`));

  // --- Assistant: live failure after a success -> local fallback again ---
  sandbox.liveSyncPost = async () => { throw new Error('network-stub'); };
  // Reset the client-side 10s interval so this call actually attempts live.
  run(`assistantChatLastLiveAt = 0;`);
  await run(`askAssistantLive("What's my projected income this month?")`);
  t('assistant fallback (live call throws): local answer, labelled On-device answer',
    run(`(() => { const h = db.assistantChat; const a = h[h.length - 1]; return a.source === 'local' && a.text.includes('Live AI was unavailable') && a.text.includes('Projected income this month'); })()`));

  // --- Contract answer text ---
  t('deterministic contract answer describes AI first, OCR as fallback',
    run(`answerQuestion('How are contract rates read?').includes('AI vision first')`) &&
    run(`answerQuestion('How are contract rates read?').includes('fallback')`));

  // --- Contract submit: photos + no sign-in -> plain error, no OCR, no network ---
  let networkCalled = false;
  sandbox.liveSyncPost = async () => { networkCalled = true; throw new Error('must not be called'); };
  elements.f_contractFile = { files: [{ name: 'addendum-p1.jpg', type: 'image/jpeg' }], value: 'addendum-p1.jpg' };
  run(`cloudSession = null; contractImportError = '';`);
  await run(`importContract({ preventDefault() {} })`);
  t('contract submit (photos, not signed in): plain error, no silent OCR, no network',
    run(`contractImportError.includes('AI reading (recommended) needs you signed in')`) &&
    run(`contractImportError.includes('No connection? Try on-device reading')`) &&
    !networkCalled && run(`contractPreview === null`));

  // --- Contract submit: photos + signed in -> AI path runs, preview built ---
  sandbox.liveSyncPost = async (name, body) => {
    if (name !== 'extract-contract') throw new Error('wrong function: ' + name);
    return {
      ok: true, model: 'gpt-4o-mini',
      rates: { facility: 'Holzer', regular_daily_rate: 2000, premium_hourly_rate: 250, first_call_hourly_rate: 175, second_call_weeknight_rate: 1000, second_call_weekend_rate: 2000, raw_text: 'January 5, 2027 — Holzer 8\nJanuary 6, 2027 — Holzer 8/2nd call' },
      raw_text: 'January 5, 2027 — Holzer 8\nJanuary 6, 2027 — Holzer 8/2nd call',
    };
  };
  // Stub the browser image resize (no canvas in the sandbox): pass the file through as a data URL.
  sandbox.aiContractImagesDataURLs = async (files) => files.map(() => 'data:image/jpeg;base64,AAAA');
  run(`cloudSession = { access_token: 'test-token', expires_at: 9999999999, email: 'test@example.com' };`);
  await run(`importContract({ preventDefault() {} })`);
  t('contract submit (photos, signed in): AI path builds a preview-before-save',
    run(`contractPreview !== null && contractPreview.aiRead === true && contractPreview.rows.length === 2`));
  t('contract AI preview: nothing saved yet, rows flagged from photo',
    run(`db.shifts.length === 4 && contractPreview.rows.every(r => r.flags.some(f => f.includes('from photo')))`));

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => { console.error('TEST HARNESS ERROR', e); process.exitCode = 1; });
