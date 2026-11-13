// CRNA Hub — v127 (Nov 11, 2026): the Account tab's Features panel is
// collapsible. Caleb, verbatim: "Features needs to be collapsible." It
// rendered as a plain always-open <section> eating the whole tab while
// its neighbours (Notifications, Live calendar sync) are collapse-panel
// cards with chevron headers.
//
// Pins:
//  1 the panel renders through THE shared component — collapsePanelHTML
//    — as <details class="panel collapse-panel" id="features-panel">
//    with the standard summary/chevron head, NOT a plain section + h2.
//  2 fresh state is collapsed (no `open` attribute), matching the
//    neighbours' rendered default.
//  3 the body is the old body verbatim: the intro line plus all
//    toggles (five at v127; a sixth, Testing tools, arrived in v155)
//    feature toggles with their labels, blurbs and On/Off buttons.
//  4 on the Account page the Features card sits alongside the
//    Notifications card, both collapse panels, Features first (its
//    long-standing position).
//  5 the toggles inside work identically: flipping one flips the stored
//    flag, the row's button text follows, and the feature's own
//    off-collapse elsewhere is unchanged; flipping back restores.
//  6 state handling mirrors the app's interactive panels (the mileage
//    log draft rule — "reopens exactly as the user left it"): a
//    session-only snapshot captured at the top of render() carries the
//    live panel's open state across re-renders, so toggling a feature
//    (which re-renders) never slams the panel shut mid-task; a fresh
//    session starts collapsed.
//  7 SW cache is v127.
// Run: node test-v127-features-collapse.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

function makeWorld() {
  const store = new Map();
  function el() {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, files: [],
      dataset: {}, style: {}, _listeners: {},
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      append() {}, click() {}, remove() {}, scrollIntoView() {}, querySelectorAll: () => [],
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
      addEventListener() {},
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
  return { sandbox, elements, run: (code) => vm.runInContext(code, sandbox) };
}

const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');

(async () => {
  // ---------- 1+2: the shared component, collapsed by default ----------
  {
    const w = makeWorld();
    const html = w.run(`featuresSectionHTML()`);
    t('1 renders as a collapse panel with the features-panel id',
      html.startsWith('<details class="panel collapse-panel" id="features-panel">'));
    t('1 standard collapse head: title + chevron, same as the neighbours',
      html.includes('<summary class="collapse-head"><span class="collapse-title">Features</span><span class="collapse-chevron" aria-hidden="true">▾</span></summary><div class="collapse-body">'));
    t('1 no plain section / h2 rendering left',
      !html.includes('<section class="panel">') && !html.includes('<h2>Features</h2>'));
    t('2 fresh state collapsed (no open attribute)',
      !html.startsWith('<details class="panel collapse-panel" id="features-panel" open>'));
    t('2 session state starts collapsed', w.run(`featuresPanelOpen`) === false);

    // ---------- 3: body verbatim ----------
    t('3 intro line lives inside the expanded body',
      html.includes('<p class="muted">Use what you need — turn the rest off and they just tuck away. Nothing is ever deleted.</p>'));
    const defs = w.run(`FEATURE_DEFS.map(f => f.key + '|' + f.label)`);
    // v155 SUPERSEDED PIN, rewritten with reason: FEATURE_DEFS gained a
    // sixth toggle, featureTestingTools ("Testing tools (advanced)"),
    // so "all five" is now "all six". Its fresh-account state also
    // differs by design (next pin).
    t('3 all six toggles present with their toggle buttons',
      defs.length === 6 && defs.every(d => {
        const [key, label] = d.split('|');
        return html.includes(label.replace(/&/g, '&amp;')) && html.includes(`data-action="feature-toggle" data-id="${key}"`);
      }), JSON.stringify(defs));
    // v155 SUPERSEDED PIN, rewritten with reason: on a fresh (empty)
    // account the five original rows read On, but the new Testing
    // tools row deliberately starts Off — beta users never meet the
    // ERASE panel unless they turn it on. Accounts with records get
    // it On (test-v155-polish.js).
    t('3 fresh account: the original five rows read On; Testing tools starts Off',
      (html.match(/On — tap to turn off/g) || []).length === 5 && html.includes('Off — tap to turn on'));
  }

  // ---------- 4: Account page placement / neighbour parity ----------
  {
    const w = makeWorld();
    const acct = w.run(`accountPage()`);
    const fi = acct.indexOf('id="features-panel"');
    const ni = acct.indexOf('id="notifications-panel"');
    t('4 Account page carries the Features collapse card', fi >= 0 &&
      acct.includes('<details class="panel collapse-panel" id="features-panel">'));
    t('4 Notifications neighbour is the same kind of card, also collapsed',
      ni >= 0 && acct.includes('<details class="panel collapse-panel" id="notifications-panel">'));
    t('4 Features keeps its position ahead of Notifications', fi >= 0 && ni > fi);
  }

  // ---------- 5: toggles work identically from inside the panel ----------
  {
    const w = makeWorld();
    w.run(`actions('feature-toggle', 'featureMileage')`);
    t('5 toggle flips the stored flag off', w.run(`db.settings.featureMileage === false && featureOn('featureMileage') === false`));
    const off = w.run(`featuresSectionHTML()`);
    // v155 SUPERSEDED PIN, rewritten with reason: the panel now has a
    // sixth row (Testing tools) that starts Off on a fresh account, so
    // flipping Mileage yields TWO Off rows (Mileage + Testing tools)
    // and FOUR On rows, not one/four. The flipped row is still the
    // first Off row and still follows its own label.
    t('5 the flipped row now reads Off — tap to turn on, the rest still On',
      (off.match(/Off — tap to turn on/g) || []).length === 2 &&
      (off.match(/On — tap to turn off/g) || []).length === 4 &&
      off.indexOf('Off — tap to turn on') > off.indexOf('Mileage tracking'));
    t('5 the feature itself collapses elsewhere exactly as before (mileage off line)',
      w.run(`mileagePage()`).includes('Mileage tracking is off') &&
      !w.run(`mileagePage()`).includes('Log business mileage'));
    w.run(`actions('feature-toggle', 'featureMileage')`);
    t('5 toggling back restores the flag and the full mileage page',
      w.run(`featureOn('featureMileage') === true`) &&
      w.run(`mileagePage()`).includes('Log business mileage'));
    t('5 panel still renders collapsed-by-default markup after toggles (fresh world state var untouched by actions alone)',
      w.run(`featuresSectionHTML()`).startsWith('<details class="panel collapse-panel" id="features-panel">'));
  }

  // ---------- 6: session open-state snapshot (mileage-draft pattern) ----------
  {
    const w = makeWorld();
    // Simulate the user expanding the live panel, then a re-render's
    // snapshot running (render() calls captureFeaturesPanelState()).
    w.run(`document.getElementById('features-panel').open = true; captureFeaturesPanelState();`);
    t('6 expanded live panel is remembered across the re-render snapshot',
      w.run(`featuresPanelOpen`) === true &&
      w.run(`featuresSectionHTML()`).startsWith('<details class="panel collapse-panel" id="features-panel" open>'));
    w.run(`document.getElementById('features-panel').open = false; captureFeaturesPanelState();`);
    t('6 collapsed live panel is remembered too',
      w.run(`featuresPanelOpen`) === false &&
      w.run(`featuresSectionHTML()`).startsWith('<details class="panel collapse-panel" id="features-panel">'));
    t('6 render() snapshots the panel alongside the other captures',
      appSrc.includes('captureMileageLogDraft(); captureCloudAuthDraft(); captureFeaturesPanelState();'));
    t('6 the snapshot is session-only (never persisted with the data)',
      !appSrc.includes('featuresPanelOpen') || !/persist\([^)]*featuresPanelOpen/.test(appSrc));
  }

  // ---------- 7: service worker ----------
  t('7 sw cache bumped to v127', swSrc.includes('crna-hub-shell-v157'));

  console.log(`\nv127 features collapse: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
