// CRNA Hub — v143 agent-read loop: session + request side (Nov 12, 2026).
// Run: node test-v143-agent-read-loop.js
//
// Caleb: "I want the app to be able to read and pull all of that info
// and not have to rely on you to do it… what's the next best thing
// that limits the user from having to take screenshots, navigate the
// NBCRNA website that can be difficult."
//
// v142 built the filing door (applyPortalAgentRead). v143 builds the
// SESSION + REQUEST side so a read is triggered by ONE user action:
//   * migration 015 adds session_state / read_requested_at /
//     last_read_outcome to portal_connections;
//   * "I'm signed in — read it now" queues a read (read_requested_at
//     via the portals upsert/PATCH path); filing a result through
//     applyPortalAgentRead clears the request and files the session
//     outcome for all four outcomes;
//   * the card primary path is Connect → read it now — the guided
//     screenshot check and manual routes live ONLY in the collapsed
//     "Or add it another way" backup; no primary-path string mentions
//     screenshots or showing the assistant the page;
//   * the due prompt is the session-expiry prompt ("…check due — it
//     needs a fresh sign-in", one tap into the card's sign-in action);
//     a due source with a LIVE session gets NO prompt — the sweep
//     quietly queues its read instead; a needs-sign-in source gets
//     ONLY the prompt, never an alarm and never a queued read;
//   * the card status line carries the session state in plain words
//     ("Session live" / "Needs your sign-in") next to the read status.
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
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const tick = () => new Promise(r => setTimeout(r, 5));

(async () => {
  // ---------- 1. Migration 015 ----------
  const mig = fs.readFileSync(R + 'supabase/supabase-schema-015.sql', 'utf8');
  t('migration 015: adds the three session/request columns to portal_connections, idempotently',
    /alter table public\.portal_connections/.test(mig) &&
    /add column if not exists session_state text not null default 'unknown'/.test(mig) &&
    /add column if not exists read_requested_at timestamptz/.test(mig) &&
    /add column if not exists last_read_outcome text/.test(mig));
  t('migration 015: value checks match the app enums; RLS re-asserted (own-rows policies already cover all columns)',
    mig.includes("'live', 'needs_signin', 'unknown'") &&
    mig.includes("'read', 'needs-sign-in', 'blocked', 'not-found'") &&
    /enable row level security/.test(mig));

  // ---------- shared cloud stub ----------
  run(`
    cloudSession = { user: { id: 'u1' }, email: 'crna@example.com' }; cloudActive = true;
    globalThis.__sb = [];
    sbReq = async (p, m, b) => { globalThis.__sb.push({ p, m, b }); return m === 'GET' ? [] : {}; };
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,checkStatus:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered',updatedAt:''};
    db.aana = {status:'',number:'',expiration:'',source:'user_entered',docNote:'',ceNote:'',reminders:'90,60,30,7',updatedAt:''};
    db.licenses = []; db.portalMonitoring = []; db.portalChecks = [];
  `);
  const patches = () => sandbox.__sb.filter(x => x.m === 'PATCH' && x.p.includes('portal_connections'));

  // ---------- 2. The read request: one tap queues it ----------
  run(`
    cloudPortals = [{ id: 'row-nb', portal: 'nbcrna', state: null, status: 'connected', last_synced_at: '2026-11-12T12:00:00Z', session_state: 'live', read_requested_at: null, last_read_outcome: 'read' }];
    globalThis.__stamp = portalRequestRead('nbcrna');
    globalThis.__rowAfterReq = Object.assign({}, cloudPortals[0]);
    globalThis.__stateAfterReq = portalReadState('nbcrna');
  `);
  await tick();
  t('request: tapping read-it-now stamps read_requested_at on the row (the reader queue)',
    !!sandbox.__stamp && sandbox.__rowAfterReq.read_requested_at === sandbox.__stamp &&
    sandbox.__stateAfterReq.readRequestedAt === sandbox.__stamp);
  t('request: the stamp is written through the portals path (PATCH portal_connections)',
    patches().some(x => x.b && x.b.read_requested_at === sandbox.__stamp));
  run(`globalThis.__cardReq = credentialsPage();`);
  t('card: a queued read says so, next to a plain-words session line',
    sandbox.__cardReq.includes('Read requested — we’ll read it from your signed-in session shortly') &&
    sandbox.__cardReq.includes('Session live') &&
    sandbox.__cardReq.includes('data-action="portal-read-request" data-id="nbcrna"'));

  // ---------- 3. Filing a result: clears the request, files the session outcome ----------
  const seedAndFile = async (seedSession, outcome, fields) => {
    run(`
      cloudPortals = [{ id: 'row-nb', portal: 'nbcrna', state: null, status: 'connected', last_synced_at: '2026-11-12T12:00:00Z', session_state: '${seedSession}', read_requested_at: '2026-11-12T13:00:00.000Z', last_read_outcome: null }];
      globalThis.__sb = [];
      globalThis.__res = applyPortalAgentRead('nbcrna', { outcome: '${outcome}'${fields ? `, fields: ${fields}` : ''}, reason: 'pin' });
      globalThis.__rowFiled = Object.assign({}, cloudPortals[0]);
      globalThis.__stateFiled = portalReadState('nbcrna');
    `);
    await tick();
    return sandbox.__rowFiled;
  };
  let row = await seedAndFile('needs_signin', 'read', `{ status: 'Certified', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30' }`);
  t('filed read: request cleared, session proven live, outcome recorded — in memory and via PATCH',
    row.read_requested_at === null && row.session_state === 'live' && row.last_read_outcome === 'read' &&
    sandbox.__stateFiled.readRequestedAt === '' &&
    patches().some(x => x.b && x.b.read_requested_at === null && x.b.session_state === 'live' && x.b.last_read_outcome === 'read'));
  row = await seedAndFile('live', 'needs-sign-in');
  t('filed needs-sign-in: request cleared, session filed needs_signin, outcome recorded',
    row.read_requested_at === null && row.session_state === 'needs_signin' && row.last_read_outcome === 'needs-sign-in');
  row = await seedAndFile('live', 'blocked');
  t('filed blocked: request cleared + outcome recorded; session NOT moved (blocked proves nothing about it)',
    row.read_requested_at === null && row.session_state === 'live' && row.last_read_outcome === 'blocked');
  row = await seedAndFile('unknown', 'not-found');
  t('filed not-found: request cleared + outcome recorded; session stays unknown',
    row.read_requested_at === null && row.session_state === 'unknown' && row.last_read_outcome === 'not-found');

  // ---------- 4. Card flow: primary path vs collapsed backup ----------
  run(`
    cloudPortals = []; portalOpened = {}; portalLeaveSheet = '';
    globalThis.__page = credentialsPage();
  `);
  const cardSeg = (page, key, nextKey) => {
    const a = page.indexOf(`id="credentials-${key}-panel"`);
    const b = nextKey ? page.indexOf(`id="credentials-${nextKey}-panel"`) : page.length;
    return a < 0 ? '' : page.slice(a, b < 0 ? page.length : b);
  };
  for (const [key, next] of [['nbcrna', 'aana'], ['aana', 'licenses'], ['licenses', null]]) {
    const seg = cardSeg(sandbox.__page, key, next);
    const cut = seg.indexOf('<details>');
    const primary = cut < 0 ? seg : seg.slice(0, cut);
    const backup = cut < 0 ? '' : seg.slice(cut);
    t(`card ${key}: primary path is Connect → "I'm signed in — read it now" (request action present, no guided-check actions)`,
      primary.includes(`data-portal-connect="${key}"`) &&
      primary.includes(`data-action="portal-read-request" data-id="${key}"`) &&
      !primary.includes('assistant-portal-check') && !primary.includes('portal-return'));
    t(`card ${key}: primary path copy is screenshot-free and never says "show the assistant"`,
      !/screenshot/i.test(primary) && !/show (me|the assistant)/i.test(primary));
    t(`card ${key}: guided check + manual routes survive ONLY inside the collapsed "Or add it another way" backup`,
      backup.includes('Or add it another way') && backup.includes('assistant-portal-check') &&
      backup.includes('user-entered, not verified'));
  }
  t('source audit: the old primary-path screenshot instruction is gone from the app',
    !appSrc.includes('sign in, then screenshot') && !appSrc.includes('One tap brings you back and starts your check'));
  run(`
    portalOpened = { nbcrna: true, aana: true, licenses: true };
    globalThis.__pageOpened = credentialsPage();
    portalOpened = {};
  `);
  const segNb = cardSeg(sandbox.__pageOpened, 'nbcrna', 'aana');
  const segNbBackup = segNb.slice(segNb.indexOf('<details>'));
  t('opened card: the return line points at read-it-now; "I’m back — run my check" waits in the backup only',
    segNb.slice(0, segNb.indexOf('<details>')).includes('Signed in over there?') &&
    segNb.slice(0, segNb.indexOf('<details>')).includes('read it now') &&
    segNbBackup.includes('data-action="portal-return" data-id="nbcrna"'));

  // ---------- 5. The backup still works when used ----------
  run(`actions('assistant-portal-check', 'NBCRNA'); globalThis.__pc = portalCheck && { source: portalCheck.source, step: portalCheck.step }; globalThis.__tab5 = tab; portalCheck = null;`);
  t('backup reachable: the guided check still starts from its button (Assistant tab, collect step)',
    sandbox.__pc && sandbox.__pc.source === 'nbcrna' && sandbox.__pc.step === 'collect' && sandbox.__tab5 === 'Assistant');

  // ---------- 6. Watchdog: live session queues quietly; needs-sign-in prompts only ----------
  run(`
    db.portalMonitoring = []; ensurePortalMonitoring();
    const m = db.portalMonitoring.find(x => x.key === 'nbcrna');
    m.lastChecked = ''; m.lastOutcome = ''; m.snoozeUntil = ''; m.promptDismissedCycle = '';
    cloudPortals = [{ id: 'row-nb', portal: 'nbcrna', state: null, status: 'connected', last_synced_at: '2026-11-12T12:00:00Z', session_state: 'live', read_requested_at: null, last_read_outcome: 'read' }];
    globalThis.__sb = [];
  `);
  await run(`monitorBackgroundSweep()`);
  run(`
    globalThis.__rowSwept = Object.assign({}, cloudPortals[0]);
    globalThis.__monLive = db.portalMonitoring.find(x => x.key === 'nbcrna');
    globalThis.__promptLive = monitorPromptVisible(globalThis.__monLive, localDate(new Date()));
    globalThis.__stripLive = monitorDuePromptsHTML();
  `);
  t('watchdog: a due source with a live session quietly queues its own read (no user action)',
    !!sandbox.__rowSwept.read_requested_at);
  t('watchdog: live session = NO prompt (the read is queued instead of nagging)',
    sandbox.__promptLive === false && !sandbox.__stripLive.includes('NBCRNA check due'));
  run(`
    cloudPortals[0].session_state = 'needs_signin'; cloudPortals[0].read_requested_at = null;
    globalThis.__monNs = db.portalMonitoring.find(x => x.key === 'nbcrna');
    globalThis.__promptNs = monitorPromptVisible(globalThis.__monNs, localDate(new Date()));
    globalThis.__stripNs = monitorDuePromptsHTML();
  `);
  t('prompt: a due needs-sign-in source surfaces the session-expiry prompt with the one-tap sign-in route',
    sandbox.__promptNs === true &&
    sandbox.__stripNs.includes('NBCRNA check due — it needs a fresh sign-in') &&
    sandbox.__stripNs.includes('data-action="monitor-signin" data-id="nbcrna"') &&
    !/check failed|failed/i.test(sandbox.__stripNs));
  await run(`monitorBackgroundSweep()`);
  t('watchdog: needs-sign-in is NEVER auto-queued (the prompt is the only surface)',
    run(`cloudPortals[0].read_requested_at`) === null);
  run(`
    tab = 'Dashboard'; portalLeaveSheet = '';
    actions('monitor-signin', 'nbcrna');
    globalThis.__signinRoute = { tab, sheet: portalLeaveSheet };
  `);
  t('prompt action: one tap lands on the Credentials card and runs its sign-in action',
    sandbox.__signinRoute.tab === 'Credentials' && sandbox.__signinRoute.sheet === 'nbcrna');
  run(`portalLeaveSheet = '';`);

  // ---------- 7. Cloud mapping round-trips the three fields ----------
  run(`
    globalThis.__posts = [];
    sbReq = async (p, m, b) => { if (m === 'POST') globalThis.__posts.push(b); return m === 'GET' ? [] : {}; };
    db.licenses = [];
  `);
  await run(`cloudUpsertPortals()`);
  const created = (sandbox.__posts[0] || [])[0] || {};
  t('upsert: newly created portal rows carry session_state unknown + empty request/outcome',
    created.portal === 'nbcrna' && created.session_state === 'unknown' &&
    created.read_requested_at === null && created.last_read_outcome === null);
  run(`
    globalThis.__posts2 = [];
    sbReq = async (p, m, b) => { if (m === 'POST') { if (JSON.stringify(b).includes('session_state')) throw new Error('column session_state does not exist'); globalThis.__posts2.push(b); } return m === 'GET' ? [] : {}; };
  `);
  await run(`cloudUpsertPortals()`);
  const legacy = (sandbox.__posts2[0] || [])[0] || {};
  t('upsert fallback: on a pre-015 database, creation retries without the new columns (loop dark, nothing broken)',
    legacy.portal === 'nbcrna' && !('session_state' in legacy) && !('read_requested_at' in legacy));
  run(`
    cloudPortals = [{ id: 'row-aa', portal: 'aana', state: null, status: 'not_connected', last_synced_at: null, session_state: 'needs_signin', read_requested_at: null, last_read_outcome: 'needs-sign-in' }];
    globalThis.__aanaState = portalReadState('aana');
    globalThis.__cardNs = credentialsPage();
  `);
  t('apply: portal rows arriving from the cloud expose their session fields to the app',
    sandbox.__aanaState.sessionState === 'needs_signin' && sandbox.__aanaState.lastReadOutcome === 'needs-sign-in');
  t('card: needs-sign-in session reads "Needs your sign-in" beside the status, and Connect becomes "Sign in to refresh"',
    sandbox.__cardNs.includes('Needs your sign-in') && sandbox.__cardNs.includes('Sign in to refresh — AANA'));

  console.log(failures === 0 ? '\nAll v143 agent-read loop tests passed.' : `\n${failures} test(s) failed.`);
  process.exit(failures ? 1 : 0);
})();
