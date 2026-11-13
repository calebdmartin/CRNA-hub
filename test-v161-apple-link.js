// CRNA Hub — v161: Apple calendar via PUBLIC LINK (the easy Apple
// door) + "How to connect" dropdowns on every provider card.
//
// Pins:
//   1. The Apple card gains a second door — "Connect with a calendar
//      link — easiest, no password" — rendered as its own item
//      directly under the Apple card by liveSyncCardsHTML (one
//      shared component, appleLinkHTML), and the two-way
//      app-password card is untouched.
//   2. The steps dropdown is collapsed by default, uses the shared
//      connectStepsHTML component, and carries the six iPhone steps
//      + the Mac/iCloud line + the treat-it-like-a-password /
//      read-only honesty line, verbatim.
//   3. Connect validates BEFORE it counts: the stub ics-feed (backed
//      by a REAL local HTTP server — a served ICS fixture at
//      /work.ics, an HTML page at /page.ics) is fetched at save
//      time; a link that does not return a calendar is rolled back
//      (disconnect posted, nothing left connected) with exactly:
//      "That link didn't return a calendar — check Public Calendar
//      is on and try again".
//   4. A good webcal:// link posts the normalized https URL, lands
//      connected with settings.icsKind='apple-link', and the feed
//      flow imports ONLY the work shifts from the served fixture,
//      priced from the facility card the client sent; approving the
//      preview saves them CONFIRMED with source 'calendar-ics'.
//   5. The connection is labelled "Apple calendar (link)" in the
//      shared Calendar link panel when it came through the Apple
//      door, and stays "Calendar link" for a generic link;
//      disconnect clears the kind.
//   6. Google and Outlook cards carry the same collapsed
//      "How to connect" dropdown, written from the real OAuth flow
//      (sign-in page opens -> approve -> tick the work calendar ->
//      Save & sync now), with Google's shared-calendar fix line and
//      Outlook's IT-admin-approval note + personal-account
//      alternative.
//
// The ics-feed stub stands in for the Edge Function at its wire
// contract (same as test-v148): save stores the URL, fetch REALLY
// GETs it over loopback HTTP (scheme ignored — the fixture server
// is plain HTTP; production fetches https), refuses non-ICS with
// feed_not_ics like the server, and classifies the fixture's
// events against the facilities the client sent, priced from
// their rate card — the server's contract, miniaturised. The real
// server parser is pinned separately in
// supabase/functions/ics-feed/parse.test.ts (Deno).
// Run: node test-v161-apple-link.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}

const FIXTURE_ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iCloud 3.0//EN', 'X-WR-CALNAME:Work Schedule',
  'BEGIN:VEVENT', 'UID:good1@icloud.com', 'DTSTART:20261205T063000Z', 'DTEND:20261205T150000Z', 'SUMMARY:Holzer 8', 'LOCATION:Holzer', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:good2@icloud.com', 'DTSTART;VALUE=DATE:20261207', 'DTEND;VALUE=DATE:20261208', 'SUMMARY:Holzer 10', 'LOCATION:Holzer', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:nope@icloud.com', 'DTSTART:20261207T170000Z', 'DTEND:20261207T180000Z', 'SUMMARY:Dentist appointment', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const FIXTURE_HTML = '<!doctype html><html><head><title>iCloud</title></head><body>Sign in</body></html>';

// The stub server-side parse of the fixture: an event is a shift
// when its summary/location names a facility the client sent; pay
// comes from that facility's card (rate10 for a "10" code, rate8
// for an "8" code) — the Edge Function's contract in miniature.
function stubParseShifts(icsText, facilities) {
  const shifts = [];
  const blocks = String(icsText).split(/BEGIN:VEVENT/i).slice(1);
  for (const b of blocks) {
    const get = (k) => { const m = b.match(new RegExp(k + '(?:;[^:]*)?:(.*)', 'i')); return m ? m[1].trim() : ''; };
    const summary = get('SUMMARY'), loc = get('LOCATION');
    const dm = get('DTSTART').match(/^(\d{4})(\d{2})(\d{2})/);
    if (!dm) continue;
    const fac = (facilities || []).find((f) => (summary + ' ' + loc).toLowerCase().includes(String(f.name || '').toLowerCase()));
    if (!fac) continue;
    const is10 = /\b10\b/.test(summary);
    shifts.push({
      date: `${dm[1]}-${dm[2]}-${dm[3]}`, facility: fac.name,
      type: is10 ? '10-hour day' : '8-hour day',
      pay: String(is10 ? fac.rate10 : fac.rate8 || ''),
      facilityKnown: true, code: summary, hours: is10 ? 10 : 8.5,
    });
  }
  return shifts;
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ host: '127.0.0.1', port: u.port, path: u.pathname }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    }).on('error', reject);
  });
}

function makeWorld(port) {
  const store = new Map();
  const alerts = [];
  const fetchCalls = [];
  const httpGets = [];
  const server = { storedUrl: '', connected: false };
  const MASKED = 'https://p35-caldav.icloud.com/…••••.ics';
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
    window: null, navigator: { userAgent: '' }, location: { protocol: 'https:', search: '', pathname: '/' },
    alert: (m) => { alerts.push(String(m)); },
    confirm: () => true,
    fetch: async (url, opts) => {
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
      fetchCalls.push({ url, body });
      let data = { ok: true };
      let status = 200;
      if (body && body.function === 'ics-feed') {
        const inner = body.body || {};
        if (body.action === 'status') data = { ok: true, connected: server.connected, masked: server.connected ? MASKED : null, parserVersion: 1 };
        else if (body.action === 'save') { server.storedUrl = String(inner.url || ''); server.connected = true; data = { ok: true, connected: true, masked: MASKED }; }
        else if (body.action === 'disconnect') { server.connected = false; server.storedUrl = ''; data = { ok: true, connected: false }; }
        else if (body.action === 'fetch') {
          httpGets.push(server.storedUrl);
          const text = await httpGetText(server.storedUrl);
          if (!/^BEGIN:VCALENDAR/i.test(text.trim())) { status = 502; data = { ok: false, error: 'feed_not_ics' }; }
          else data = { ok: true, masked: MASKED, shifts: stubParseShifts(text, inner.facilities || []), parserVersion: 1 };
        }
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
  return { run, sandbox, alerts, fetchCalls, icsCalls, getEl, MASKED, server, httpGets };
}
const HOLZER = `{id:'f1', name:'Holzer', aliases:'', address:'', hourlyRate:'250', paidHours8:'8.5', rate8:'2125', rate10:'2625'}`;
const SIGNIN = `cloudSession = { access_token: 'tok' };`;

(async () => {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/work.ics') { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(FIXTURE_ICS); }
    else if (req.url === '/page.ics') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(FIXTURE_HTML); }
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const PORT = httpServer.address().port;
  const GOOD = `webcal://127.0.0.1:${PORT}/work.ics`;
  const GOOD_NORM = `https://127.0.0.1:${PORT}/work.ics`;
  const BAD = `webcal://127.0.0.1:${PORT}/page.ics`;

  // ---------- 1+2. The Apple card's second door + steps, verbatim ----------
  {
    const w = makeWorld(PORT);
    w.run(`${SIGNIN} liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
    const block = w.run(`appleLinkHTML()`);
    t('1 the link door is labelled plainly', block.includes('Connect with a calendar link — easiest, no password'));
    t('1 the door carries its own paste form', block.includes('id="appleLinkForm"') && block.includes('id="f_appleLinkUrl"') && block.includes('Connect with this link'));
    const steps = w.run(`appleLinkStepsHTML()`);
    t('2 dropdown is the shared component, collapsed by default',
      steps.startsWith('<details class="connect-steps"><summary>How to find your link</summary>') && !steps.includes('<details class="connect-steps" open'));
    const six = ['Open the Calendar app on your iPhone', 'Tap Calendars at the bottom', 'Tap the ⓘ next to the calendar that has your shifts', 'Turn on Public Calendar', 'Tap Share Link and copy it', 'Paste the link below'];
    t('2 all six iPhone steps, verbatim', six.every((s) => steps.includes('<li>' + s + '</li>')));
    t('2 Mac/iCloud line, verbatim', steps.includes('On a Mac or iCloud.com: right-click the calendar, Share Calendar, Public Calendar.'));
    t('2 honesty line, verbatim', steps.includes("Anyone with this link can view the calendar — treat it like a password. This connection is read-only: CRNA Hub reads your shifts from it but can't add to that calendar."));
    const cards = w.run(`liveSyncCardsHTML()`);
    t('1 the link door renders directly under the Apple card', cards.includes('id="appleLinkForm"') && cards.indexOf('f_liveApplePw') < cards.indexOf('id="appleLinkForm"'));
    t('1 the two-way app-password card is untouched', cards.includes('App-specific password (one-time)') && cards.includes('data-action="live-apple-connect"'));
  }

  // ---------- 6. Google + Outlook "How to connect" dropdowns ----------
  {
    const w = makeWorld(PORT);
    w.run(`${SIGNIN} liveSyncConfig = { state: 'ready', google: true, outlook: true, apple: true, encryption: true };`);
    const g = w.run(`liveSyncProviderCard('google')`);
    t('6 Google card has the same collapsed dropdown',
      g.includes('<details class="connect-steps"><summary>How to connect</summary>') && !g.includes('<details class="connect-steps" open'));
    t('6 Google steps follow the real flow',
      g.includes('a Google sign-in page opens') && g.includes('Choose the Google account that holds your work calendar') && g.includes('Save &amp; sync now'));
    t('6 Google shared-calendar fix line',
      g.includes('accept the share in Google Calendar first') && g.includes('Load my calendars'));
    const o = w.run(`liveSyncProviderCard('outlook')`);
    t('6 Outlook card has the same collapsed dropdown',
      o.includes('<details class="connect-steps"><summary>How to connect</summary>'));
    t('6 Outlook steps follow the real flow',
      o.includes('a Microsoft sign-in page opens') && o.includes('Sign in with the Microsoft account that holds your work calendar') && o.includes('Save &amp; sync now'));
    t('6 Outlook IT-approval note + personal-account alternative',
      o.includes('make IT approve apps like this one') && o.includes('a personal Microsoft account works too'));
  }

  // ---------- 3. A link that returns no calendar: rolled back, one plain error ----------
  {
    const w = makeWorld(PORT);
    w.run(`${SIGNIN} db.facilities = [${HOLZER}]; db.shifts = [];`);
    w.getEl('f_appleLinkUrl').value = BAD;
    await w.run(`saveAppleLinkFeed({ preventDefault() {} })`);
    t('3 the bad link was really fetched over HTTP', w.httpGets.some((u) => u.includes('/page.ics')));
    t('3 rollback posted a disconnect', w.icsCalls('disconnect').length === 1);
    t('3 nothing is left connected', w.run(`db.settings.icsConnected`) === false && w.run(`db.settings.icsKind`) === '' && w.server.connected === false);
    t('3 the exact plain error', w.run(`appleLinkError`) === "That link didn't return a calendar — check Public Calendar is on and try again",
      w.run(`appleLinkError`));
    const w2 = makeWorld(PORT);
    w2.run(`${SIGNIN}`);
    w2.getEl('f_appleLinkUrl').value = 'not a link at all';
    await w2.run(`saveAppleLinkFeed({ preventDefault() {} })`);
    t('3 a non-URL is rejected before anything is sent',
      w2.run(`appleLinkError`).includes('does not look like a calendar link') && w2.icsCalls().length === 0);
  }

  // ---------- 4+5. A good link connects, imports priced shifts, wears its label ----------
  {
    const w = makeWorld(PORT);
    w.run(`${SIGNIN} db.facilities = [${HOLZER}]; db.shifts = [];`);
    t('4 webcal:// normalizes to the https URL', w.run(`icsFeedUrlNormalize('${GOOD}')`) === GOOD_NORM);
    w.getEl('f_appleLinkUrl').value = GOOD;
    await w.run(`saveAppleLinkFeed({ preventDefault() {} })`);
    const saves = w.icsCalls('save');
    t('4 save posted the normalized https link', saves.length === 1 && saves[0].body.body.url === GOOD_NORM,
      JSON.stringify(saves.map((s) => s.body.body)));
    t('4 the served fixture was really fetched', w.httpGets.filter((u) => u.includes('/work.ics')).length >= 1);
    t('4 connected as the Apple link door, no error',
      w.run(`db.settings.icsConnected`) === true && w.run(`db.settings.icsKind`) === 'apple-link' && w.run(`appleLinkError`) === '');
    t('4 the preview holds only the fixture’s work shifts',
      w.run(`!!schedulePreview && schedulePreview.source === 'ics-feed'`) === true &&
      w.run(`schedulePreview.rows.length`) === 2 &&
      w.run(`schedulePreview.rows.every(r => r.source === 'calendar-ics')`) === true);
    t('4 the shifts are priced from the facility card',
      w.run(`schedulePreview.rows.map(r => r.pay).sort().join(',')`) === '2125,2625');
    t('4 nothing saved before approval', w.run(`db.shifts.length`) === 0);
    w.run(`actions('schedule-approve', '', '', '')`);
    t('4 approving saves both shifts CONFIRMED, source calendar-ics, priced',
      w.run(`db.shifts.length`) === 2 &&
      w.run(`db.shifts.every(x => x.status === 'confirmed' && x.source === 'calendar-ics')`) === true &&
      w.run(`db.shifts.map(x => x.pay).sort().join(',')`) === '2125,2625');
    t('5 the Apple block reads connected under its own name',
      w.run(`appleLinkHTML()`).includes('Apple calendar (link) — ') && w.run(`appleLinkHTML()`).includes('Connected'));
    t('5 the shared panel wears the Apple calendar (link) label',
      w.run(`icsFeedHTML()`).includes('Apple calendar (link) · Connected'));
    await w.run(`disconnectIcsFeed()`);
    t('5 disconnect clears the kind', w.run(`db.settings.icsConnected`) === false && w.run(`db.settings.icsKind`) === '');
    // A generic link keeps the generic name.
    const w3 = makeWorld(PORT);
    w3.run(`${SIGNIN} db.settings.icsConnected = true; db.settings.icsMasked = 'https://example.com/…••••.ics'; db.settings.icsKind = '';`);
    t('5 a generic link keeps the Calendar link label',
      w3.run(`icsFeedHTML()`).includes('Calendar link · Connected') && !w3.run(`icsFeedHTML()`).includes('Apple calendar (link) · Connected'));
  }

  httpServer.close();
  console.log(`\ntest-v161-apple-link: ${pass} pass, ${fail} fail`);
  if (fail) process.exit(1);
  console.log('PASS test-v161-apple-link.js');
})().catch((e) => { console.error(e); process.exit(1); });
