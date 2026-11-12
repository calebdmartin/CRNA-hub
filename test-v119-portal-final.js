// CRNA Hub — v119 FINAL PORTAL CHECK harness (Nov 11, 2026).
// Run: node test-v119-portal-final.js
//
// Proves, with SYNTHETIC portal pages (no real login, no live portal),
// every step of the final portal-check process that can be proven
// offline:
//   * NBCRNA timeline + CPC/MAC progress extraction, incl. the CPC /
//     MAC Check status the flow promises (field existed only as a
//     cloud column before v119 — now parsed, previewed, saved, synced);
//   * AANA Member Dashboard extraction — "Dues paid through" reads as
//     the membership expiration; CE transcript totals;
//   * WV Board lookup results for BOTH licenses (RN + APRN);
//   * Ohio eLicense verification details with official field labels,
//     incl. dotted license numbers (RN.86131 / APRN.CRNA.0021197)
//     captured whole, and a CRNA-titled page mapping to the APRN record;
//   * license status survives the whole pipeline: parse -> preview
//     field -> approved save -> cloud row -> monitor snapshot (v118
//     collected it and silently dropped it at every one of those steps);
//   * a source counts as CHECKED only when a check returned data:
//     blocked/failed attempts stamp lastAttempt, never lastChecked;
//     an agent read with no record data changes nothing (v142: this
//     rule moved from the retired server pull to applyPortalAgentRead);
//     a preview reached by skipping every page saves as the user's own
//     entry and does not stamp the monitor;
//   * a blank AI read is reported as a blank read (not "wrong page");
//   * exact current page instructions per portal (NBCRNA timeline /
//     CPC-MAC progress, AANA dashboard path, WV Board lookup — Nursys
//     does not verify APRN licenses — and Ohio eLicense);
//   * an in-progress check (incl. the new fields) survives a restart.
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
class FakeFormData {
  constructor(form) { this._map = new Map((form && form._entries) || []); }
  get(k) { const v = this._map.get(k); return v === undefined ? null : v; }
  *[Symbol.iterator]() { yield* this._map; }
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
    querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.open = () => null;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const submit = async (text, extra) => {
  run(`globalThis.__form = { _entries: [['pasted', ${JSON.stringify(text)}], ...( ${JSON.stringify(extra || [])})], querySelector: () => null };`);
  await run(`submitPortalCheck({currentTarget: globalThis.__form})`);
};
const approve = (entries) => {
  run(`globalThis.__approveForm = { _entries: ${JSON.stringify(entries)} };`);
  run(`approvePortalCheck({currentTarget: globalThis.__approveForm})`);
};

// ---------- 1. Synthetic NBCRNA pages ----------
run(`globalThis.__nb1 = parsePortalCheckText('My Timeline. Certification status: Certified. Certification number: 126402. Certification Period: May 1, 2023 - April 30, 2027.', 'nbcrna');`);
t('NBCRNA timeline page: status, number, period range extracted',
  sandbox.__nb1.fields.status === 'Certified' && sandbox.__nb1.fields.number === '126402' &&
  sandbox.__nb1.fields.periodStart === '2023-05-01' && sandbox.__nb1.fields.periodEnd === '2027-04-30');
run(`globalThis.__nb2 = parsePortalCheckText('CPC / MAC Progress. CPC Check-In: Complete. Class A credits: 103. Class B credits: 2. MAC Ed credits: 60. MAC Dev credits: 40.', 'nbcrna');`);
t('NBCRNA progress page: CPC / MAC Check status + all credit totals extracted',
  sandbox.__nb2.fields.checkStatus === 'Complete' && sandbox.__nb2.fields.classA === '103' &&
  sandbox.__nb2.fields.classB === '2' && sandbox.__nb2.fields.macEd === '60' && sandbox.__nb2.fields.macDev === '40');
run(`globalThis.__nbAi = portalCheckFieldsFromAi({status:'Certified', check_status:'Complete', mac_ed:60}, '', 'nbcrna');`);
t('AI read merge carries check_status into the check fields',
  sandbox.__nbAi.fields.checkStatus === 'Complete' && sandbox.__nbAi.fields.macEd === '60');

// ---------- 2. Synthetic AANA pages ----------
run(`globalThis.__aa1 = parsePortalCheckText('My AANA Membership Information. Membership status: Active. Member number: 126402. Dues paid through: August 31, 2027.', 'aana');`);
t('AANA dashboard page: status + number + "Dues paid through" read as expiration',
  sandbox.__aa1.fields.status === 'Active' && sandbox.__aa1.fields.number === '126402' &&
  sandbox.__aa1.fields.expiration === '2027-08-31');
run(`globalThis.__aa2 = parsePortalCheckText('CE Transcript. Class A credits: 103. Class B credits: 2.', 'aana');`);
t('AANA CE transcript: Class A / B totals extracted',
  sandbox.__aa2.fields.classA === '103' && sandbox.__aa2.fields.classB === '2');

// ---------- 3. Synthetic WV Board lookup results ----------
run(`globalThis.__wvRn = parsePortalCheckText('West Virginia Board of Nursing — License Lookup. License status: Active. License type: RN. License number: 86131. Issued: July 2, 2013. License expiration date: June 30, 2028.', 'licenses');`);
t('WV RN lookup: status, type, number, issue, expiry extracted',
  sandbox.__wvRn.fields.status === 'Active' && sandbox.__wvRn.fields.type === 'RN' &&
  sandbox.__wvRn.fields.number === '86131' && sandbox.__wvRn.fields.issue === '2013-07-02' &&
  sandbox.__wvRn.fields.expiry === '2028-06-30');
run(`globalThis.__wvAprn = parsePortalCheckText('West Virginia Board of Nursing — License Lookup. License status: Active. License type: APRN. License number: 103459. Issued: July 2, 2013. License expiration date: June 30, 2027.', 'licenses');`);
t('WV APRN lookup: APRN record extracted (the one Nursys cannot verify)',
  sandbox.__wvAprn.fields.status === 'Active' && sandbox.__wvAprn.fields.type === 'APRN' &&
  sandbox.__wvAprn.fields.number === '103459' && sandbox.__wvAprn.fields.expiry === '2027-06-30');

// ---------- 4. Synthetic Ohio eLicense verification details ----------
run(`globalThis.__ohRn = parsePortalCheckText('Ohio eLicense — License Verification Details. Status: Active. License Type: Registered Nurse. License Number: RN.86131. License Issue Date: July 2, 2013. License Expiration Date: June 30, 2028.', 'licenses');`);
t('Ohio RN details: dotted number captured whole (RN.86131), status/issue/expiry extracted',
  sandbox.__ohRn.fields.status === 'Active' && sandbox.__ohRn.fields.type === 'RN' &&
  sandbox.__ohRn.fields.number === 'RN.86131' && sandbox.__ohRn.fields.issue === '2013-07-02' &&
  sandbox.__ohRn.fields.expiry === '2028-06-30');
run(`globalThis.__ohAprn = parsePortalCheckText('Ohio eLicense — License Verification Details. Status: Active. License Type: Certified Registered Nurse Anesthetist (CRNA). License Number: APRN.CRNA.0021197. License Issue Date: January 15, 2020. License Expiration Date: October 31, 2027.', 'licenses');`);
t('Ohio CRNA details: maps to the APRN record, dotted number captured whole',
  sandbox.__ohAprn.fields.type === 'APRN' && sandbox.__ohAprn.fields.number === 'APRN.CRNA.0021197' &&
  sandbox.__ohAprn.fields.expiry === '2027-10-31' && sandbox.__ohAprn.fields.status === 'Active');

// ---------- 5. Exact current instructions per portal ----------
t('NBCRNA instructions name the timeline + CPC / MAC progress pages',
  run(`portalNavMap('nbcrna').pages[0].direction`).includes('certification record on your timeline') &&
  run(`portalNavMap('nbcrna').pages[1].direction`).includes('MAC Check, MAC Ed and MAC Dev'));
t('AANA instructions name the dashboard path + Dues paid through',
  run(`portalNavMap('aana').pages[0].direction`).includes('My AANA Membership Information') &&
  run(`portalNavMap('aana').pages[0].direction`).includes('Dues paid through'));
t('license instructions name WV Board + Ohio eLicense; lookup links are the official routes',
  run(`portalNavMap('licenses').pages[0].direction`).includes('WV Board License Lookup') &&
  run(`portalNavMap('licenses').pages[0].direction`).includes('Ohio eLicense verification details') &&
  run(`PORTAL_LOOKUP_LINKS.licenses`).includes('https://wvrn.boardsofnursing.org/licenselookup') &&
  run(`PORTAL_LOOKUP_LINKS.licenses`).includes('https://elicense.ohio.gov/oh_verifylicense') &&
  run(`PORTAL_LOOKUP_LINKS.licenses`).includes('does not verify APRN licenses'));

// ---------- 6. Blank AI read is a blank read ----------
t('portalAiHasContent: empty payload + no raw text = no content; any field or raw text = content',
  run(`portalAiHasContent({}, '')`) === false &&
  run(`portalAiHasContent({status: null, number: null}, '')`) === false &&
  run(`portalAiHasContent({check_status: 'Complete'}, '')`) === true &&
  run(`portalAiHasContent(null, 'page text')`) === true);

// ---------- 7. Checked only when data returned ----------
run(`
  db.portalMonitoring = []; db.portalChecks = [];
  recordMonitorCheck('nbcrna', 'blocked', 'NBCRNA agent read could not run: the portal refused the read', 'agent_read');
  globalThis.__monB = db.portalMonitoring.find(m => m.key === 'nbcrna');
  globalThis.__dueAfterFail = monitorNextDue(globalThis.__monB, localDate(new Date()));
`);
t('blocked attempt: lastAttempt stamped, lastChecked NOT stamped, retry due next cadence (not today)',
  !!sandbox.__monB.lastAttempt && !sandbox.__monB.lastChecked &&
  sandbox.__monB.lastOutcome === 'blocked' && sandbox.__dueAfterFail > run(`localDate(new Date())`));
run(`
  recordMonitorCheck('nbcrna', 'no_change', 'NBCRNA agent read: no change', 'agent_read');
  globalThis.__monOk = db.portalMonitoring.find(m => m.key === 'nbcrna');
`);
t('a check that returned data stamps lastChecked',
  !!sandbox.__monOk.lastChecked && sandbox.__monOk.lastOutcome === 'no_change');

(async () => {
  // (v142: the old pin drove monitorAttemptPublic — the retired server
  // pull — with an empty response. The same v119 rule now lives in the
  // agent-read entry point: an agent 'read' whose fields carry NO
  // record data certifies nothing, saves nothing, and is not counted
  // as checked.)
  run(`
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',source:'user_entered'};
    db.portalMonitoring = []; db.portalChecks = [];
    globalThis.__emptyRead = applyPortalAgentRead('nbcrna', { outcome: 'read', fields: {} });
    globalThis.__pubAfter = { status: db.nbcrna.status, source: db.nbcrna.source, mon: db.portalMonitoring.find(m => m.key === 'nbcrna') };
  `);
  t('agent read with no record data: nothing certified, nothing saved, not counted as checked',
    sandbox.__emptyRead && sandbox.__emptyRead.ok === false &&
    sandbox.__pubAfter.status === '' && sandbox.__pubAfter.source === 'user_entered' &&
    !sandbox.__pubAfter.mon.lastChecked && sandbox.__pubAfter.mon.lastOutcome === 'failed');

  // ---------- 8. License status end-to-end ----------
  run(`db.licenses = []; db.portalChecks = []; db.portalMonitoring = []; startPortalCheck('licenses');`);
  await submit('West Virginia Board of Nursing — License Lookup. License status: Active. License type: APRN. License number: 103459. Issued: July 2, 2013. License expiration date: June 30, 2027.', [['state', 'West Virginia']]);
  run(`globalThis.__licPrev = { step: portalCheck && portalCheck.step, html: portalCheckHTML() };`);
  t('license check reaches preview and the preview carries an editable License status field',
    sandbox.__licPrev.step === 'preview' && sandbox.__licPrev.html.includes('name="status"') &&
    sandbox.__licPrev.html.includes('License status'));
  approve([['source', 'licenses'], ['state', 'West Virginia'], ['type', 'APRN'], ['status', 'Active'], ['number', '103459'], ['issue', '2013-07-02'], ['expiry', '2027-06-30']]);
  run(`globalThis.__licSaved = db.licenses[0]; globalThis.__licRow = cloudLicenseRow(db.licenses[0]); globalThis.__licMon = db.portalMonitoring.find(m => m.key === 'licenses:West Virginia:APRN');`);
  t('approved license save keeps the status (record + cloud row), with assistant provenance',
    sandbox.__licSaved.status === 'Active' && sandbox.__licRow.status === 'Active' &&
    sandbox.__licSaved.source === 'assistant_portal_check');
  t('a shown-and-read license check stamps its monitor as checked',
    !!sandbox.__licMon.lastChecked && ['no_change', 'changed'].includes(sandbox.__licMon.lastOutcome));

  // ---------- 9. NBCRNA check status end-to-end ----------
  run(`
    db.nbcrna = {status:'',number:'',periodStart:'',periodEnd:'',renewalDeadline:'',classA:'',classB:'',macEd:'',macDev:'',macEdRequired:60,macDevRequired:40,docNote:'',ceNote:'',reminders:'90,60,30,7',source:'user_entered'};
    startPortalCheck('nbcrna');
  `);
  await submit('My Timeline. Certification status: Certified. Certification number: 126402. Certification Period: May 1, 2023 - April 30, 2027.');
  await submit('CPC / MAC Progress. CPC Check-In: Complete. Class A credits: 103. Class B credits: 2. MAC Ed credits: 60. MAC Dev credits: 40.');
  run(`globalThis.__nbPrev = { step: portalCheck && portalCheck.step, html: portalCheckHTML(), snap: monitorSnapshot('nbcrna') };`);
  t('NBCRNA two-page walk reaches preview; preview carries the CPC / MAC Check status field',
    sandbox.__nbPrev.step === 'preview' && sandbox.__nbPrev.html.includes('name="checkStatus"') &&
    sandbox.__nbPrev.html.includes('CPC / MAC Check status'));
  approve([['source', 'nbcrna'], ['status', 'Certified'], ['number', '126402'], ['periodStart', '2023-05-01'], ['periodEnd', '2027-04-30'], ['renewalDeadline', '2027-04-30'], ['checkStatus', 'Complete'], ['classA', '103'], ['classB', '2'], ['macEd', '60'], ['macDev', '40']]);
  run(`globalThis.__nbSaved = { checkStatus: db.nbcrna.checkStatus, row: cloudNbcrnaRow().cpc_check_in_status, snap: monitorSnapshot('nbcrna') };`);
  t('approved NBCRNA save keeps check status (record + cloud row) and the monitor snapshot watches it',
    sandbox.__nbSaved.checkStatus === 'Complete' && sandbox.__nbSaved.row === 'Complete' &&
    sandbox.__nbSaved.snap !== sandbox.__nbPrev.snap && sandbox.__nbSaved.snap.includes('Complete'));

  // ---------- 10. Skipped-every-page preview: saves as own entry, not a check ----------
  run(`
    db.licenses = []; db.portalChecks = []; db.portalMonitoring = [];
    startPortalCheck('licenses');
    actions('portal-guide-skip');
    globalThis.__skipStep = portalCheck && portalCheck.step;
    globalThis.__checksBefore = (db.portalChecks || []).length;
  `);
  approve([['source', 'licenses'], ['state', 'Ohio'], ['type', 'RN'], ['status', 'Active'], ['number', 'RN.86131'], ['expiry', '2028-06-30']]);
  run(`globalThis.__skipSaved = { rec: db.licenses[0], mon: db.portalMonitoring.find(m => m.key === 'licenses:Ohio:RN'), checks: (db.portalChecks || []).length };`);
  t('skip-every-page preview still saves the typed record — as the user\'s own entry',
    sandbox.__skipStep === 'preview' && sandbox.__skipSaved.rec && sandbox.__skipSaved.rec.source === 'user_entered');
  t('…and does NOT stamp the monitor as checked or log a check',
    !!sandbox.__skipSaved.mon && !sandbox.__skipSaved.mon.lastChecked &&
    sandbox.__skipSaved.checks === sandbox.__checksBefore);

  // ---------- 11. Restart mid-check keeps the new fields ----------
  run(`db.licenses = []; startPortalCheck('licenses');`);
  await submit('Ohio eLicense — License Verification Details. Status: Active. License Type: Certified Registered Nurse Anesthetist (CRNA). License Number: APRN.CRNA.0021197. License Expiration Date: October 31, 2027.', [['state', 'Ohio']]);
  run(`
    globalThis.__preRestart = { step: portalCheck.step, status: portalCheck.fields.status, number: portalCheck.fields.number };
    portalCheck = null;
    portalCheckRestore();
    globalThis.__postRestart = portalCheck ? { step: portalCheck.step, status: portalCheck.fields.status, number: portalCheck.fields.number, type: portalCheck.fields.type } : null;
  `);
  t('restart mid-check (at preview) restores step + license status + dotted number intact',
    sandbox.__preRestart.step === 'preview' && !!sandbox.__postRestart &&
    sandbox.__postRestart.step === 'preview' && sandbox.__postRestart.status === 'Active' &&
    sandbox.__postRestart.number === 'APRN.CRNA.0021197' && sandbox.__postRestart.type === 'APRN');

  // ---------- 12. Server normalizer carries check_status ----------
  const normSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/normalize.ts', 'utf8');
  const promptSrc = fs.readFileSync(R + 'supabase/functions/extract-contract/index.ts', 'utf8');
  t('server: normalizeAiPortalCheck returns check_status and the portal prompt asks for it',
    normSrc.includes('check_status') && promptSrc.includes('check_status'));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
})();
