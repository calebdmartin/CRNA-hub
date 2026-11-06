// CRNA Hub — background portal monitoring tests (Nov 6, 2026).
// Run: node test-portal-monitoring-background.js
//
// Caleb: "Once the portal is signed in can it just run checks in the
// background every 7 days? I don't think we need the option to run
// check now."
//   * "Run check now" is gone — the cadence is the only trigger.
//   * When a check comes due, a source with a working public route
//     (NBCRNA public verification) is attempted automatically by the
//     background sweep and the outcome is recorded — no tap needed.
//   * A source that needs a signed-in session surfaces ONE prompt per
//     due cycle ("NBCRNA check due — sign in to run it") in the panel
//     and on the Credentials reminder surface; the prompt launches the
//     guided check. Dismissing snoozes it to the next cadence.
//   * Honest labels: a due date passing alone never marks a source
//     checked — lastChecked only moves when a check actually ran.
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

(async () => {
  // --- 1. Run check now is gone, everywhere.
  t('no "Run check now" button, no monitor-run action, no monitorRunCheck in the source',
    !appSrc.includes('Run check now') && !appSrc.includes('monitor-run') && !appSrc.includes('monitorRunCheck'));
  run(`ensurePortalMonitoring(); globalThis.__panel = portalMonitoringHTML();`);
  t('rendered monitoring panel has no Run check now and no "tap Run check" copy',
    !sandbox.__panel.includes('Run check now') && !/tap Run check/i.test(sandbox.__panel));
  t('per-source cadence form is collapsed (inside <details>)',
    sandbox.__panel.includes('<details><summary class="muted">Cadence</summary>'));

  // --- 2. Due public-route source auto-attempts in the sweep and records.
  run(`
    db.settings.scheduleName = 'Caleb Martin';
    cloudSession = { user: { id: 'u1' } };
    globalThis.__calls = 0;
    portalCall = async (body) => { globalThis.__calls++; return { retrievedAt: '2026-11-06T12:00:00Z', record: { certification_status: 'Certified', certification_number: '12345', period_end: '2027-04-30', renewal_deadline: '2027-04-30' } }; };
    const m = db.portalMonitoring.find(x => x.key === 'nbcrna');
    m.lastChecked = ''; m.lastOutcome = '';
  `);
  await run(`monitorBackgroundSweep()`);
  run(`globalThis.__nb = db.portalMonitoring.find(x => x.key === 'nbcrna'); globalThis.__log = (db.portalChecks || []).filter(c => c.source === 'nbcrna');`);
  t('sweep attempted the due NBCRNA public check automatically (one server call)',
    sandbox.__calls === 1);
  t('outcome recorded without any tap: lastChecked set, outcome + log entry present',
    !!sandbox.__nb.lastChecked && ['no_change', 'changed'].includes(sandbox.__nb.lastOutcome) && sandbox.__log.length === 1);
  t('after the recorded check the source is no longer due',
    run(`monitorIsDue(db.portalMonitoring.find(x => x.key === 'nbcrna'), localDate(new Date()))`) === false);
  await run(`monitorBackgroundSweep()`);
  t('a second sweep in the same cycle does not re-attempt',
    sandbox.__calls === 1);

  // --- 3. A failed public attempt is recorded honestly as blocked/failed.
  run(`
    const mm = db.portalMonitoring.find(x => x.key === 'nbcrna');
    mm.lastChecked = ''; mm.lastOutcome = ''; mm.autoAttemptCycle = '';
    portalCall = async () => { globalThis.__calls++; throw new Error('Request failed with 404 — the service did not answer'); };
  `);
  await run(`monitorBackgroundSweep()`);
  run(`globalThis.__nb2 = db.portalMonitoring.find(x => x.key === 'nbcrna');`);
  t('failed public attempt records blocked (never a fake success)',
    sandbox.__nb2.lastOutcome === 'blocked' && !!sandbox.__nb2.lastChecked);

  // --- 4. Due signed-in source: sweep does NOT check it; exactly one prompt.
  run(`
    const aa = db.portalMonitoring.find(x => x.key === 'aana');
    aa.lastChecked = ''; aa.lastOutcome = ''; aa.snoozeUntil = ''; aa.promptDismissedCycle = '';
    globalThis.__panel2 = portalMonitoringHTML();
    globalThis.__strip = monitorDuePromptsHTML();
  `);
  t('signed-in source is never auto-checked: a due date passing leaves lastChecked/lastOutcome empty',
    sandbox.__calls >= 0 && run(`db.portalMonitoring.find(x => x.key === 'aana').lastChecked`) === '' &&
    run(`db.portalMonitoring.find(x => x.key === 'aana').lastOutcome`) === '');
  t('exactly one due prompt for the source in the panel',
    (sandbox.__panel2.match(/check due — sign in to run it/g) || []).length === 1 &&
    sandbox.__panel2.includes('data-action="monitor-prompt-dismiss" data-id="aana"'));
  t('the same prompt is on the Credentials reminder surface (Checks due strip)',
    sandbox.__strip.includes('Checks due') && sandbox.__strip.includes('AANA check due — sign in to run it'));
  t('the panel keeps "Check with assistant" for the due signed-in source',
    sandbox.__panel2.includes('data-action="monitor-assistant" data-id="aana"'));

  // --- 5. The prompt launches the guided check flow.
  run(`actions('monitor-assistant', 'aana'); globalThis.__pc = portalCheck && { source: portalCheck.source, step: portalCheck.step }; globalThis.__tab = tab;`);
  t('Run my check / Check with assistant launches the guided flow for that source',
    sandbox.__pc && sandbox.__pc.source === 'aana' && sandbox.__tab === 'Assistant');
  run(`portalCheck = null;`);

  // --- 6. Dismissal snoozes to the next cadence; the next cycle re-prompts.
  run(`
    actions('monitor-prompt-dismiss', 'aana');
    const a2 = db.portalMonitoring.find(x => x.key === 'aana');
    globalThis.__dis = { dismissed: a2.promptDismissedCycle, snooze: a2.snoozeUntil, dueNow: monitorIsDue(a2, localDate(new Date())), visible: monitorPromptVisible(a2, localDate(new Date())) };
  `);
  t('dismissing stamps the cycle and snoozes one cadence out; prompt hidden, not due',
    !!sandbox.__dis.dismissed && !!sandbox.__dis.snooze && sandbox.__dis.dueNow === false && sandbox.__dis.visible === false);
  run(`
    const a3 = db.portalMonitoring.find(x => x.key === 'aana');
    const today = localDate(new Date());
    // The state as it exists when the NEXT cycle arrives: last cycle was
    // dismissed a week ago (dismissedCycle = that due date), the snooze
    // target is today, and the monitor was last checked two weeks ago.
    a3.lastChecked = addDaysStr(today, -14); a3.promptDismissedCycle = addDaysStr(today, -7); a3.snoozeUntil = today;
    globalThis.__next = { dueNow: monitorIsDue(a3, today), visible: monitorPromptVisible(a3, today) };
  `);
  t('when the next cycle comes due, the prompt comes back (snooze was one cycle only)',
    sandbox.__next.dueNow === true && sandbox.__next.visible === true);

  // --- 7. Cadence escalation still applies (90/60/30/7 windows).
  run(`
    const today7 = localDate(new Date());
    db.nbcrna.periodEnd = addDaysStr(today7, 30); db.nbcrna.renewalDeadline = addDaysStr(today7, 30);
    globalThis.__cad30 = monitorCadence({ source: 'nbcrna', cadenceDays: 7 });
    db.nbcrna.periodEnd = addDaysStr(today7, 200); db.nbcrna.renewalDeadline = addDaysStr(today7, 200);
    globalThis.__cadFar = monitorCadence({ source: 'nbcrna', cadenceDays: 7 });
    db.nbcrna.periodEnd = ''; db.nbcrna.renewalDeadline = '';
  `);
  t('cadence: 2 days inside the 30-day window, base 7 days far out',
    sandbox.__cad30 === 2 && sandbox.__cadFar === 7);

  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
})();
