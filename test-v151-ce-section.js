// CRNA Hub — v151 (Nov 12, 2026):
//   Item 1 — Continuing education gets its own VISIBLE section on
//     the Credentials tab. Caleb couldn't find the add-CE form
//     (it lived inside the collapsed "Manual entry" panel, behind
//     an Entry type dropdown). The form + lists move — same
//     ceForm component, same records — into a sibling "Continuing
//     education" panel after State Licenses / before Certification
//     documents, and Manual entry stops offering the CE types, so
//     there is exactly ONE door for CE. A CE edit opens the new
//     section, not the manual panel.
//     v153 SUPERSEDES the Item 1 form/toggle/edit pins in this
//     file: Caleb then removed the manual CE form entirely ("Let's
//     get rid of the manual CE tab") — the section is READ-ONLY,
//     both lists render at once, and the pins below assert that
//     new shape (full pins in test-v153-no-manual-ce.js). Items
//     2–4 (CE Broker, AANA headline, license CE lines) stand.
//   Item 2 — CE Broker as a fifth monitored portal (agent-read
//     model, same family as NBCRNA / AANA / state boards): a
//     connCard card (Connect → cebroker.com sign-in → "I'm signed
//     in — read it now"), session states, return greeting, cadence-
//     only monitoring (CE Broker has no expiry of its own), and a
//     filing door: applyPortalAgentRead('cebroker', read) files
//     the transcript's courses as CE records (aanaCE unless a
//     course says otherwise), deduped on title+date+credits,
//     stamped source 'cebroker', feeding the v150 progress.
//     No server pull is built — the portals block it.
//   Item 3 — AANA CE totals promoted to a big headline line at
//     the top of the AANA card (Caleb: "Let's make this bigger.
//     Possibly directly under the AANA Active expires Aug 31,
//     2027"). The clause leaves the small v145 strip so the fact
//     appears exactly once; no totals on file → no line.
// Run: node test-v151-ce-section.js
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
const css = fs.readFileSync(R + 'styles.css', 'utf8');
let failures = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);
const tick = () => new Promise(r => setTimeout(r, 5));
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
  // ---------- Item 1: the Continuing education section ----------
  run(RESET + `globalThis.__page = credentialsPage();`);
  const page = sandbox.__page;
  t('CE section: a visible sibling panel titled Continuing education',
    !!panelTag(page, 'credentials-ce-panel') && page.includes('Continuing education'));
  t('CE section: placed after State Licenses, before Certification documents, before Manual entry',
    page.indexOf('id="credentials-licenses-panel"') < page.indexOf('id="credentials-ce-panel"') &&
    page.indexOf('id="credentials-ce-panel"') < page.indexOf('id="cert-documents"') &&
    page.indexOf('id="credentials-ce-panel"') < page.indexOf('id="credentials-manual-panel"'));
  const ceSeg = seg(page, 'credentials-ce-panel', 'cert-documents');
  // v153 rewrite: the manual CE form is gone — no ceTypeSelect
  // exists anywhere on the page; the section is its own panel.
  t('CE section: NOT nested in the manual panel (and no CE form exists anywhere — v153)',
    !page.includes('ceTypeSelect') && ceSeg.includes('Continuing education'));
  // v153 rewrite: no form renders in the section — it is the
  // read-only home for records filed by reads (full pins in
  // test-v153-no-manual-ce.js).
  t('CE section: read-only — no CE form, no pickers, no Add CE record button (v153)',
    !ceSeg.includes('data-kind="nbcrnaCE"') && !ceSeg.includes('data-kind="aanaCE"') &&
    !ceSeg.includes('name="countsToward"') && !ceSeg.includes('name="category"') &&
    !ceSeg.includes('Add CE record') && !ceSeg.includes('<form'));
  // v153 rewrite: with zero records the section shows the empty
  // state; the totals lines render once records are on file.
  run(`db.nbcrnaCE = [{ id: 'c0', title: 'Seed course', date: '2026-01-01', credits: '3', class: 'Class A' }]; globalThis.__pageT = credentialsPage();`);
  t('CE section: NBCRNA totals line renders inside it once records are on file',
    seg(sandbox.__pageT, 'credentials-ce-panel', 'cert-documents').includes('Recorded totals — Class A:'));
  run(RESET);
  t('CE section: fresh user (no courses) starts open, like the primary cards',
    panelTag(page, 'credentials-ce-panel').includes(' open'));
  // v153 rewrite: there is no toggle — BOTH lists render at once.
  run(`db.nbcrnaCE = [{ id: 'c1', title: 'NB course', date: '2026-01-01', credits: '3', class: 'Class A' }];
    db.aanaCE = [{ id: 'c2', title: 'AA course', date: '2026-02-01', credits: '5' }];
    globalThis.__pageA = credentialsPage();`);
  t('CE section: BOTH lists render at once — no toggle (v153)',
    seg(sandbox.__pageA, 'credentials-ce-panel', 'cert-documents').includes('Recorded totals — Class A:') &&
    seg(sandbox.__pageA, 'credentials-ce-panel', 'cert-documents').includes('Recorded total:') &&
    seg(sandbox.__pageA, 'credentials-ce-panel', 'cert-documents').includes('NB course') &&
    seg(sandbox.__pageA, 'credentials-ce-panel', 'cert-documents').includes('AA course'));
  run(RESET);
  t('manual dropdown: CE record types are gone — exactly one door for CE',
    !page.includes('>NBCRNA CE record<') && !page.includes('>AANA CE record<') &&
    page.includes('>NBCRNA</option>') && page.includes('>Other credential</option>'));
  t('manual panel source: no CE branches remain behind the Entry type dropdown',
    !appSrc.includes("manualType==='NBCRNA CE'") && !appSrc.includes("manualType==='AANA CE'"));
  // v153 rewrite: the CE edit flow is GONE with the form. A stale
  // editId naming a CE record opens nothing and renders no form;
  // the record simply displays in the read-only list, and the
  // manual panel stays shut.
  run(RESET + `
    db.aanaCE = [{ id: 'ce1', title: 'Airway course', date: '2026-05-01', credits: '6', note: '' }];
    editId = 'ce1';
    globalThis.__pageEdit = credentialsPage();
    editId = null;
  `);
  t('CE edit flow removed: a CE editId renders no form and does not open the section (v153)',
    !seg(sandbox.__pageEdit, 'credentials-ce-panel', 'cert-documents').includes('<form') &&
    !panelTag(sandbox.__pageEdit, 'credentials-ce-panel').includes(' open') &&
    seg(sandbox.__pageEdit, 'credentials-ce-panel', 'cert-documents').includes('Airway course'));
  t('CE edit: the manual panel does NOT force-open for a CE record anymore',
    !panelTag(sandbox.__pageEdit, 'credentials-manual-panel').includes(' open'));
  // A settled user (courses on file) sees the section resting as a
  // header with its one-line summary — still a visible section.
  run(RESET + `
    db.nbcrnaCE = [{ id: 'c1', title: 'Course', date: '2026-01-01', credits: '3', class: 'Class A' }];
    globalThis.__pageSettled = credentialsPage();
  `);
  t('CE section: with courses on file it rests collapsed under its summary header',
    !panelTag(sandbox.__pageSettled, 'credentials-ce-panel').includes(' open') &&
    sandbox.__pageSettled.includes('Continuing education · 1 course on file'));

  // ---------- Item 2: CE Broker card + request queue ----------
  run(RESET);
  const page2 = run(`credentialsPage()`);
  const cbSeg = seg(page2, 'credentials-cebroker-panel', 'credentials-ce-panel');
  t('CE Broker card renders in the connCard family (after State Licenses, before the CE section)',
    !!panelTag(page2, 'credentials-cebroker-panel') &&
    page2.indexOf('id="credentials-licenses-panel"') < page2.indexOf('id="credentials-cebroker-panel"') &&
    page2.indexOf('id="credentials-cebroker-panel"') < page2.indexOf('id="credentials-ce-panel"'));
  t('CE Broker card: Connect opens cebroker.com + read-it-now queues a read',
    cbSeg.includes('data-portal-connect="cebroker"') && cbSeg.includes('https://www.cebroker.com/') &&
    cbSeg.includes('data-action="portal-read-request" data-id="cebroker"') &&
    cbSeg.includes('Connect CE Broker — open portal'));
  t('CE Broker card: named as the WV board’s CE verification system',
    cbSeg.includes('West Virginia board'));
  t('CE Broker spec entries exist (check sources, agent spec, agent paths)',
    run(`PORTAL_CHECK_SOURCES.cebroker.url`) === 'https://www.cebroker.com/' &&
    run(`PORTAL_AGENT_SPEC.sources.cebroker.status`) === 'agent_read' &&
    run(`PORTAL_AGENT_PATHS.cebroker.site`) === 'cebroker.com' &&
    run(`portalAgentPath('cebroker').portal`) === 'CE Broker');
  t('no server pull: nothing fetches CE Broker from the app',
    !/fetch\([^)]*cebroker/i.test(appSrc) && run(`PORTAL_AGENT_SPEC.sources.cebroker.note`).includes('no server pull'));
  // Request stamping through the shared queue.
  run(`
    cloudSession = { user: { id: 'u1' }, email: 'crna@example.com' }; cloudActive = true;
    globalThis.__sb = [];
    sbReq = async (p, m, b) => { globalThis.__sb.push({ p, m, b }); return m === 'GET' ? [] : {}; };
    cloudPortals = [{ id: 'row-cb', portal: 'cebroker', state: null, status: 'not_connected', last_synced_at: null, session_state: 'unknown', read_requested_at: null, last_read_outcome: null }];
    globalThis.__stamp = portalRequestRead('cebroker');
    globalThis.__rowAfterReq = Object.assign({}, cloudPortals[0]);
  `);
  await tick();
  t('request: read-it-now stamps read_requested_at on the cebroker row (PATCH portal_connections)',
    !!sandbox.__stamp && sandbox.__rowAfterReq.read_requested_at === sandbox.__stamp &&
    sandbox.__sb.some(x => x.m === 'PATCH' && x.p.includes('portal_connections') && x.b && x.b.read_requested_at === sandbox.__stamp));
  run(`globalThis.__cardReq = credentialsPage();`);
  t('card: a queued CE Broker read says so on the card',
    seg(sandbox.__cardReq, 'credentials-cebroker-panel', 'credentials-ce-panel').includes('Read requested — we’ll read it from your signed-in session shortly'));
  // The portals upsert creates the cebroker row like the others.
  run(`
    globalThis.__posts = [];
    sbReq = async (p, m, b) => { if (m === 'POST' && p.includes('portal_connections')) globalThis.__posts.push(b); return m === 'GET' ? [] : {}; };
    cloudPortals = [];
  `);
  await run(`cloudUpsertPortals()`);
  const createdFlat = (sandbox.__posts[0] || []);
  t('upsert: a cebroker portal_connections row is created (portal cebroker, state null)',
    createdFlat.some(r => r.portal === 'cebroker' && r.state === null && r.status === 'not_connected'), J(createdFlat.map(r => r.portal)));

  // ---------- Item 2: monitoring — cadence only, no fake deadline ----------
  run(RESET + `ensurePortalMonitoring(); globalThis.__monCb = db.portalMonitoring.find(m => m.source === 'cebroker');`);
  t('monitoring: a CE Broker row exists, labelled CE Broker',
    !!sandbox.__monCb && sandbox.__monCb.label === 'CE Broker' && sandbox.__monCb.key === 'cebroker');
  t('monitoring: CE Broker has NO deadline and its cadence never escalates',
    run(`monitorDeadline(db.portalMonitoring.find(m => m.source === 'cebroker'))`) === '' &&
    run(`monitorCadence(db.portalMonitoring.find(m => m.source === 'cebroker'))`) === 7);
  t('monitoring: not verified before any read',
    run(`monitorDisplay(db.portalMonitoring.find(m => m.source === 'cebroker')).verified`) === false &&
    run(`portalVerifiedRetrievedAt('cebroker')`) === '');

  // ---------- Item 2: the filing door ----------
  run(`
    cloudSession = { user: { id: 'u1' }, email: 'crna@example.com' }; cloudActive = true;
    sbReq = async (p, m, b) => { return m === 'GET' ? [] : {}; };
    cloudPortals = [{ id: 'row-cb', portal: 'cebroker', state: null, status: 'connected', last_synced_at: null, session_state: 'live', read_requested_at: '2026-11-12T15:00:00.000Z', last_read_outcome: null }];
    db.licenses = [{ id: 'wv-aprn', state: 'WV', type: 'APRN-CRNA', number: '103459', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7' }];
    globalThis.__res = applyPortalAgentRead('cebroker', { outcome: 'read', readAt: '2026-11-12T16:00:00.000Z', courses: [
      { title: 'Pharmacology Update', date: '2026-03-01', credits: 4, category: 'pharmacotherapeutics', licState: 'West Virginia', licType: 'APRN-CRNA' },
      { title: 'Airway Management', date: '2026-04-15', credits: '6', category: 'General', licState: 'West Virginia', licType: 'APRN-CRNA' }
    ]});
    globalThis.__rowFiled = Object.assign({}, cloudPortals[0]);
  `);
  await tick();
  t('filing: a read with 2 courses files 2 CE records (default list aanaCE)',
    sandbox.__res.ok === true && run(`db.aanaCE.length`) === 2 && run(`db.nbcrnaCE.length`) === 0, J(sandbox.__res));
  t('filing: records carry the assignment fields + source cebroker',
    run(`db.aanaCE.every(r => r.source === 'cebroker' && r.licState === 'West Virginia' && r.licType === 'APRN-CRNA')`) === true &&
    run(`db.aanaCE[0].category`) === 'pharmacotherapeutics');
  t('filing: the connection row is stamped read (request cleared, session live, outcome read)',
    sandbox.__rowFiled.read_requested_at === null && sandbox.__rowFiled.session_state === 'live' &&
    sandbox.__rowFiled.last_read_outcome === 'read');
  // The v149 derivation rule: a verified read AT LEAST AS NEW as
  // the legacy entry wins. recordMonitorCheck stamped the entry
  // with this device's clock (later than the filed readAt), so —
  // exactly as the v149 pins seed it — age the legacy stamps and
  // let the read be the newest evidence.
  run(`
    const __mcb = db.portalMonitoring.find(m => m.source === 'cebroker');
    __mcb.lastAttempt = '2026-11-12T13:05:00.000Z'; __mcb.lastChecked = ''; __mcb.lastOutcome = 'blocked';
  `);
  t('filing: monitoring shows CE Broker Verified from the read (v149 derivation)',
    run(`monitorDisplay(db.portalMonitoring.find(m => m.source === 'cebroker')).verified`) === true &&
    run(`monitorDisplay(db.portalMonitoring.find(m => m.source === 'cebroker')).lastChecked`) === '2026-11-12T16:00:00.000Z' &&
    run(`monitorDisplay(db.portalMonitoring.find(m => m.source === 'cebroker')).outcomeText`) === 'Verified — read from your signed-in session' &&
    run(`portalVerifiedRetrievedAt('cebroker')`) === '2026-11-12T16:00:00.000Z');
  t('filing: the v150 progress picks the courses up via licState/licType',
    (() => { const p = run(`ceProgressFor(db.licenses[0], ceRequirementFor(db.licenses[0]))`);
      return p && p.total === 10 && p.subs.find(s => s.label === 'pharmacotherapeutics').have === 4; })(),
    J(run(`ceProgressFor(db.licenses[0], ceRequirementFor(db.licenses[0]))`)));
  t('filing: provenance survives via the settings sidecar (assignment + src)',
    run(`(db.settings.ceAssign || {})[db.aanaCE[0].id].src`) === 'cebroker' &&
    run(`db.settings.ceAssign[db.aanaCE[0].id].s`) === 'West Virginia');
  // Dedupe on re-file of the same transcript.
  run(`
    globalThis.__res2 = applyPortalAgentRead('cebroker', { outcome: 'read', readAt: '2026-11-19T16:00:00.000Z', courses: [
      { title: 'Pharmacology Update', date: '2026-03-01', credits: 4, category: 'pharmacotherapeutics', licState: 'West Virginia', licType: 'APRN-CRNA' },
      { title: 'Airway Management', date: '2026-04-15', credits: '6', category: 'General', licState: 'West Virginia', licType: 'APRN-CRNA' }
    ]});
  `);
  t('filing: re-filing the same transcript dedupes (no new records, summary says already on file)',
    sandbox.__res2.ok === true && run(`db.aanaCE.length`) === 2 &&
    sandbox.__res2.summary.includes('already on file') && sandbox.__res2.changed === false, J(sandbox.__res2));
  // A course that says otherwise files into nbcrnaCE.
  run(`
    globalThis.__res3 = applyPortalAgentRead('cebroker', { outcome: 'read', readAt: '2026-11-19T16:05:00.000Z', courses: [
      { title: 'CPC Core Module', date: '2026-05-01', credits: 2, kind: 'nbcrna', class: 'Class A' }
    ]});
  `);
  t('filing: a course marked nbcrna files into nbcrnaCE with its class',
    sandbox.__res3.ok === true && run(`db.nbcrnaCE.length`) === 1 &&
    run(`db.nbcrnaCE[0].class`) === 'Class A' && run(`db.nbcrnaCE[0].source`) === 'cebroker');
  // No courses = no read (v119 rule in transcript shape).
  run(`
    db.portalMonitoring.find(m => m.source === 'cebroker').lastChecked = '';
    globalThis.__res4 = applyPortalAgentRead('cebroker', { outcome: 'read', courses: [] });
  `);
  t('filing: a read with NO courses certifies nothing (failed, monitor not stamped verified by it)',
    sandbox.__res4.ok === false && sandbox.__res4.outcome === 'failed' &&
    run(`db.aanaCE.length`) === 2);
  // Needs-sign-in files the session state, files no courses.
  run(`
    cloudPortals = [{ id: 'row-cb', portal: 'cebroker', state: null, status: 'connected', last_synced_at: null, session_state: 'live', read_requested_at: '2026-11-12T15:00:00.000Z', last_read_outcome: null }];
    globalThis.__res5 = applyPortalAgentRead('cebroker', { outcome: 'needs-sign-in', reason: 'session expired' });
    globalThis.__rowNs = Object.assign({}, cloudPortals[0]);
  `);
  t('filing: needs-sign-in files session needs_signin + clears the request, files no courses',
    sandbox.__res5.ok === false && sandbox.__rowNs.session_state === 'needs_signin' &&
    sandbox.__rowNs.read_requested_at === null && run(`db.aanaCE.length`) === 2);
  run(`globalThis.__cardNs = credentialsPage();`);
  t('card: needs-sign-in session reads "Needs your sign-in" + "Sign in to refresh — CE Broker"',
    seg(sandbox.__cardNs, 'credentials-cebroker-panel', 'credentials-ce-panel').includes('Needs your sign-in') &&
    seg(sandbox.__cardNs, 'credentials-cebroker-panel', 'credentials-ce-panel').includes('Sign in to refresh — CE Broker'));
  // The guided check can never file a CE Broker transcript as a license.
  run(RESET + `
    globalThis.__guard = applyPortalCheckRecord('cebroker', { status: 'Active', expiry: '2027-01-01' }, '2026-11-12T00:00:00.000Z');
  `);
  t('guided check guard: a CE Broker save files NO license record',
    run(`db.licenses.length`) === 0 && String(sandbox.__guard).includes('CE Broker'));
  // Return greeting names CE Broker.
  run(RESET + `
    portalDepartureStamp('cebroker');
    portalReturnSurface();
    globalThis.__greet = portalReturnGreetingHTML();
  `);
  t('return greeting names CE Broker',
    sandbox.__greet.includes('Welcome back — tap to run your CE Broker read') &&
    sandbox.__greet.includes('data-action="portal-return-read" data-id="cebroker"'));

  // ---------- Item 3: AANA CE totals, big ----------
  run(RESET + `
    db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', classA: '103', classB: '2', reminders: '90,60,30,7', source: 'aana_portal' };
    db.nbcrna = { status: 'Certified', number: '126402', periodStart: '2023-05-01', periodEnd: '2027-04-30', checkStatus: 'Complete', reminders: '90,60,30,7', source: 'nbcrna_portal' };
    globalThis.__nbFacts = nbcrnaStripFacts(db.nbcrna);
    globalThis.__page3 = credentialsPage();
  `);
  const aanaSeg = seg(sandbox.__page3, 'credentials-aana-panel', 'credentials-monitoring-panel');
  t('AANA headline: the big CE line renders with the totals',
    aanaSeg.includes('<p class="cred-ce-headline">CE 105 · 103 Class A + 2 Class B</p>'));
  t('AANA headline: positioned at the top of the open card, above the Status paragraph',
    aanaSeg.indexOf('cred-ce-headline') > -1 &&
    aanaSeg.indexOf('cred-ce-headline') < aanaSeg.indexOf('<strong>Status:'));
  t('AANA headline: the style is a dedicated large/bold/dark class',
    css.includes('.cred-ce-headline{') && /font-size:(19|2\d)px/.test(css) && css.includes('font-weight:800'));
  t('AANA strip: the CE clause is gone — the fact appears exactly once on the page',
    !aanaSeg.includes('CE 105') || aanaSeg.indexOf('CE 105') === aanaSeg.indexOf('CE 105 · 103 Class A + 2 Class B'),
    aanaSeg.slice(0, 400));
  t('AANA strip: facts are Member + Dues through only (unit)',
    J(run(`aanaStripFacts(db.aana)`)) === J(['Member 126402', 'Dues through ' + run(`fmt('2027-08-31')`)]),
    J(run(`aanaStripFacts(db.aana)`)));
  t('AANA headline: the whole page mentions the CE totals exactly once',
    (sandbox.__page3.match(/CE 105/g) || []).length === 1);
  t('aanaCeText: clause built from the totals; empty when nothing on file',
    run(`aanaCeText(db.aana)`) === 'CE 105 · 103 Class A + 2 Class B' &&
    run(`aanaCeText({})`) === '' && run(`aanaCeHeadlineHTML({})`) === '');
  run(RESET + `
    db.aana = { status: 'Active', number: '126402', expiration: '2027-08-31', classA: '', classB: '', reminders: '90,60,30,7', source: 'user_entered' };
    globalThis.__page3b = credentialsPage();
  `);
  t('AANA headline: no CE totals on file → no big line (never a fake CE 0)',
    !sandbox.__page3b.includes('cred-ce-headline') && !sandbox.__page3b.includes('CE 0'));
  t('NBCRNA strip unchanged (its facts still render in the small strip)',
    seg(sandbox.__page3, 'credentials-nbcrna-panel', 'credentials-aana-panel').includes('ID 126402') &&
    sandbox.__nbFacts.includes('ID 126402'));

  // ---------- Item 4: license CE requirements, big ----------
  run(RESET + `
    db.licenses = [
      { id: 'oh-rn', state: 'Ohio', type: 'RN', number: '86131', status: 'Active', expiry: '2028-06-30', reminders: '90,60,30,7', source: 'state_board_portal' },
      { id: 'oh-aprn', state: 'Ohio', type: 'APRN-CRNA', number: 'APRN.CRNA.0021197', status: 'Active', expiry: '2027-10-31', reminders: '90,60,30,7', source: 'state_board_portal' },
      { id: 'wv-aprn', state: 'West Virginia', type: 'APRN-CRNA', number: '103459', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7', source: 'state_board_portal' },
      { id: 'mt-rn', state: 'Montana', type: 'RN', number: 'MT123', status: 'Active', expiry: '2027-10-01', reminders: '90,60,30,7' },
      { id: 'ak-rn', state: 'Alaska', type: 'RN', number: 'AK123', status: 'Active', expiry: '2027-06-30', reminders: '90,60,30,7' }
    ];
    globalThis.__ohRow = stateLicenseRowHTML('Ohio');
    globalThis.__wvRow = stateLicenseRowHTML('West Virginia');
    globalThis.__mtRow = stateLicenseRowHTML('Montana');
    globalThis.__akRow = stateLicenseRowHTML('Alaska');
  `);
  const F = (d) => run(`fmt('${d}')`);
  const headlinesOf = (html) => [...html.matchAll(/<p class="cred-ce-headline">([^<]*)<\/p>/g)].map(m => m[1]);
  const stripsOf = (html) => [...html.matchAll(/<p class="cred-strip">([^<]*)<\/p>/g)].map(m => m[1]);
  t('Ohio RN row: big CE line under its own strip line',
    headlinesOf(sandbox.__ohRow).includes('CE 24 hrs / 2 yrs · 1 Category A') &&
    sandbox.__ohRow.indexOf('CE 24 hrs / 2 yrs · 1 Category A') > sandbox.__ohRow.indexOf('86131'));
  t('Ohio APRN-CRNA row: big CE line with the 48 combined requirement',
    headlinesOf(sandbox.__ohRow).includes('CE 48 hrs / 2 yrs (24 RN + 24 APRN)') &&
    sandbox.__ohRow.indexOf('CE 48 hrs / 2 yrs (24 RN + 24 APRN)') > sandbox.__ohRow.indexOf('APRN.CRNA.0021197'));
  t('Ohio strips: number · status · expiry · reminders — the requirement clause is gone',
    stripsOf(sandbox.__ohRow).includes('86131 · Active · Expires ' + F('2028-06-30') + ' · Reminders at 90, 60, 30, 7 days') &&
    stripsOf(sandbox.__ohRow).includes('APRN.CRNA.0021197 · Active · Expires ' + F('2027-10-31') + ' · Reminders at 90, 60, 30, 7 days') &&
    stripsOf(sandbox.__ohRow).every(s => !/CE \d+ hrs/.test(s)), J(stripsOf(sandbox.__ohRow)));
  t('"CE not tracked yet" stays a small muted note under the big line, never inside it',
    sandbox.__ohRow.includes('<p class="muted">CE not tracked yet</p>') &&
    headlinesOf(sandbox.__ohRow).every(h => !h.includes('not tracked')));
  t('WV APRN-CRNA row: big CE line with both sub-requirements',
    headlinesOf(sandbox.__wvRow).includes('CE 24 hrs / 2 yrs · 12 pharmacotherapeutics · 12 clinical management') &&
    stripsOf(sandbox.__wvRow).every(s => !/CE \d+ hrs/.test(s)));
  t('no-CE state row (Montana RN): its line renders in the same big style',
    headlinesOf(sandbox.__mtRow).includes('No CE required for renewal'));
  t('conflict state row (Alaska RN): the check-with-your-board line renders big, no number asserted',
    headlinesOf(sandbox.__akRow).includes('CE rules unclear — check with your board'));
  t('license strip facts unit: no CE clause (number · status · expiry only)',
    J(run(`licenseStripFacts(db.licenses[0])`)) === J(['86131', 'Active', 'Expires ' + F('2028-06-30')]),
    J(run(`licenseStripFacts(db.licenses[0])`)));
  // Tracked progress rides the same big line.
  run(`
    db.aanaCE = [{ id: 't1', title: 'Category A course', date: '2027-01-15', credits: '1', category: 'Category A', licState: 'Ohio', licType: 'RN' }];
    globalThis.__ohRnHead = licenseCeHeadlineHTML(db.licenses[0]);
  `);
  t('tracked license: progress rides the big line (and the not-tracked note is gone)',
    sandbox.__ohRnHead === '<p class="cred-ce-headline">CE 24 hrs / 2 yrs · 1 Category A · CE on file: 1 of 24 hrs · Category A 1 of 1</p>',
    sandbox.__ohRnHead);
  t('headline units: no-CE and conflict lines exact',
    run(`licenseCeHeadlineHTML(db.licenses[3])`) === '<p class="cred-ce-headline">No CE required for renewal</p>' &&
    run(`licenseCeHeadlineHTML(db.licenses[4])`) === '<p class="cred-ce-headline">CE rules unclear — check with your board</p>');
  // The manual-entry license list is the same shared path.
  run(`manualType = 'State license'; globalThis.__pageLic = credentialsPage();`);
  t('manual-entry license list: the big CE line renders there too',
    seg(sandbox.__pageLic, 'credentials-manual-panel', null).includes('<p class="cred-ce-headline">CE 48 hrs / 2 yrs (24 RN + 24 APRN)</p>'));

  // ---------- v150 anchors still hold ----------
  t('v150 anchor: WV APRN-CRNA license CE line unchanged',
    run(`licenseCeText({ state: 'WV', type: 'APRN-CRNA', expiry: '2027-06-30' })`) ===
    'CE 24 hrs / 2 yrs · 12 pharmacotherapeutics · 12 clinical management · CE not tracked yet');

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
