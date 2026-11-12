// CRNA Hub — blank-page regression (Nov 6, 2026).
// Run: node test-boot-blank-page.js
// Caleb opened the Vercel preview and got ONLY the static header + footer:
// no tabs, no content. Root-cause class: any failure while the app shell
// loads or first renders left a silent blank page — in particular the
// service worker's offline fallback served index.html for ANY failed GET,
// including app.js itself, so one hiccuped script fetch made the browser
// parse HTML as JavaScript and the whole app died with nothing on screen.
// Fixes pinned here:
// 1. sw.js: the index.html fallback applies ONLY to navigation requests;
//    a failed script/style fetch returns the cached copy or a real 504.
// 2. index.html: a boot watchdog captures load errors and, if tabs/content
//    have not rendered within a few seconds, shows a visible message with
//    a reload button — never a silent blank page.
// 3. app.js: the first render is wrapped (bootRender) — if first paint
//    throws, the user still gets the tab bar and an error panel.
// 4. Signed-out first paint renders the tab bar + Dashboard content.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
const store = new Map();
function el() {
  return {
    innerHTML: '', textContent: '', value: '', checked: false, files: [],
    addEventListener() {}, append() {}, click() {}, remove() {},
    dataset: {}, style: {}, scrollIntoView() {}, querySelectorAll: () => [],
  };
}
const elements = {};
const sandbox = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
  crypto: require('crypto').webcrypto,
  FormData: class { *[Symbol.iterator]() {} },
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
  fetch: async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }),
  history: { replaceState() {} },
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
let failures = 0;
const t = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) { failures++; process.exitCode = 1; }
};

// ---------- 1+2: static shell checks ----------
const swSrc = fs.readFileSync(R + 'sw.js', 'utf8');
t('sw: cache bumped to v65', swSrc.includes("crna-hub-shell-v145"));
t('sw: index.html fallback is navigation-only', swSrc.includes("e.request.mode==='navigate'"));
t('sw: no unconditional index.html fallback for subresources', !swSrc.includes("r||caches.match('./index.html')"));
t('sw: uncached subresource gets a real error response', swSrc.includes('status:504'));

const indexSrc = fs.readFileSync(R + 'index.html', 'utf8');
t('index: boot watchdog installed', indexSrc.includes('__crnaBootWatch'));
t('index: watchdog captures load errors', indexSrc.includes('__crnaBootErrors'));
t('index: watchdog message offers reload, says data is safe', indexSrc.includes('finish loading') && indexSrc.includes('location.reload()') && indexSrc.includes('not affected'));
t('index: watchdog script runs before the deferred app scripts', indexSrc.indexOf('__crnaBootWatch') < indexSrc.indexOf('src="app.js"'));

const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
t('app: first render goes through bootRender', appSrc.includes('function bootRender()') && appSrc.includes('bootRender();cloudInit();'));
t('app: render clears the boot watchdog once it paints', appSrc.includes('clearTimeout(window.__crnaBootWatch)'));

// ---------- 4: signed-out first paint renders ----------
vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
vm.runInContext(appSrc, sandbox);
const navHTML = elements.nav ? elements.nav.innerHTML : '';
const appHTML = elements.app ? elements.app.innerHTML : '';
t('signed-out: nav renders all 6 tabs (PTO tab removed Nov 6)', ['Account','Dashboard','Facilities','Credentials','Mileage','Assistant'].every(x => navHTML.includes('data-tab="' + x + '"')));
t('signed-out: Dashboard content renders (not blank)', appHTML.length > 500 && appHTML.includes('Overview'));
t('signed-out: header status set by render', !!(elements.storageStatus && elements.storageStatus.textContent));

// ---------- 3: a throwing first paint still leaves tabs + an error ----------
const run = (code) => vm.runInContext(code, sandbox);
elements.nav.innerHTML = ''; elements.app.innerHTML = '';
run(`dashboard = () => { throw new Error('boom-first-paint'); };`);
run(`bootRender();`);
t('boot failure: tab bar still rendered', ['Account','Dashboard','Facilities'].every(x => elements.nav.innerHTML.includes('data-tab="' + x + '"')));
t('boot failure: visible error panel, not a blank page', elements.app.innerHTML.includes('Something went wrong starting CRNA Hub') && elements.app.innerHTML.includes('boom-first-paint'));

console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
