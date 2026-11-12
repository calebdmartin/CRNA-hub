// CRNA Hub — v148: the calendar-link (ICS feed) door + Android guidance
// (Caleb, Nov 12, 2026: "I'm an Apple guy. I have no idea what android
// users use for calendars but we should probably build a way for them
// to be able to connect and sync their calendars").
//
// Pins:
//   1. webcal:// normalizes to https:// (client normaliser); a
//      non-URL is rejected with a plain message and nothing is sent.
//   2. Save posts the NORMALIZED link to the ics-feed function; the
//      stored/displayed value is the server-masked form — the raw
//      secret never appears in the panel HTML.
//   3. The ICS door renders inside the same connect area as QGenda
//      (Account sync section AND Facilities), with QGenda-shaped fields.
//   4. Boot auto-check NEVER adds without preview: new shifts wait in
//      a preview (source 'ics-feed', rows 'calendar-ics'); approving
//      saves them CONFIRMED with source 'calendar-ics'.
//   5. A zero-event manual check shows the quiet line, no sheet.
//   6. Android UA -> Google first + hint line; iOS UA -> Apple first;
//      desktop -> today's order.
//   (The fixture-feed parse through the shared parser is pinned in
//   supabase/functions/ics-feed/parse.test.ts — Deno suite.)
// Run: node test-v148-ics-feed.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

function makeWorld(ua) {
  const store = new Map();
  const alerts = [];
  const fetchCalls = [];
  const state = { icsShifts: [], icsStatusConnected: true, icsSaveFail: '' };
  const MASKED = 'https://calendar.google.com/…••••.ics';
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
    constructor(form) { this._e = (form && form._entries) || []; }
    *[Symbol.iterator]() { yield* this._e; }
  }
  const sandbox = {
    console, URL, URLSearchParams, Date, JSON, Math,
    crypto: require('crypto').webcrypto,
    FormData: FakeFormData,
    setTimeout: () => 1,
    clearTimeout: () => {},
    localStorage: {
      getItem: (k) => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => getEl(id),
      querySelectorAll: () => [],
      createElement: () => el(), body: { append() {} },
      addEventListener() {},
    },
    window: null, navigator: { userAgent: ua || '' }, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts) => {
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      fetchCalls.push({ url, body });
      let data = { ok: true };
      let status = 200;
      if (body && body.function === 'ics-feed') {
        if (body.action === 'status') data = { ok: true, connected: state.icsStatusConnected, masked: MASKED, parserVersion: 1 };
        else if (body.action === 'save') {
          if (state.icsSaveFail) { status = 503; data = { ok: false, error: state.icsSaveFail }; }
          else data = { ok: true, connected: true, masked: MASKED };
        } else if (body.action === 'fetch') data = { ok: true, masked: MASKED, shifts: state.icsShifts, parserVersion: 1 };
        else if (body.action === 'disconnect') data = { ok: true, connected: false };
      } else if (body && body.function === 'sync-calendar') {
        if (body.action === 'sync') data = { ok: true, providerChanges: [], pendingDeletions: [], shiftSync: [] };
        else if (body.action === 'status') data = { connections: [] };
        else if (body.action === 'log') data = { log: [] };
        else if (body.action === 'config') data = { state: 'ready', apple: true, google: true, outlook: true, encryption: true };
      }
      return { status, ok: status === 200, text: async () => JSON.stringify(data), json: async () => data };
    },
    history: { replaceState() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + 'supabase-config.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'app.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(R + 'live-sync.js', 'utf8'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  const icsCalls = (action) => fetchCalls.filter((c) => c.body && c.body.function === 'ics-feed' && (!action || c.body.action === action));
  return { run, sandbox, alerts, fetchCalls, state, icsCalls, getEl, MASKED };
}
const drain = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
const HOLZER = `{id:'f1', name:'Holzer', aliases:'', address:'', hourlyRate:'250', paidHours8:'8.5', rate8:'2125'}`;
const SIGNIN = `cloudSession = { access_token: 'tok', email: 't@example.com', expires_at: 9999999999 };`;
const RAW_LINK = 'webcal://calendar.google.com/calendar/ical/abc/private-deadbeef/basic.ics';
const NORM_LINK = 'https://calendar.google.com/calendar/ical/abc/private-deadbeef/basic.ics';

(async () => {
  // ---------- 1. Normalisation + rejection ----------
  {
    const w = makeWorld();
    t('1 webcal:// normalizes to https://', w.run(`icsFeedUrlNormalize('${RAW_LINK}')`) === NORM_LINK);
    t('1 http:// normalizes to https://', w.run(`icsFeedUrlNormalize('http://example.com/cal.ics')`) === 'https://example.com/cal.ics');
    t('1 a non-URL normalizes to empty', w.run(`icsFeedUrlNormalize('hello there')`) === '' && w.run(`icsFeedUrlNormalize('')`) === '');
    w.run(`${SIGNIN}`);
    w.getEl('f_icsUrl').value = 'not a link at all';
    await w.run(`saveIcsFeed({ preventDefault() {} })`);
    t('1 non-URL rejected with a plain message, nothing sent',
      w.run(`icsStatusError`).includes('does not look like a calendar link') && w.icsCalls().length === 0);
  }

  // ---------- 2. Save posts the normalized link; only the masked form is ever shown ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} db.facilities = [${HOLZER}]; db.shifts = [];`);
    w.getEl('f_icsUrl').value = RAW_LINK;
    await w.run(`saveIcsFeed({ preventDefault() {} })`);
    const saves = w.icsCalls('save');
    t('2 save posted once, with the NORMALIZED https link',
      saves.length === 1 && saves[0].body.body && saves[0].body.body.url === NORM_LINK,
      JSON.stringify(saves.map((s) => s.body.body)));
    t('2 settings record connected + masked only',
      w.run(`db.settings.icsConnected`) === true && w.run(`db.settings.icsMasked`) === w.MASKED);
    const panel = w.run(`icsFeedHTML()`);
    t('2 panel shows the masked link and the read-only line',
      panel.includes(w.MASKED) && panel.includes('Link calendars are read-only'));
    t('2 the raw secret appears NOWHERE in the panel', !panel.includes('deadbeef') && !panel.includes('private-'));
    t('2 empty feed after connect gives the honest no-shifts line',
      w.run(`icsStatusError`).includes('listed no shifts'));
  }

  // ---------- 2b. Pre-migration save failure is honest, not a fake success ----------
  {
    const w = makeWorld();
    w.state.icsSaveFail = 'ics_not_enabled';
    w.run(`${SIGNIN}`);
    w.getEl('f_icsUrl').value = RAW_LINK;
    await w.run(`saveIcsFeed({ preventDefault() {} })`);
    t('2b ics_not_enabled reads as a pending setup step, not a connection',
      w.run(`icsStatusError`).includes('not switched on yet') && w.run(`db.settings.icsConnected`) === false);
  }

  // ---------- 3. Same connect area, QGenda-shaped ----------
  {
    const w = makeWorld();
    w.run(`${SIGNIN} liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
    const section = w.run(`syncSectionHTML()`);
    t('3 Account sync section carries the Calendar link panel after QGenda',
      section.includes('id="ics-feed-panel"') && section.indexOf('id="qgenda-panel"') < section.indexOf('id="ics-feed-panel"'));
    t('3 the door has the QGenda-shaped paste form (password field + connect)',
      section.includes('id="icsFeedForm"') && section.includes('id="f_icsUrl"') && section.includes('Connect calendar link'));
    t('3 helper line names where the link lives (Google / Outlook / Apple)',
      section.includes('Secret address in iCal format') && section.includes('published calendar') && section.includes('shared calendar'));
    t('3 Facilities page carries the same panel (one component)',
      w.run(`facilitiesPage()`).includes('id="ics-feed-panel"'));
    w.run(`db.settings.featureQgenda = false;`);
    t('3 the shared feed toggle tucks the door away (off line, no form)',
      w.run(`icsFeedHTML()`).includes('is off') && !w.run(`icsFeedHTML()`).includes('icsFeedForm'));
  }

  // ---------- 4. Boot check: preview-only, approve saves CONFIRMED calendar-ics shifts ----------
  {
    const w = makeWorld();
    w.state.icsShifts = [
      { date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true, code: 'Holzer 8', hours: 8.5 },
      { date: '2026-12-07', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true, code: 'Holzer 8', hours: 8.5 },
    ];
    w.run(`${SIGNIN} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'k1', date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'calendar-ics', sources: ['calendar-ics'], note: '', updatedAt: null }];
      db.settings.icsConnected = true;`);
    await w.run(`icsBootCheck()`);
    t('4 boot check fetched once', w.icsCalls('fetch').length === 1);
    t('4 new shifts wait in an ics-feed preview; rows carry the calendar-ics source',
      w.run(`!!schedulePreview && schedulePreview.source === 'ics-feed'`) === true &&
      w.run(`schedulePreview.rows.every(r => r.source === 'calendar-ics')`) === true &&
      w.run(`icsPendingNew`) === 1);
    t('4 NOTHING auto-imported', w.run(`db.shifts.length`) === 1);
    t('4 Dashboard notice flags the waiting shift',
      w.run(`dashboard()`).includes('Calendar link: 1 new shift ready to review.'));
    t('4 boot check did not pop the sheet (background checks never do)', w.run(`icsSheetOpen`) === false);
    w.run(`actions('schedule-approve', '', '', '')`);
    t('4 approving saves the new shift CONFIRMED with source calendar-ics',
      w.run(`db.shifts.length`) === 2 &&
      w.run(`db.shifts.some(x => x.date === '2026-12-07' && x.source === 'calendar-ics' && x.status === 'confirmed')`) === true);
    t('4 approval clears the pending state', w.run(`icsPendingNew`) === 0 && w.run(`dashboardIcsNoticeHTML()`) === '');
    await w.run(`icsBootCheck()`);
    t('4 second boot check in the same session is a no-op', w.icsCalls('fetch').length === 1);
  }

  // ---------- 4b. All-known boot check is silent; manual check pops the sheet on new shifts ----------
  {
    const w = makeWorld();
    w.state.icsShifts = [{ date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true, code: 'Holzer 8', hours: 8.5 }];
    w.run(`${SIGNIN} db.facilities = [${HOLZER}];
      db.shifts = [{ id: 'k1', date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', status: 'confirmed', source: 'calendar-ics', sources: ['calendar-ics'], note: '', updatedAt: null }];
      db.settings.icsConnected = true;`);
    await w.run(`icsBootCheck()`);
    t('4b all-known boot check: no preview, no notice, last-checked stamped',
      w.run(`schedulePreview`) === null && w.run(`icsPendingNew`) === 0 && !!w.run(`db.settings.icsLastCheckedAt`));
    w.state.icsShifts = [
      { date: '2026-12-05', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true, code: 'Holzer 8', hours: 8.5 },
      { date: '2026-12-09', facility: 'Holzer', type: '8-hour day', pay: '2125', facilityKnown: true, code: 'Holzer 8', hours: 8.5 },
    ];
    await w.run(`fetchIcsFeed()`);
    t('4b manual check with a new shift pops the preview sheet',
      w.run(`icsSheetOpen`) === true && w.run(`icsPreviewSheetHTML()`).includes('Calendar link — review new shifts'));
  }

  // ---------- 5. Zero-event manual check: quiet line, no empty pop-up ----------
  {
    const w = makeWorld();
    w.state.icsShifts = [];
    w.run(`${SIGNIN} db.settings.icsConnected = true;`);
    await w.run(`fetchIcsFeed()`);
    t('5 zero events: honest listed-no-shifts line, no preview, no sheet',
      w.run(`icsStatusError`).includes('listed no shifts') && w.run(`schedulePreview`) === null && w.run(`icsSheetOpen`) === false);
  }

  // ---------- 6. Platform order + hint ----------
  {
    const ready = `liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true }; liveSyncConnections = {};`;
    const andr = makeWorld('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36');
    andr.run(`${SIGNIN} ${ready}`);
    const aHtml = andr.run(`liveSyncCardsHTML()`);
    t('6 Android: Google renders first', aHtml.indexOf('Google Calendar') > -1 && aHtml.indexOf('Google Calendar') < aHtml.indexOf('Apple Calendar'));
    t('6 Android: platform reads android', andr.run(`liveSyncPlatform()`) === 'android');
    t('6 hint line present in the panel for everyone',
      andr.run(`liveSyncPanelHTML()`).includes('On Android? Your calendar is most likely Google — tap Google Calendar.'));
    const ios = makeWorld('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    ios.run(`${SIGNIN} ${ready}`);
    const iHtml = ios.run(`liveSyncCardsHTML()`);
    t('6 iOS: Apple renders first', iHtml.indexOf('Apple Calendar') > -1 && iHtml.indexOf('Apple Calendar') < iHtml.indexOf('Google Calendar'));
    const desk = makeWorld('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36');
    desk.run(`${SIGNIN} ${ready}`);
    const dHtml = desk.run(`liveSyncCardsHTML()`);
    t('6 desktop: order unchanged (Google, Outlook, Apple)',
      dHtml.indexOf('Google Calendar') < dHtml.indexOf('Outlook') && dHtml.indexOf('Outlook') < dHtml.indexOf('Apple Calendar'));
  }

  // ---------- Source pins ----------
  const appSrc = fs.readFileSync(R + 'app.js', 'utf8');
  const liveSrc = fs.readFileSync(R + 'live-sync.js', 'utf8');
  t('pin: saved shifts are labelled "from calendar link" in the day sheet',
    appSrc.includes('from calendar link'));
  t('pin: ICS boot check wired beside the QGenda one in cloudInit + cloudAfterSignIn',
    (appSrc.match(/qgendaBootCheck\(\); icsBootCheck\(\)/g) || []).length === 2);
  t('pin: the feed function name is ics-feed on both save/fetch/status paths',
    appSrc.includes("liveSyncPost('ics-feed',{action:'save'") && appSrc.includes("liveSyncPost('ics-feed',{action:'fetch'") && appSrc.includes("liveSyncPost('ics-feed',{action:'status'}"));
  t('pin: no copy claims the link syncs two-way (read-only is stated)',
    appSrc.includes('Link calendars are read-only'));
  t('pin: live-sync keeps Google/Outlook/Apple behaviour — order helper only',
    liveSrc.includes('liveSyncProviderOrder') && liveSrc.includes("if (p === 'ios') return ['apple', 'google', 'outlook']"));
  t('pin: service worker cache bumped to v148',
    fs.readFileSync(R + 'sw.js', 'utf8').includes('crna-hub-shell-v153'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
