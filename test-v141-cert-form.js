'use strict';
// v141 (Nov 12, 2026) — the certification-document upload form cleanup
// (Caleb, with screenshot: "The uploads on this screen are working
// perfectly. Let's just make this screen look better.").
//
// The add form is picture-first now: Certification type (+ Other name,
// only when Other is picked) -> choose file -> Add. The manual Issue /
// Expiration date fields are GONE from the add form. They survive only
// as the correction layer:
//   - editing a saved document (Replace / edit) shows them prefilled;
//   - if an upload's dates can't be read, the upload is held and the
//     form re-renders with the fields revealed ("We couldn't read the
//     dates on that one — add them here."), and the save completes
//     with the hand-typed dates.
// The dev-scaffolding storage paragraph (Supabase Storage folder /
// migration 002 / README) is off the screen, replaced by Caleb's one
// description line. The panel's collapse behavior is unchanged, except
// the fallback state holds the panel open like other problem states.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el(id) {
  return {
    id: id || '', innerHTML: '', textContent: '', value: '', checked: false, files: [],
    dataset: {}, style: {}, _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const getEl = (id) => elements[id] || (elements[id] = el(id));
class FakeFormData {
  constructor(form) { this._map = (form && form._map) || {}; this._e = (form && form._entries) || []; }
  get(k) { return k in this._map ? this._map[k] : null; }
  *[Symbol.iterator]() { yield* Object.entries(this._map); yield* this._e; }
}
const alerts = [];
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
    getElementById: (id) => getEl(id),
    querySelectorAll: () => [],
    createElement: () => el(), body: { append() {} },
  },
  window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
  alert: (m) => { alerts.push(String(m)); },
  confirm: () => true,
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
const run = (code) => vm.runInContext(code, sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};
const DESC = 'Upload a picture of your certification card and we’ll save the issue date and expiration date and create a reminder for renewal.';
const FB_LINE = 'We couldn’t read the dates on that one — add them here.';
const RESET = `
  db = empty();
  editId = null; manualType = 'NBCRNA'; onboardStep = 0; tab = 'Credentials';
  portalCheck = null; portalCheckError = ''; portalCheckOcrStatus = '';
  portalOpened = {}; portalLeaveSheet = '';
  docOcrStatus = ''; docStorageError = ''; docDateFallback = null;
  cloudSession = null; cloudPortals = [];
`;
const panelSlice = (html) => {
  const a = html.indexOf('id="cert-documents"');
  const b = html.indexOf('id="credentials-manual-panel"');
  return a >= 0 ? html.slice(a, b > a ? b : undefined) : '';
};
const panelTag = (html) => {
  const m = html.match(/<details class="panel collapse-panel" id="cert-documents"( open)?>/);
  return m ? m[0] : '';
};
const fakeForm = (map, files) => ({
  _map: map,
  querySelector: () => ({ files: files || [] }),
});
const txtFile = (name, text) => ({ name, type: 'text/plain', text: async () => text });

(async () => {
  // ============ Fresh add form: picture-first, no date fields =========
  run(RESET + `globalThis.__page = credentialsPage();`);
  const fresh = panelSlice(sandbox.__page);
  t('add form renders with NO manual date fields (no issue/expiry inputs)',
    fresh.includes('Certification type') && fresh.includes('Certification document file') &&
    !fresh.includes('name="issue"') && !fresh.includes('name="expiry"'));
  t("Caleb's description line sits at the top of the form",
    fresh.includes(DESC));
  t('dev scaffolding is gone from the panel (no storage folder / migration / README / old read line)',
    !fresh.includes('Supabase Storage folder') && !fresh.includes('migration 002') &&
    !fresh.includes('README') && !fresh.includes('fix it if we misread') &&
    !fresh.includes('docStorageStatus'));
  t('Other name field is present but hidden until Other is chosen',
    fresh.includes('id="docOtherWrap" hidden') && fresh.includes('Other certification (if Other)'));
  t('no fallback line on a fresh form', !fresh.includes(FB_LINE));

  // ============ Other chosen (edit of an Other-type doc) ===============
  run(RESET + `
    db.documents = [{ id: 'd9', certType: 'TN Cert', issue: '2025-03-01', expiry: '2027-03-31', expirySource: 'user-entered', fileName: 'tn.pdf', storagePath: '', storageStatus: 'local_details_only' }];
    editId = 'd9';
    globalThis.__page = credentialsPage();
  `);
  const otherEdit = panelSlice(sandbox.__page);
  t('an Other-type document renders the Other name field revealed with its name',
    otherEdit.includes('id="docOtherWrap">') && otherEdit.includes('value="TN Cert"'));
  t('Replace / edit keeps the date fields as the correction layer, prefilled',
    otherEdit.includes('name="issue"') && otherEdit.includes('value="2025-03-01"') &&
    otherEdit.includes('name="expiry"') && otherEdit.includes('value="2027-03-31"') &&
    otherEdit.includes('Save certification document'));

  // ============ Good read: saves with extracted dates, no fields =======
  run(RESET);
  alerts.length = 0;
  run(`globalThis.__submitDoc = (ev) => submitDocument(ev);`);
  await sandbox.__submitDoc({ currentTarget: fakeForm({ type: 'ACLS', otherType: '' },
    [txtFile('acls-card.txt', 'Advanced Cardiovascular Life Support Provider Card. Expires January 31, 2028.')]) });
  const afterGood = run(`({ n: db.documents.length, d: db.documents[0] || null, fb: docDateFallback })`);
  t('good read saves immediately with the extracted expiration, source extracted',
    afterGood.n === 1 && afterGood.d.expiry === '2028-01-31' && afterGood.d.expirySource === 'extracted' &&
    afterGood.d.certType === 'ACLS' && afterGood.d.fileName === 'acls-card.txt');
  t('good read never enters the fallback state', afterGood.fb === null);
  run(`globalThis.__page = credentialsPage();`);
  t('after a good read the form is picture-first again (no date fields)',
    !panelSlice(sandbox.__page).includes('name="issue"'));

  // ============ No-dates read: fallback reveal, then save completes ====
  run(RESET);
  await sandbox.__submitDoc({ currentTarget: fakeForm({ type: 'BLS', otherType: '' },
    [txtFile('bls-card.txt', 'BLS Provider Card — American Heart Association. This card remains the property of the issuer.')]) });
  const held = run(`({ n: db.documents.length, fb: docDateFallback })`);
  t('a no-dates read does NOT save half-done — the upload is held for manual dates',
    held.n === 0 && !!held.fb && held.fb.fileName === 'bls-card.txt' && held.fb.certType === 'BLS');
  run(`globalThis.__page = credentialsPage();`);
  const fbPage = sandbox.__page;
  const fbSlice = panelSlice(fbPage);
  t('fallback reveals the manual date fields with Caleb\u2019s one line',
    fbSlice.includes(FB_LINE) && fbSlice.includes('name="issue"') && fbSlice.includes('name="expiry"'));
  t('fallback holds the panel open (problem state never rests closed)',
    panelTag(fbPage).includes(' open'));
  await sandbox.__submitDoc({ currentTarget: fakeForm(
    { type: 'BLS', otherType: '', issue: '2026-01-15', expiry: '2028-01-31' }, []) });
  const done = run(`({ n: db.documents.length, d: db.documents[0] || null, fb: docDateFallback })`);
  t('the save completes with the hand-typed dates on the held upload',
    done.n === 1 && done.d.issue === '2026-01-15' && done.d.expiry === '2028-01-31' &&
    done.d.expirySource === 'user-entered' && done.d.fileName === 'bls-card.txt' && done.fb === null);

  // ============ Fallback state alone opens a settled panel =============
  run(RESET + `
    db.documents = [{ id: 'd1', certType: 'ACLS', issue: '2026-01-01', expiry: '2028-06-30', expirySource: 'extracted', fileName: 'a.txt', storagePath: '', storageStatus: 'local_details_only' }];
    globalThis.__settled = credentialsPage();
    docDateFallback = { recId: 'x1', certType: 'PALS', fileName: 'p.txt', storagePath: '', storageStatus: 'local_details_only' };
    globalThis.__fb = credentialsPage();
    docDateFallback = null;
  `);
  t('settled panel rests closed; the fallback state opens it',
    !panelTag(sandbox.__settled).includes(' open') && panelTag(sandbox.__fb).includes(' open'));

  // ============ Source guards ==========================================
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  t('source: the scaffolding strings are out of app.js entirely',
    !appSrc.includes('migration 002') && !appSrc.includes('Supabase Storage folder') &&
    !appSrc.includes('see the README') && !appSrc.includes('fix it if we misread'));
  t('service worker cache bumped to v141',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v146'));

  console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
})();
