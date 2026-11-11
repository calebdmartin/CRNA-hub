// CRNA Hub — v118: push watchdog trigger evaluation + Web Push crypto.
//
// The watchdog's decision logic (supabase/functions/push-watchdog/
// evaluate.ts) is pure by design; this suite loads the REAL module
// (and webpush.ts) into node and pins the brief's guarantees:
//  - cert 90-day fires exactly once across two runs (sent-log dedup)
//  - empty calendar fires on the 20th, not the 19th/21st
//  - QGenda relink fires once per failure episode
//  - quiet hours (22:00-06:00 user-local) hold everything
//  - CE wording is honest ("may still need") and only fires on what
//    the app tracks
//  - payloads are real RFC 8291 ciphertext: encrypted with the
//    subscription keys, decrypted here with the private key.
// Run: node test-v118-watchdog-eval.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const R = __dirname + path.sep;
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  FAIL -', name + (extra ? ' — ' + extra : '')); }
}
function loadModule(file) {
  const src = fs.readFileSync(R + file, 'utf8').replace(/^export\s+/gm, '');
  const sandbox = {
    console, URL, TextEncoder, TextDecoder, Date, JSON, Math,
    crypto: webcrypto, fetch: null, // set per-test below
  };
  sandbox.fetchCalls = [];
  sandbox.fetch = async (url, opts) => {
    sandbox.fetchCalls.push({ url, opts });
    return { status: sandbox.nextStatus || 201, text: async () => '' };
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}
const ev = loadModule('supabase/functions/push-watchdog/evaluate.ts');
const wp = loadModule('supabase/functions/push-watchdog/webpush.ts');

const TODAY = '2026-11-11';
const plusDays = (base, n) => {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function baseInput(over) {
  return Object.assign({
    todayStr: TODAY, localHour: 10,
    isTwentieth: false, nextMonthPrefix: '2026-12',
    nextMonthLabel: 'December 2026', nextMonthShiftCount: 3,
    settings: {},
    rows: { nbcrna: {}, aana: {}, licenses: [], documents: [], credentials: [] },
    ceRecordCount: 5,
    sentKeys: [],
  }, over || {});
}
const LIC90 = { state: 'WV', license_type: 'APRN-CRNA', expiration_date: plusDays(TODAY, 90) };

(async () => {
  // ---- (a) certification thresholds + once-only -------------------
  let out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [LIC90], documents: [], credentials: [] } }));
  let certs = out.filter((n) => n.type === 'cert');
  t('cert: license 90 days out fires once', certs.length === 1, JSON.stringify(out));
  t('cert: 90-day trigger key', certs.length === 1 && certs[0].triggerKey.endsWith('|90'), certs[0] && certs[0].triggerKey);
  t('cert: deep link goes to Credentials', certs.length === 1 && certs[0].url === '?go=credentials');
  const key90 = certs[0].triggerKey;
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [LIC90], documents: [], credentials: [] }, sentKeys: [key90] }));
  t('cert: second run with sent-log is silent (exactly once)', out.filter((n) => n.type === 'cert').length === 0);
  const lic60 = { state: 'WV', license_type: 'APRN-CRNA', expiration_date: plusDays(TODAY, 60) };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [lic60], documents: [], credentials: [] }, sentKeys: [key90] }));
  certs = out.filter((n) => n.type === 'cert');
  t('cert: 60-day threshold is a new, separate fire', certs.length === 1 && certs[0].triggerKey.endsWith('|60'), JSON.stringify(certs));
  const licFar = { state: 'WV', license_type: 'APRN-CRNA', expiration_date: plusDays(TODAY, 120) };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [licFar], documents: [], credentials: [] } }));
  t('cert: 120 days out — no fire yet', out.filter((n) => n.type === 'cert').length === 0);
  const licPast = { state: 'WV', license_type: 'APRN-CRNA', expiration_date: plusDays(TODAY, -3) };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [licPast], documents: [], credentials: [] } }));
  certs = out.filter((n) => n.type === 'cert');
  t('cert: expired fires once at threshold 0', certs.length === 1 && certs[0].triggerKey.endsWith('|0') && /expired/.test(certs[0].body));

  // ---- (b) CE honesty ----------------------------------------------
  const nbShort = { period_end: plusDays(TODAY, 80), mac_ed_credits: 30, mac_dev_credits: 40, mac_ed_required: 60, mac_dev_required: 40 };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: nbShort, aana: {}, licenses: [], documents: [], credentials: [] } }));
  let ces = out.filter((n) => n.type === 'ce');
  t('ce: NBCRNA short on tracked MAC Ed fires', ces.length === 1, JSON.stringify(out));
  t('ce: wording is honest ("may still need")', ces.length === 1 && /may still need education hours/.test(ces[0].body) && /30\/60/.test(ces[0].body), ces[0] && ces[0].body);
  const nbFull = { period_end: plusDays(TODAY, 80), mac_ed_credits: 60, mac_dev_credits: 40, mac_ed_required: 60, mac_dev_required: 40 };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: nbFull, aana: {}, licenses: [], documents: [], credentials: [] } }));
  t('ce: requirements met on file — no fire', out.filter((n) => n.type === 'ce').length === 0);
  const licSoon = { state: 'OH', license_type: 'APRN-CRNA', expiration_date: plusDays(TODAY, 80) };
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [licSoon], documents: [], credentials: [] }, ceRecordCount: 0 }));
  ces = out.filter((n) => n.type === 'ce');
  t('ce: license renewal near + zero CE records on file fires', ces.length === 1 && /don't have education \(CE\) records on file/.test(ces[0].body), JSON.stringify(ces));
  out = ev.evaluateUser(baseInput({ rows: { nbcrna: {}, aana: {}, licenses: [licSoon], documents: [], credentials: [] }, ceRecordCount: 12 }));
  t('ce: CE records exist — no speculative fire', out.filter((n) => n.type === 'ce').length === 0);

  // ---- (c) empty calendar ------------------------------------------
  out = ev.evaluateUser(baseInput({ isTwentieth: true, nextMonthShiftCount: 0 }));
  let cal = out.filter((n) => n.type === 'calendar');
  t('calendar: 20th + empty next month fires', cal.length === 1 && cal[0].triggerKey === 'calendar|2026-12');
  t('calendar: Caleb\'s exact wording', cal.length === 1 && /no scheduled dates for December 2026 — want to add them\?/.test(cal[0].body), cal[0] && cal[0].body);
  t('calendar: tap opens Dashboard', cal.length === 1 && cal[0].url === '?go=dashboard');
  out = ev.evaluateUser(baseInput({ isTwentieth: false, nextMonthShiftCount: 0 }));
  t('calendar: 19th/21st (not the 20th) — no fire', out.filter((n) => n.type === 'calendar').length === 0);
  out = ev.evaluateUser(baseInput({ isTwentieth: true, nextMonthShiftCount: 2 }));
  t('calendar: next month has shifts — no fire', out.filter((n) => n.type === 'calendar').length === 0);
  out = ev.evaluateUser(baseInput({ isTwentieth: true, nextMonthShiftCount: 0, sentKeys: ['calendar|2026-12'] }));
  t('calendar: fires once per month', out.filter((n) => n.type === 'calendar').length === 0);

  // ---- (d) QGenda relink — once per episode -------------------------
  const qSettings = { watch: { qgendaLink: { state: 'auth_failed', episode: '2026-11-11T08:00:00.000Z' } } };
  out = ev.evaluateUser(baseInput({ settings: qSettings }));
  let q = out.filter((n) => n.type === 'qgenda');
  t('qgenda: rejected link fires', q.length === 1 && q[0].triggerKey === 'qgenda|2026-11-11T08:00:00.000Z');
  t('qgenda: wording + Facilities deep link', q.length === 1 && /needs a refresh/.test(q[0].title + q[0].body) && q[0].url === '?go=facilities');
  out = ev.evaluateUser(baseInput({ settings: qSettings, sentKeys: ['qgenda|2026-11-11T08:00:00.000Z'] }));
  t('qgenda: retries in the same episode stay silent', out.filter((n) => n.type === 'qgenda').length === 0);
  const qSettings2 = { watch: { qgendaLink: { state: 'auth_failed', episode: '2026-11-18T08:00:00.000Z' } } };
  out = ev.evaluateUser(baseInput({ settings: qSettings2, sentKeys: ['qgenda|2026-11-11T08:00:00.000Z'] }));
  t('qgenda: a NEW episode fires again', out.filter((n) => n.type === 'qgenda').length === 1);
  out = ev.evaluateUser(baseInput({ settings: { watch: { qgendaLink: { state: 'ok' } } } }));
  t('qgenda: healthy link — no fire', out.filter((n) => n.type === 'qgenda').length === 0);

  // ---- (e) portal sign-in + (f) sync health --------------------------
  const pSettings = { watch: { portalSignin: [{ key: 'aana', label: 'AANA', cycle: TODAY }, { key: 'licenses:WV', label: 'State licenses (WV)', cycle: TODAY }] } };
  out = ev.evaluateUser(baseInput({ settings: pSettings }));
  let ps = out.filter((n) => n.type === 'portal');
  t('portal: one notification per due source', ps.length === 2, JSON.stringify(ps));
  t('portal: deep link goes to Credentials', ps.length === 2 && ps.every((n) => n.url === '?go=credentials'));
  out = ev.evaluateUser(baseInput({ settings: pSettings, sentKeys: ps.map((n) => n.triggerKey) }));
  t('portal: same cycle does not repeat', out.filter((n) => n.type === 'portal').length === 0);
  const sSettings = { watch: { syncHealth: { state: 'needs_reauth', providers: 'google', episode: 'E9' } } };
  out = ev.evaluateUser(baseInput({ settings: sSettings }));
  let sy = out.filter((n) => n.type === 'sync');
  t('sync: needs-reconnect fires once per episode, Account deep link', sy.length === 1 && sy[0].triggerKey === 'sync|E9' && sy[0].url === '?go=account', JSON.stringify(sy));

  // ---- quiet hours + per-type toggles + master switch ----------------
  const everything = baseInput({
    settings: { watch: { qgendaLink: { state: 'auth_failed', episode: 'E1' }, portalSignin: [{ key: 'aana', label: 'AANA', cycle: TODAY }] } },
    rows: { nbcrna: {}, aana: {}, licenses: [LIC90], documents: [], credentials: [] },
    isTwentieth: true, nextMonthShiftCount: 0,
  });
  t('quiet: 23:00 holds everything', ev.evaluateUser(Object.assign({}, everything, { localHour: 23 })).length === 0);
  t('quiet: 05:00 holds everything', ev.evaluateUser(Object.assign({}, everything, { localHour: 5 })).length === 0);
  t('quiet: 06:00 releases the held set', ev.evaluateUser(Object.assign({}, everything, { localHour: 6 })).length >= 3);
  t('quiet: 21:00 still sends', ev.evaluateUser(Object.assign({}, everything, { localHour: 21 })).length >= 3);
  const typedOff = baseInput({ settings: { pushTypes: { cert: false } }, rows: { nbcrna: {}, aana: {}, licenses: [LIC90], documents: [], credentials: [] } });
  t('types: cert toggled off — no cert notification', ev.evaluateUser(typedOff).filter((n) => n.type === 'cert').length === 0);
  const masterOff = baseInput({ settings: { featurePush: false, watch: { qgendaLink: { state: 'auth_failed', episode: 'E1' } } } });
  t('types: feature off — watchdog silent', ev.evaluateUser(masterOff).length === 0);

  // ---- webpush: VAPID header + RFC 8291 round-trip -------------------
  const asPair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  // (application server = the watchdog's VAPID identity for signing)
  const asPubRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', asPair.publicKey));
  const asJwk = await webcrypto.subtle.exportKey('jwk', asPair.privateKey);
  const vapid = { publicKey: wp.bytesToB64url(asPubRaw), privateKey: asJwk.d, subject: 'mailto:test@example.com' };
  const hdr = await wp.vapidAuthHeader('https://push.example.com/sub/abc', vapid);
  t('vapid: Authorization header shape', /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/.test(hdr), hdr.slice(0, 40));
  const jwtPayload = JSON.parse(Buffer.from(hdr.split('t=')[1].split(',')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  t('vapid: JWT aud = push origin, sub = subject', jwtPayload.aud === 'https://push.example.com' && jwtPayload.sub === 'mailto:test@example.com', JSON.stringify(jwtPayload));

  const uaPair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPubRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', uaPair.publicKey));
  const authSecret = webcrypto.getRandomValues(new Uint8Array(16));
  const p256dh = wp.bytesToB64url(uaPubRaw);
  const auth = wp.bytesToB64url(authSecret);
  const payload = JSON.stringify({ title: 'CRNA Hub', body: 'Test', url: '?go=dashboard' });
  const cipher = await wp.encryptPayload(p256dh, auth, payload);
  t('push: header layout (salt16 + rs4096 + keyid 65)', cipher.length === 16 + 4 + 1 + 65 + payload.length + 1 + 16 && cipher[20] === 65, 'len=' + cipher.length);
  // Independent decrypt (RFC 8291): parse header, ECDH, HKDF chain.
  const salt = cipher.slice(0, 16);
  const asPub = cipher.slice(21, 86);
  const asPubKey = await webcrypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'ECDH', namedCurve: 'P-256', public: asPubKey }, uaPair.privateKey, 256));
  const hkdf = async (ikm, s, info, len) => new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const te = new TextEncoder();
  const ikm = await hkdf(shared, authSecret, new Uint8Array([...te.encode('WebPush: info\0'), ...uaPubRaw, ...asPub]), 32);
  const cek = await hkdf(ikm, salt, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, te.encode('Content-Encoding: nonce\0'), 12);
  const cekKey = await webcrypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, cipher.slice(86)));
  t('push: round-trip decrypts to the payload + 0x02 delimiter', new TextDecoder().decode(plain.slice(0, -1)) === payload && plain[plain.length - 1] === 2);

  wp.nextStatus = 201;
  const st = await wp.sendWebPush({ endpoint: 'https://push.example.com/sub/abc', keys: { p256dh, auth } }, { title: 'Hi' }, vapid);
  t('push: send path posts encrypted body to the endpoint', st === 201 && wp.fetchCalls.length === 1 && wp.fetchCalls[0].url === 'https://push.example.com/sub/abc' && wp.fetchCalls[0].opts.headers['Content-Encoding'] === 'aes128gcm' && /^vapid t=/.test(wp.fetchCalls[0].opts.headers.Authorization));
  wp.nextStatus = 410;
  const st410 = await wp.sendWebPush({ endpoint: 'https://push.example.com/sub/gone', keys: { p256dh, auth } }, { title: 'Hi' }, vapid);
  t('push: 410 surfaces so the caller prunes the subscription', st410 === 410);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
