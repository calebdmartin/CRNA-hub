// CRNA Hub — v145 credential info strips (Caleb, Nov 12, 2026
// ~10:15 AM EST): "We have built in reminders for the credentials
// right? Might be beneficial to have the info right under the
// verified/certified header. For each credential."
//
// ONE component (credentialInfoStrip) renders a compact fact line
// directly under each credential card's header/status line, on all
// four surfaces, ending with the record's OWN reminder windows:
//   NBCRNA card      "ID <number> · Period <start> – <end>" (+ the
//                    CPC check-in status, first clause only)
//   AANA card        "Member <number> · Dues through <date>"
//                    (+ "CE <total> · <A> Class A + <B> Class B")
//   each license     "<number> · <status> · Expires <date>"
//   each cert doc    "Expires <date>" (+ "Issued <date>")
// Rules pinned: only facts present on the record — missing facts
// are omitted (no placeholders, no 'undefined', no doubled
// separators); a record with no facts at all gets no strip; the
// reminder line renders the record's actual windows (a record
// changed to 30,7 shows "30, 7"), never a hard-coded 90/60/30/7.
// Run: node test-v145-credential-strips.js
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
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra ? ' — ' + extra : ''));
  if (!cond) { failures++; process.exitCode = 1; }
};
const J = (v) => JSON.stringify(v);
const stripsOf = (html) => [...html.matchAll(/<p class="cred-strip">([^<]*)<\/p>/g)].map(m => m[1]);

(async () => {
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  const css = fs.readFileSync(R + 'styles.css', 'utf8');
  t('one component: credentialInfoStrip defined once, called from all four surfaces',
    (appSrc.match(/function credentialInfoStrip/g) || []).length === 1 &&
    (appSrc.match(/credentialInfoStrip\(/g) || []).length >= 5 &&
    appSrc.includes('nbcrnaStripFacts') && appSrc.includes('aanaStripFacts') &&
    appSrc.includes('licenseStripFacts') && appSrc.includes('docStripFacts'));
  t('strip style exists (small, muted, tight)', css.includes('.cred-strip{'));

  // ---- Caleb-shaped records (his real filed data) ----
  run(`db = empty(); db.settings.scheduleName = 'Caleb Martin';
    db.nbcrna = { status:'Certified', number:'126402', periodStart:'2023-05-01', periodEnd:'2027-04-30', renewalDeadline:'2027-04-30', checkStatus:'2-year check-in completed Nov 6, 2026 — modified MAC Check in progress; full MAC program starts May 1, 2027', classA:'', classB:'', macEd:'', macDev:'', macEdRequired:60, macDevRequired:40, docNote:'', ceNote:'', reminders:'90,60,30,7', source:'nbcrna_portal' };
    db.aana = { status:'Active', number:'126402', expiration:'2027-08-31', classA:103, classB:2, docNote:'', ceNote:'', reminders:'90,60,30,7', source:'aana_portal' };
    db.licenses = [
      { id:'l1', state:'West Virginia', type:'APRN', status:'Active', number:'103459', issue:'2013-07-02', expiry:'2027-06-30', portal:'', note:'', source:'state_board_portal', reminders:'90,60,30,7' },
      { id:'l2', state:'Ohio', type:'RN', expiry:'2028-06-30', source:'user_entered' }
    ];
    db.documents = [
      { id:'d1', certType:'ACLS', issue:'2026-02-01', expiry:'2028-01-31', expirySource:'extracted', fileName:'acls-card.jpg', storagePath:'u/d1-acls.jpg', storageStatus:'cloud', uploadedAt:'2026-02-01T00:00:00.000Z' },
      { id:'d2', certType:'BLS', issue:'', expiry:'2028-01-31', expirySource:'extracted', fileName:'bls.jpg', storagePath:'', storageStatus:'local_details_only', uploadedAt:'2026-02-01T00:00:00.000Z' }
    ];
    manualType = 'State license'; persist();`);
  const F = (d) => run(`fmt('${d}')`);
  let page = run(`credentialsPage()`);
  let strips = stripsOf(page);
  const nbcrnaStrip = 'ID 126402 · Period ' + F('2023-05-01') + ' – ' + F('2027-04-30') + ' · 2-year check-in completed Nov 6, 2026 · Reminders at 90, 60, 30, 7 days';
  const aanaStrip = 'Member 126402 · Dues through ' + F('2027-08-31') + ' · CE 105 · 103 Class A + 2 Class B · Reminders at 90, 60, 30, 7 days';
  t('NBCRNA strip: ID + period + short check-in + reminders', strips.includes(nbcrnaStrip), J(strips));
  t('NBCRNA strip: the long tail of the check-in text stays out', !page.includes('full MAC program starts May 1, 2027 · Reminders'));
  t('AANA strip: member + dues + CE totals + reminders', strips.includes(aanaStrip), J(strips));
  t('license strip: number · status · expires · reminders', strips.includes('103459 · Active · Expires ' + F('2027-06-30') + ' · Reminders at 90, 60, 30, 7 days'), J(strips));
  t('sparse license: missing number/status omitted, no placeholders', strips.includes('Expires ' + F('2028-06-30') + ' · Reminders at 90, 60, 30, 7 days'), J(strips));
  t('doc strip: expires + issued + reminders', strips.includes('Expires ' + F('2028-01-31') + ' · Issued ' + F('2026-02-01') + ' · Reminders at 90, 60, 30, 7 days'), J(strips));
  t('doc without an issue date: Issued omitted', strips.some(s => s === 'Expires ' + F('2028-01-31') + ' · Reminders at 90, 60, 30, 7 days'), J(strips));
  t('no strip carries junk (no undefined / NaN / doubled separators)', strips.every(s => !/undefined|NaN|·\s*·/.test(s)), J(strips));
  // Placement: the NBCRNA strip sits inside its card, after the
  // Status line and before the card description.
  const iPanel = page.indexOf('credentials-nbcrna-panel');
  const iStatus = page.indexOf('Status:', iPanel);
  const iStrip = page.indexOf(nbcrnaStrip);
  const iDesc = page.indexOf('National Board of Certification and Recertification for Nurse Anesthetists — your certification record.');
  t('NBCRNA strip placement: under the status line, above the description', iPanel > -1 && iStatus > iPanel && iStrip > iStatus && iDesc > iStrip);
  const iAanaStrip = page.indexOf(aanaStrip);
  const iAanaPanel = page.indexOf('credentials-aana-panel');
  t('AANA strip placement: inside the AANA card, after the NBCRNA card', iAanaStrip > iAanaPanel && iAanaPanel > iStrip);

  // ---- The reminder line follows the record, not a hard-code ----
  run(`db.nbcrna.reminders = '30,7'; persist();`);
  page = run(`credentialsPage()`);
  strips = stripsOf(page);
  t('changed windows: NBCRNA strip shows its own 30, 7', strips.some(s => s.startsWith('ID 126402') && s.endsWith('Reminders at 30, 7 days')), J(strips.filter(s => s.startsWith('ID'))));
  t('changed windows: AANA strip keeps its own 90, 60, 30, 7', strips.includes(aanaStrip));

  // ---- Sparse world: no facts → no strip at all ----
  run(`db = empty(); db.documents = [ { id:'d9', certType:'PALS', issue:'', expiry:'', expirySource:'none', fileName:'pals.jpg', storagePath:'', storageStatus:'local_details_only', uploadedAt:'' } ]; manualType = 'NBCRNA'; persist();`);
  page = run(`credentialsPage()`);
  t('empty records: no strip renders anywhere', stripsOf(page).length === 0, J(stripsOf(page)));

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
