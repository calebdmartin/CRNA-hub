// CRNA Hub — tests for the Dashboard "Credential & certification
// deadlines (90 days)" stat (Nov 7, 2026, branch muse/credentialing).
// Run: node test-deadline-stat-certs.js
//
// Caleb: "Let's change the credential deadline to include
// certification deadline." The Overview stat now counts BOTH
// credential deadlines (NBCRNA / AANA / state licenses / manual
// credentials) AND certification expirations (uploaded certification
// documents — ACLS/BLS/PALS/…) due within 90 days, as ONE deduped
// number: the same real-world deadline recorded twice (an ACLS
// document + a hand-entered "ACLS" credential) counts once.
// The stat uses the plain 90-day window its label promises;
// credentialDeadlines() (reminder list / assistant) keeps the
// per-record reminder-window rule, now deduped the same way.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store) {
  function el() {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, files: [],
      addEventListener() {}, append() {}, click() {}, remove() {},
      dataset: {}, style: {}, scrollIntoView() {},
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
      querySelectorAll: () => [], createElement: () => el(), body: { append() {} },
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  return { sandbox, run: (code) => vm.runInContext(code, sandbox) };
}

let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

(async () => {
  const store = new Map();
  const { run } = makeWorld(store);
  const today = run(`localDate(new Date())`);
  const d = (n) => run(`addDaysStr('${today}', ${n})`);

  // ---------- Fixture: credentials + certifications, mixed windows ----------
  run(`
    db.nbcrna = {...db.nbcrna, status:'Certified', periodEnd:'${d(60)}', renewalDeadline:'${d(60)}', reminders:'90,60,30,7'};
    db.aana = {...db.aana, expiration:'${d(120)}', reminders:'90,60,30,7'};
    db.licenses = [{id:'lic1', state:'West Virginia', type:'APRN', number:'103459', expiry:'${d(45)}', reminders:'30,7', source:'user_entered'}];
    db.documents = [
      {id:'doc1', certType:'ACLS', expiry:'${d(30)}', expirySource:'extracted', fileName:'ACLS.jpg'},
      {id:'doc2', certType:'BLS', expiry:'${d(100)}', expirySource:'extracted', fileName:'BLS.jpg'},
      {id:'doc3', certType:'PALS', expiry:'${d(-5)}', expirySource:'user-entered', fileName:'PALS.jpg'}
    ];
    db.credentials = [{id:'cred1', name:'ACLS', expiry:'${d(30)}'}];
    persist();
  `);

  // ---------- deadlinesWithin90: the stat's count ----------
  const within = run(`deadlinesWithin90()`);
  t('within-90 list has 4 deduped deadlines (NBCRNA, license, ACLS, PALS)',
    within.length === 4);
  t('ACLS appears exactly once despite document + manual credential records',
    within.filter(x => x.label.toLowerCase().startsWith('acls')).length === 1);
  t('certification document inside 90 days is counted (ACLS, +30)',
    within.some(x => x.label === 'ACLS certification' && x.days === 30));
  t('certification document beyond 90 days is NOT counted (BLS, +100)',
    !within.some(x => x.label.startsWith('BLS')));
  t('expired certification still counts, as expired credentials did (PALS, -5)',
    within.some(x => x.label === 'PALS certification' && x.days === -5));
  t('license inside 90 days counts even with narrow custom reminder windows (+45, reminders 30/7)',
    within.some(x => x.label.includes('West Virginia') && x.days === 45));
  t('AANA at +120 is outside the 90-day window',
    !within.some(x => x.label.startsWith('AANA')));

  // ---------- credentialDeadlines(): reminder-window list, same dedupe ----------
  const rem = run(`credentialDeadlines()`);
  t('reminder list dedupes ACLS to one entry', rem.filter(x => x.label.toLowerCase().startsWith('acls')).length === 1);
  t('reminder list keeps the per-record window rule (license at +45 with 30/7 windows stays out)',
    !rem.some(x => x.label.includes('West Virginia')));
  t('reminder list includes NBCRNA + ACLS + PALS (3)',
    rem.length === 3);

  // ---------- Dashboard stat: label + number + feature toggle ----------
  const dash = run(`dashboard()`);
  t('dashboard stat label reads "Credential & certification deadlines (90 days)"',
    dash.includes('Credential & certification deadlines (90 days)'));
  t('dashboard stat number is the deduped 90-day count (4)',
    dash.includes('<strong>4</strong>Credential & certification deadlines (90 days)'));
  t('old label is gone from the dashboard', !dash.includes('>Credential deadlines (90 days)<') && !dash.includes('</strong>Credential deadlines (90 days)'));
  run(`setFeature('featureCredentials', false)`);
  t('credentials feature off: stat card hides entirely',
    !run(`dashboard()`).includes('Credential & certification deadlines'));
  run(`setFeature('featureCredentials', true)`);
  t('credentials feature back on: stat returns',
    run(`dashboard()`).includes('Credential & certification deadlines (90 days)'));

  // ---------- Panel heading aligned (same concept, same label) ----------
  t('deadlines panel heading matches the stat concept',
    run(`credentialDeadlinesPanel()`).includes('<h2>Credential & certification deadlines</h2>'));

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
})();
