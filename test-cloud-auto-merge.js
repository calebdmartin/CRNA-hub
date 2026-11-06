// CRNA Hub — automatic cloud merge (Nov 6, 2026, Caleb): the Account
// tab no longer asks the user to pick a sync direction. On sign-in the
// cloud and on-device credential records merge automatically:
//   * union — a record on only one side is kept, never deleted;
//   * a shared record with different content resolves to the NEWEST
//     edit (local updatedAt vs the cloud row's last_synced_at);
//   * a shared record whose versions cannot be ordered keeps BOTH;
//   * singletons (NBCRNA / AANA) merge field by field;
//   * the "choose how to sync" panel, its direction buttons, the
//     "Decide later" button and the record-count readouts are gone;
//     the signed-in panel keeps "Signed in as" + Sign out.
// Run: node test-cloud-auto-merge.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = fs.existsSync(path.join(__dirname, 'repo', 'app.js'))
  ? path.join(__dirname, 'repo') + path.sep
  : __dirname + path.sep;
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
  alert: () => {}, confirm: () => true,
  fetch: async () => { throw new Error('network-stub'); },
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
sandbox.liveSyncSchedulePush = undefined;
const run = (code) => vm.runInContext(code, sandbox);
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

t('Supabase is configured in this checkout (precondition)', run(`SUPABASE_CONFIGURED`) === true);

// ---------- 1. The direction choice is gone from UI and source ----------
t('no choose-how-to-sync panel or direction actions in the app source',
  !appSrc.includes('choose how to sync') &&
  !appSrc.includes('cloudPending') &&
  !appSrc.includes('data-action="cloud-upload"') &&
  !appSrc.includes('data-action="cloud-load"') &&
  !appSrc.includes('data-action="cloud-sync"') &&
  !appSrc.includes('cloud-keep-local') &&
  !appSrc.includes('Decide later'));
run(`
  cloudSession = { access_token: 'tok', refresh_token: 'ref', expires_at: Math.floor(Date.now()/1000) + 3600, email: 'crna@example.com', user_id: 'u1' };
  cloudActive = true;
`);
const acct = run(`accountPage()`);
t('signed-in Account panel: signed-in-as line + Sign out kept',
  acct.includes('Signed in as crna@example.com') && acct.includes('data-action="cloud-signout"'));
t('signed-in Account panel: no count readouts, no direction buttons',
  !acct.includes('NBCRNA: ') && !acct.includes('Cloud records:') && !acct.includes('On-device records:') &&
  !acct.includes('Upload my on-device') && !acct.includes('Load cloud records'));

// ---------- 2. Merge: union, newest-wins, keep-both ----------
const licRow = (id, number, notes, synced) => ({
  id, user_id: 'u1', state: 'WV', license_type: 'APRN', license_number: number,
  issue_date: '', expiration_date: '2027-06-30', status: null, board_portal_url: '',
  notes, source: 'user_entered', last_synced_at: synced,
});
run(`
  db.licenses = [
    { id: 'lic-device', state: 'OH', type: 'RN', number: 'OH-1', issue: '', expiry: '2028-06-30', portal: '', note: 'device only', source: 'user_entered', reminders: '90,60,30,7' },
    { id: 'lic-conflict', state: 'WV', type: 'APRN', number: 'WV-OLD', issue: '', expiry: '2027-06-30', portal: '', note: 'old edit', source: 'user_entered', reminders: '90,60,30,7', updatedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'lic-localnewer', state: 'WV', type: 'RN', number: 'WV-NEW', issue: '', expiry: '2028-06-30', portal: '', note: 'local newer', source: 'user_entered', reminders: '90,60,30,7', updatedAt: '2026-11-05T00:00:00.000Z' },
    { id: 'lic-both', state: 'WV', type: 'APRN', number: 'WV-BOTH', issue: '', expiry: '2027-06-30', portal: '', note: 'device version', source: 'user_entered', reminders: '90,60,30,7' },
  ];
  db.nbcrnaCE = [{ id: 'ce-device', title: 'Device CE', date: '2026-10-01', credits: '5', class: 'Class A' }];
  db.aanaCE = [];
  db.documents = [];
  globalThis.__cloudData = {
    nbcrna: null, aana: null, portals: [], documents: [],
    licenses: [
      ${JSON.stringify(licRow('lic-cloud', 'WV-9', 'cloud only', '2026-11-03T00:00:00.000Z'))},
      ${JSON.stringify(licRow('lic-conflict', 'WV-NEWER', 'newer edit', '2026-11-04T00:00:00.000Z'))},
      ${JSON.stringify(licRow('lic-localnewer', 'WV-OLD', 'cloud older', '2026-11-02T00:00:00.000Z'))},
      ${JSON.stringify(licRow('lic-both', 'WV-BOTH', 'cloud version', ''))},
    ],
    ce: [
      { id: 'ce-cloud', user_id: 'u1', source: 'nbcrna', title: 'Cloud CE', credits: 3, credit_class: 'Class A', completed_date: '2026-09-15', last_synced_at: '2026-11-03T00:00:00.000Z' },
    ],
  };
  cloudApplyData(globalThis.__cloudData);
  globalThis.__licIds = db.licenses.map(x => x.id);
  globalThis.__byNote = {};
  db.licenses.forEach(x => { globalThis.__byNote[x.note] = x; });
`);
t('device-only record survives the merge',
  sandbox.__licIds.includes('lic-device'));
t('cloud-only record arrives',
  sandbox.__licIds.includes('lic-cloud') && sandbox.__byNote['cloud only'].number === 'WV-9');
t('conflict resolves to the newest edit (cloud newer wins)',
  sandbox.__byNote['newer edit'] && sandbox.__byNote['newer edit'].number === 'WV-NEWER' &&
  !sandbox.__byNote['old edit']);
t('conflict resolves to the newest edit (local newer wins)',
  sandbox.__byNote['local newer'] && sandbox.__byNote['local newer'].number === 'WV-NEW' &&
  !sandbox.__byNote['cloud older']);
t('un-orderable conflict keeps BOTH versions (nothing overwritten)',
  !!sandbox.__byNote['device version'] && !!sandbox.__byNote['cloud version'] &&
  sandbox.__byNote['device version'].id !== sandbox.__byNote['cloud version'].id);
t('CE records merge as a union too',
  run(`db.nbcrnaCE.length`) === 2 &&
  run(`db.nbcrnaCE.some(x => x.id === 'ce-device')`) &&
  run(`db.nbcrnaCE.some(x => x.id === 'ce-cloud')`));
t('merge marks the account active (background sync takes over)',
  run(`cloudActive`) === true && run(`cloudSyncEnabled()`) === true);

// ---------- 3. Singletons merge field by field ----------
run(`
  db.nbcrna = { status: 'Certified', number: '', periodStart: '', periodEnd: '', renewalDeadline: '', classA: '', classB: '', macEd: '', macDev: '', macEdRequired: 60, macDevRequired: 40, docNote: '', ceNote: '', reminders: '90,60,30,7', source: 'user_entered' };
  db.aana = { status: '', number: '', expiration: '', docNote: '', ceNote: '', reminders: '90,60,30,7', source: 'user_entered' };
  cloudApplyData({
    nbcrna: { user_id: 'u1', certification_status: '', certification_number: '126402', period_start: '2023-05-01', period_end: '2027-04-30', renewal_deadline: '2027-04-30', class_a_credits: 103, class_b_credits: 2, mac_ed_credits: null, mac_dev_credits: null, mac_ed_required: 60, mac_dev_required: 40, source: 'portal_pull', last_synced_at: '2026-11-03T00:00:00.000Z' },
    aana: { user_id: 'u1', membership_status: 'Active', membership_number: '126402', expiration: '2027-12-31', source: 'portal_pull', last_synced_at: '2026-11-03T00:00:00.000Z' },
    licenses: [], ce: [], portals: [], documents: [],
  });
`);
t('singleton field merge: local-only value and cloud-only value both survive',
  run(`db.nbcrna.status`) === 'Certified' && run(`db.nbcrna.number`) === '126402' &&
  run(`db.nbcrna.periodEnd`) === '2027-04-30');
t('cloud-only singleton arrives whole',
  run(`db.aana.status`) === 'Active' && run(`db.aana.number`) === '126402');
t('licenses from the previous merge are untouched by an empty cloud list',
  run(`db.licenses.length`) >= 5);

// ---------- 4. Sign-in runs the merge automatically (stubbed network) ----------
run(`
  db.licenses = [{ id: 'lic-device2', state: 'OH', type: 'RN', number: 'OH-2', issue: '', expiry: '2028-06-30', portal: '', note: 'second device record', source: 'user_entered', reminders: '90,60,30,7' }];
  cloudActive = false;
`);
sandbox.fetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  const p = body.path || '';
  let rows = [];
  if (p.startsWith('/rest/v1/licenses')) rows = [licRow('lic-cloud2', 'WV-22', 'from second sign-in', '2026-11-03T00:00:00.000Z')];
  return { status: 200, ok: true, text: async () => JSON.stringify(rows) };
};
run(`globalThis.__mergeDone = cloudAfterSignIn()`);
(async () => {
  await sandbox.__mergeDone;
  t('sign-in auto-merge: device record kept AND cloud record arrived, no choice asked',
    run(`db.licenses.some(x => x.id === 'lic-device2')`) &&
    run(`db.licenses.some(x => x.id === 'lic-cloud2')`) &&
    run(`cloudActive`) === true);
  const acct2 = run(`accountPage()`);
  t('after sign-in the Account tab shows the slim signed-in panel',
    acct2.includes('Signed in as crna@example.com') && !acct2.includes('choose how to sync'));
  t('service worker cache bumped to v51', swSrc.includes('crna-hub-shell-v51'));
})();
