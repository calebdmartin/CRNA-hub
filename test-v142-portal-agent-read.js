// CRNA Hub — v142 portal monitoring as AGENT READS (Nov 12, 2026).
// Run: node test-v142-portal-agent-read.js
//
// Caleb's direction: "Do it the same way you do it for me now. From my
// understanding you are able to monitor those for me. So build the app
// the same way." The server-side portal pulls were dead ends (NBCRNA
// public verification submit 404s, AANA SSO bot-gated, WV/OH block
// datacenter automation). A check is now an AGENT READ: an AI agent in
// a real browser, in a session the USER signed in to themselves (the
// app never sees or stores portal passwords), navigates the portal's
// defined pages (PORTAL_AGENT_PATHS) and reports the record back
// through applyPortalAgentRead.
//
// Pins:
//   * the spec object (agent_read model, outcome enum, only-read
//     verifies, weekly cadence escalating inside 90 days, fallbacks);
//   * per-portal page paths as data (NBCRNA certification + CPC,
//     AANA membership + CE transcript, WV RN + APRN-CRNA, Ohio RN +
//     APRN.CRNA) and the state path picker;
//   * result handling per outcome — only 'read' saves + stamps
//     lastChecked; needs-sign-in / blocked / not-found record the
//     attempt + reason and NEVER stamp checked or touch the record;
//     an empty 'read' is a failure, not a verification (v119 rule);
//   * a read carries the v119 fixes through the shared save path:
//     status end-to-end, Ohio dotted numbers whole, NBCRNA CPC field;
//   * honest card labels ("Verified — read from your signed-in
//     session", "Needs your sign-in", "Couldn’t read");
//   * due-date math after a read (weekly far out, 3-day cadence when
//     renewal is inside 90 days);
//   * no string in the app claims a silent server pull.
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
const isoIn = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

// ---------- 1. Spec + page paths ----------
t('spec: agent-read model, outcome enum, only-read-verifies, no passwords',
  run(`PORTAL_AGENT_SPEC.model`) === 'agent_read' &&
  JSON.stringify(run(`PORTAL_AGENT_SPEC.outcomes`)) === JSON.stringify(['read', 'needs-sign-in', 'blocked', 'not-found']) &&
  run(`PORTAL_AGENT_SPEC.onlyReadVerifies`) === true &&
  run(`PORTAL_AGENT_SPEC.neverStoresPasswords`) === true &&
  run(`typeof PORTAL_NATIVE_SPEC`) === 'undefined');
t('spec: weekly cadence, escalating 3/2/1 inside 90/30/7, one prompt per cycle',
  run(`PORTAL_AGENT_SPEC.monitoring.baseCadenceDays`) === 7 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside90`) === 3 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside30`) === 2 &&
  run(`PORTAL_AGENT_SPEC.monitoring.escalation.inside7`) === 1);
t('paths: NBCRNA = certification + CPC check-in pages, with the fields the read returns',
  JSON.stringify(run(`PORTAL_AGENT_PATHS.nbcrna.pages.map(p => p.name)`)) === JSON.stringify(['Certification status', 'CPC check-in & MAC progress']) &&
  run(`PORTAL_AGENT_PATHS.nbcrna.pages[0].fields`).includes('periodEnd') &&
  run(`PORTAL_AGENT_PATHS.nbcrna.pages[1].fields`).includes('checkStatus') &&
  run(`PORTAL_AGENT_PATHS.nbcrna.pages[1].fields`).includes('macEd'));
t('paths: AANA = membership + CE transcript pages',
  JSON.stringify(run(`PORTAL_AGENT_PATHS.aana.pages.map(p => p.name)`)) === JSON.stringify(['Membership status', 'CE transcript']) &&
  run(`PORTAL_AGENT_PATHS.aana.pages[0].fields`).includes('expiration') &&
  run(`PORTAL_AGENT_PATHS.aana.pages[1].fields`).includes('classA'));
t('paths: WV = RN + APRN-CRNA records; Ohio = RN + APRN.CRNA records (stored type APRN)',
  run(`PORTAL_AGENT_PATHS.wv.pages.length`) === 2 && run(`PORTAL_AGENT_PATHS.wv.pages[1].licenseType`) === 'APRN' &&
  run(`PORTAL_AGENT_PATHS.ohio.pages.length`) === 2 && run(`PORTAL_AGENT_PATHS.ohio.pages[1].licenseType`) === 'APRN' &&
  run(`PORTAL_AGENT_PATHS.ohio.pages[1].name`).includes('APRN.CRNA'));
t('path picker: licenses resolve to the state path (Ohio dotted, else WV)',
  run(`portalAgentPath('licenses', 'Ohio') === PORTAL_AGENT_PATHS.ohio`) &&
  run(`portalAgentPath('licenses', 'West Virginia') === PORTAL_AGENT_PATHS.wv`) &&
  run(`portalAgentPath('nbcrna') === PORTAL_AGENT_PATHS.nbcrna`));

// ---------- 2. NBCRNA read: saves record, verifies, stamps monitor ----------
run(`
  db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,checkStatus:'',docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered',updatedAt:''};
  db.portalMonitoring = []; db.portalChecks = [];
  globalThis.__read1 = applyPortalAgentRead('nbcrna', { outcome: 'read', fields: { status: 'Certified', number: '126402', periodStart: '2023-05-01', periodEnd: '2027-04-30', renewalDeadline: '2027-04-30', checkStatus: 'Complete', classA: '103', classB: '2', macEd: '60', macDev: '40' } });
  globalThis.__nb = db.nbcrna;
  globalThis.__mon = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__label = portalSourceLabel(db.nbcrna.source, db.nbcrna.updatedAt);
`);
t('read: NBCRNA record saved with agent-read provenance (status, number, period)',
  sandbox.__nb.status === 'Certified' && sandbox.__nb.number === '126402' &&
  sandbox.__nb.periodEnd === '2027-04-30' && sandbox.__nb.source === 'nbcrna_portal');
t('read: CPC check-in status + MAC figures land on the record (v119 CPC field)',
  sandbox.__nb.checkStatus === 'Complete' && sandbox.__nb.macEd === '60' && sandbox.__nb.classA === '103');
t('read: monitor stamped checked with a read outcome; source label is the signed-in-session wording',
  !!sandbox.__mon.lastChecked && ['no_change', 'changed'].includes(sandbox.__mon.lastOutcome) &&
  sandbox.__read1.ok === true && sandbox.__label.includes('Verified — read from your NBCRNA sign-in'));

// A second read with a changed value records a change.
run(`
  globalThis.__read2 = applyPortalAgentRead('nbcrna', { outcome: 'read', fields: { status: 'Certified', periodEnd: '2028-04-30', renewalDeadline: '2028-04-30' } });
  globalThis.__mon2 = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__chg = (db.portalChecks || []).some(c => c.source === 'nbcrna' && c.status === 'changed');
`);
t('read with a changed date: outcome changed + a change entry is logged',
  sandbox.__read2.outcome === 'read' && sandbox.__read2.changed === true &&
  sandbox.__mon2.lastOutcome === 'changed' && sandbox.__chg === true);

// ---------- 3. Non-read outcomes: attempt recorded, record untouched ----------
run(`
  globalThis.__before = JSON.stringify(db.nbcrna);
  globalThis.__ns = applyPortalAgentRead('nbcrna', { outcome: 'needs-sign-in', reason: 'The portal asked for sign-in again.' });
  globalThis.__monNs = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__afterNs = JSON.stringify(db.nbcrna);
`);
t('needs-sign-in: recorded as an attempt with the reason; record untouched; lastChecked NOT moved',
  sandbox.__ns.ok === false && sandbox.__monNs.lastOutcome === 'needs_signin' &&
  !!sandbox.__monNs.lastAttempt && String(sandbox.__monNs.lastSummary || '').includes('sign-in') &&
  sandbox.__afterNs === sandbox.__before);
run(`
  db.portalMonitoring.find(m => m.key === 'nbcrna').lastChecked = '';
  globalThis.__bl = applyPortalAgentRead('nbcrna', { outcome: 'blocked', reason: 'The portal showed a captcha.' });
  globalThis.__monBl = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__rowsBl = portalMonitoringHTML();
`);
t('blocked: recorded blocked with the plain reason; lastChecked stays empty (never stamps checked)',
  sandbox.__bl.ok === false && sandbox.__monBl.lastOutcome === 'blocked' && !sandbox.__monBl.lastChecked &&
  monitorOutcomeLabelSafe() === 'Couldn’t read');
function monitorOutcomeLabelSafe() { return run(`monitorOutcomeLabel('blocked')`); }
t('blocked: the monitoring row shows the honest label + reason',
  sandbox.__rowsBl.includes('Couldn’t read') && sandbox.__rowsBl.includes('captcha'));
run(`
  globalThis.__nf = applyPortalAgentRead('nbcrna', { outcome: 'not-found' });
  globalThis.__monNf = db.portalMonitoring.find(m => m.key === 'nbcrna');
`);
t('not-found: recorded as its own outcome, still no lastChecked stamp',
  sandbox.__nf.ok === false && sandbox.__monNf.lastOutcome === 'not_found' && !sandbox.__monNf.lastChecked &&
  run(`monitorOutcomeLabel('not_found')`) === 'No record found' &&
  run(`monitorOutcomeLabel('needs_signin')`) === 'Needs your sign-in');
run(`
  globalThis.__empty = applyPortalAgentRead('nbcrna', { outcome: 'read', fields: {} });
  globalThis.__monE = db.portalMonitoring.find(m => m.key === 'nbcrna');
`);
t('empty read: a read that returned no data is a failure — nothing saved, not counted as checked',
  sandbox.__empty.ok === false && sandbox.__monE.lastOutcome === 'failed' && !sandbox.__monE.lastChecked);

// ---------- 4. AANA + license reads ----------
run(`
  db.aana = {status:'',number:'',expiration:'',source:'user_entered',docNote:'',ceNote:'',reminders:'90,60,30,7',updatedAt:''};
  globalThis.__aanaRead = applyPortalAgentRead('aana', { outcome: 'read', fields: { status: 'Active', number: '126402', expiration: '2027-12-31', classA: '103', classB: '2' } });
  globalThis.__aana = db.aana;
`);
t('AANA read: membership + CE totals saved with aana_portal provenance',
  sandbox.__aanaRead.ok === true && sandbox.__aana.status === 'Active' &&
  sandbox.__aana.expiration === '2027-12-31' && sandbox.__aana.source === 'aana_portal');
run(`
  db.licenses = [];
  globalThis.__ohRead = applyPortalAgentRead('licenses', { outcome: 'read', state: 'Ohio', type: 'APRN', fields: { status: 'Active', number: 'APRN.CRNA.0021197', issue: '2019-05-01', expiry: '2027-10-31' } });
  globalThis.__oh = db.licenses.find(x => x.state === 'Ohio');
  globalThis.__ohMon = db.portalMonitoring.find(m => m.key === 'licenses:Ohio:APRN');
`);
t('Ohio read: the dotted CRNA number is kept whole (v119), record + monitor stamped',
  sandbox.__ohRead.ok === true && sandbox.__oh.number === 'APRN.CRNA.0021197' &&
  sandbox.__oh.expiry === '2027-10-31' && sandbox.__oh.source === 'state_board_portal' &&
  !!sandbox.__ohMon.lastChecked);
run(`
  globalThis.__wvRead = applyPortalAgentRead('licenses', { outcome: 'read', state: 'West Virginia', type: 'RN', fields: { status: 'Active', number: '86131', expiry: '2028-06-30' } });
  globalThis.__wv = db.licenses.find(x => x.state === 'West Virginia');
`);
t('WV read: RN record saved alongside, source labelled as a portal read',
  sandbox.__wvRead.ok === true && sandbox.__wv.number === '86131' &&
  portalLabelWv().includes('state board portal'));
function portalLabelWv() { return run(`portalSourceLabel(db.licenses.find(x=>x.state==='West Virginia').source, '')`); }

// ---------- 5. Card state + due-date math after a read ----------
run(`
  cloudSession = { user: { id: 'u1' } }; cloudActive = true;
  cloudPortals = [{ portal: 'nbcrna', state: null, status: 'connected', last_synced_at: cloudNow() }];
  db.nbcrna.source = 'nbcrna_portal';
  globalThis.__card = cloudPortalState('nbcrna');
`);
t('card: a verified record reads "Verified — read from your signed-in session" (never a live portal pull)',
  sandbox.__card.label === 'Verified — read from your signed-in session' &&
  sandbox.__card.detail.includes('Read from the portal'));
const near = isoIn(45), far = isoIn(400);
run(`
  db.nbcrna.renewalDeadline = '${near}'; db.nbcrna.periodEnd = '${near}';
  db.portalMonitoring.find(m => m.key === 'nbcrna').lastChecked = '';
  applyPortalAgentRead('nbcrna', { outcome: 'read', fields: { status: 'Certified', periodEnd: '${near}', renewalDeadline: '${near}' } });
  globalThis.__monNear = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__dueNear = monitorNextDue(globalThis.__monNear, localDate(new Date()));
  globalThis.__dueTodayNear = monitorIsDue(globalThis.__monNear, localDate(new Date()));
  globalThis.__ov = deadlinesWithin90().some(x => x.date === '${near}');
`);
t('due math: renewal inside 90 days → next due is lastChecked + 3 days, not due today',
  sandbox.__dueTodayNear === false && sandbox.__dueNear === run(`addDaysStr(localDate(new Date()), 3)`));
t('overview: the read’s new renewal date shows in the 90-day deadlines',
  sandbox.__ov === true);
run(`
  db.nbcrna.renewalDeadline = '${far}'; db.nbcrna.periodEnd = '${far}';
  db.portalMonitoring.find(m => m.key === 'nbcrna').lastChecked = '';
  applyPortalAgentRead('nbcrna', { outcome: 'read', fields: { status: 'Certified', periodEnd: '${far}', renewalDeadline: '${far}' } });
  globalThis.__monFar = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__dueFar = monitorNextDue(globalThis.__monFar, localDate(new Date()));
`);
t('due math: renewal far out → weekly cadence, next due is lastChecked + 7 days',
  sandbox.__dueFar === run(`addDaysStr(localDate(new Date()), 7)`));

// ---------- 6. The retired pull is gone; no string claims a server pull ----------
t('the dead pull machinery is gone from the app source',
  !appSrc.includes('monitorAttemptPublic') && !appSrc.includes('PORTAL_NATIVE_SPEC') &&
  run(`typeof monitorAttemptPublic`) === 'undefined' && run(`typeof monitorPublicReady`) === 'undefined' &&
  !appSrc.includes('verify-nbcrna') && !appSrc.includes('portalCall('));
t('no rendered string claims a silent server pull',
  !appSrc.includes('Connected — live portal pull') && !appSrc.includes('Last pull') &&
  !appSrc.includes('No successful pull') && !appSrc.includes('publicChecks') &&
  appSrc.includes('never a silent server pull'));
run(`
  const aa = db.portalMonitoring.find(m => m.key === 'aana');
  aa.lastChecked = ''; aa.lastOutcome = ''; aa.snoozeUntil = ''; aa.promptDismissedCycle = '';
  globalThis.__panel = portalMonitoringHTML();
`);
t('monitoring panel: one due prompt per source, "Check with assistant" available for a due source',
  sandbox.__panel.includes('data-action="monitor-assistant"') &&
  sandbox.__panel.includes('every 7 days — faster near renewal') &&
  sandbox.__panel.includes('never store a portal password'));

console.log(failures === 0 ? '\nAll v142 portal agent-read tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures ? 1 : 0);
