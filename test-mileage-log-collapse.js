// CRNA Hub — tests for the Log business mileage collapsible panel
// (Nov 7, 2026, branch muse/credentialing).
// Run: node test-mileage-log-collapse.js
//
// Caleb's ask: "Let's make this collapsible" — the always-open Log
// business mileage form on the Mileage tab becomes the app's standard
// collapsible panel. Covers:
//   * Collapsed by default with the quiet title "Log business mileage —
//     tap to add a trip manually", same place in the page (below the
//     weekly review, beside Mileage summary).
//   * Editing a trip opens it expanded, titled "Edit business mileage",
//     values prefilled; a successful save re-collapses it.
//   * A pending auto-calc status message also holds it open (the
//     message lives inside the form).
//   * Session draft: a half-filled form's values (and the panel's
//     open/closed state) survive re-renders via the render() snapshot —
//     keyed to the edit context, ignored in a different context, and
//     discarded by a successful save or by cancelling the edit.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;

function makeWorld(store, downloads) {
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
      querySelectorAll: () => [], querySelector: () => null,
      createElement: () => el(), body: { append() {} },
    },
    window: null, navigator: {}, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
    history: { replaceState() {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake'; };
  sandbox.URL.revokeObjectURL = () => {};
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
const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
const panelTag = (page) => {
  const m = page.match(/<details class="panel collapse-panel" id="mileage-log-panel"[^>]*>/);
  return m ? m[0] : '';
};

(async () => {
  const { run } = makeWorld(new Map(), []);

  run(`
    db.facilities = [{id:'f-holzer', name:'Holzer', address:'100 Jackson Pike, Gallipolis, OH 45631'}];
    db.vehicles = []; db.hotelStays = []; db.shifts = [];
    db.settings.homeAddress = '482 Travelers Ridge, Winfield Wv 25213';
    db.mileage = [{id:'trip-1', date:'2026-11-02', facility:'Holzer', origin:'home', hotelAddress:'',
      tripType:'round-trip', miles:'68.6', milesSource:'manual', oneWayMiles:'34.3',
      purpose:'Work shift', status:'verified', vehicleId:'', vehicleName:''}];
    editId = null; mileageFormDraft = null; mileageCalcStatus = '';
  `);

  // ---- 1. Collapsed by default, in place ----
  const page = run(`mileagePage()`);
  t('log form is now a collapsible panel', panelTag(page) !== '');
  t('panel is collapsed by default', panelTag(page) !== '' && !panelTag(page).includes(' open'));
  t('collapsed title carries the quiet summary line',
    page.includes('Log business mileage — tap to add a trip manually'));
  t('the form itself lives inside the panel', page.includes('data-kind="mileage"'));
  t('position kept: below the weekly review, before Mileage summary',
    page.indexOf('Weekly mileage review') < page.indexOf('mileage-log-panel') &&
    page.indexOf('mileage-log-panel') < page.indexOf('Mileage summary'));
  t('no leftover always-open section heading', !page.includes('<h2>Log business mileage</h2>'));

  // ---- 2. Edit opens it expanded and prefilled ----
  run(`editId = 'trip-1';`);
  const editPage = run(`mileagePage()`);
  t('editing a trip opens the panel', panelTag(editPage).includes(' open'));
  t('edit title replaces the add title', editPage.includes('Edit business mileage') && !editPage.includes('tap to add a trip manually'));
  t('edit values prefilled from the record',
    editPage.includes('value="2026-11-02"') && editPage.includes('value="Work shift"') && editPage.includes('value="68.6"'));

  // ---- 3. Save from the edit re-collapses and keeps the change ----
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'mileage'}, _entries:[
    ['date','2026-11-02'],['facility','Holzer'],['origin','home'],['hotelAddress',''],
    ['tripType','round-trip'],['miles','70.0'],['milesSource','manual'],['oneWayMiles','35'],
    ['purpose','Work shift — edited'],['status','verified']]}})`);
  t('edit saved through the real form path',
    run(`db.mileage.find(m=>m.id==='trip-1').purpose`) === 'Work shift — edited' &&
    run(`db.mileage.find(m=>m.id==='trip-1').miles`) === '70.0');
  t('save cleared edit state, draft and calc status',
    run(`editId`) === null && run(`mileageFormDraft`) === null && run(`mileageCalcStatus`) === '');
  const afterSave = run(`mileagePage()`);
  t('panel is collapsed again after a successful save', !panelTag(afterSave).includes(' open'));

  // ---- 4. Adding a trip still works from the (expanded-in-use) form ----
  run(`submitEntry({preventDefault(){}, currentTarget:{dataset:{kind:'mileage'}, _entries:[
    ['date','2026-11-04'],['facility','Holzer'],['origin','home'],['hotelAddress',''],
    ['tripType','round-trip'],['miles','68.6'],['milesSource','manual'],['oneWayMiles','34.3'],
    ['purpose','Second shift'],['status','verified']]}})`);
  t('new trip logged via the form', run(`db.mileage.length`) === 2 &&
    run(`db.mileage.some(m=>m.purpose==='Second shift')`));

  // ---- 5. A pending calc status holds the panel open ----
  run(`mileageCalcStatus = 'Pick a facility first.';`);
  const statusPage = run(`mileagePage()`);
  t('calc status message keeps the panel open and visible',
    panelTag(statusPage).includes(' open') && statusPage.includes('Pick a facility first.'));
  run(`mileageCalcStatus = '';`);

  // ---- 6. Session draft restores values + open state ----
  run(`mileageFormDraft = {forEditId:'', open:true, values:{date:'2026-11-03', facility:'Holzer',
    origin:'hotel', hotelAddress:'444 Upper River Rd', tripType:'one-way', miles:'34.3',
    milesSource:'auto', oneWayMiles:'34.3', purpose:'Call coverage', status:'draft'}};`);
  const draftPage = run(`mileagePage()`);
  t('draft reopens the panel as the user left it', panelTag(draftPage).includes(' open'));
  t('draft values restored into the form',
    draftPage.includes('value="Call coverage"') && draftPage.includes('value="444 Upper River Rd"') &&
    draftPage.includes('value="2026-11-03"') && draftPage.includes('<option value="draft" selected>'));
  run(`mileageFormDraft.open = false;`);
  const draftClosed = run(`mileagePage()`);
  t('a draft left collapsed stays collapsed, values intact',
    !panelTag(draftClosed).includes(' open') && draftClosed.includes('value="Call coverage"'));
  run(`editId = 'trip-1';`);
  const wrongCtx = run(`mileagePage()`);
  t('draft is ignored outside its edit context (record values win)',
    wrongCtx.includes('value="Work shift — edited"') && !wrongCtx.includes('value="Call coverage"'));
  run(`editId = null; mileageFormDraft = null;`);

  // ---- 7. render() snapshots the live form; the hold skips one capture ----
  run(`
    mileagePage();
    document.getElementById('mileage-log-panel').open = true;
    window.__fakeForm = {_entries:[['purpose','Typed in'],['miles','42.0'],['date','2026-11-05']]};
    document.querySelector = (s) => s === 'form[data-kind="mileage"]' ? window.__fakeForm : null;
    captureMileageLogDraft();
  `);
  t('capture snapshots values, context and open state',
    run(`mileageFormDraft && mileageFormDraft.values.purpose`) === 'Typed in' &&
    run(`mileageFormDraft.open`) === true && run(`mileageFormDraft.forEditId`) === '');
  run(`
    mileageDraftHold = true;
    window.__fakeForm = {_entries:[['purpose','Should not land']]};
    captureMileageLogDraft();
  `);
  t('the hold makes one capture a no-op (post-save / cancel), then clears itself',
    run(`mileageFormDraft.values.purpose`) === 'Typed in' && run(`mileageDraftHold`) === false);
  run(`
    tab = 'Mileage';
    window.__fakeForm = {_entries:[['purpose','Via render'],['miles','10']]};
    render();
  `);
  t('render() itself runs the capture before rebuilding',
    run(`mileageFormDraft && mileageFormDraft.values.purpose`) === 'Via render');
  run(`document.querySelector = () => null; mileageFormDraft = null;`);

  // ---- 8. Cancelling an edit discards its in-progress draft ----
  run(`
    tab = 'Mileage'; editId = 'trip-1';
    mileageFormDraft = {forEditId:'trip-1', open:true, values:{purpose:'Unsaved edit'}};
    actions('cancel');
  `);
  t('cancel clears the edit draft', run(`mileageFormDraft`) === null && run(`editId`) === null);
  const afterCancel = run(`mileagePage()`);
  t('form after cancel shows the saved record, not the discarded edit',
    !afterCancel.includes('Unsaved edit'));

  // ---- 9. Cache pin ----
  t('service worker cache bumped to v84', swSrc.includes('crna-hub-shell-v144'));
  t('app source carries the panel + draft wiring',
    appSrc.includes("collapsePanelHTML('mileage-log-panel'") && appSrc.includes('captureMileageLogDraft'));

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
})();
