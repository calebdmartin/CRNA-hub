// CRNA Hub — live portal connections (Edge Function).
//
// What this is: the server side of the Credentials tab's Connect buttons.
// It pulls credential facts from the sources that actually allow it and
// says plainly where it cannot — it never invents a record.
//
// Sources, verified Nov 5, 2026 (do not re-derive without re-checking):
//   NBCRNA — public credential verification, no login required:
//     https://portal.nbcrna.com/credential-verification
//     (Oracle APEX app 700, page 17800; submit via wwv_flow.accept with
//     p_flow_id=700, p_flow_step_id=17800, p_instance,
//     p_page_submission_id, p_request=SEARCH, P17800_FIRSTNAME,
//     P17800_LASTNAME, optional P17800_CERT_NUMBER / P17800_STATE).
//     Returns CERTIFICATE_NO, CERT_TY, CURRENT_EXP_DATE, STATE_COUNTRY.
//     It does NOT give CPC / MAC Ed / MAC Dev / CE totals — those are
//     member-login only.
//     STATUS Nov 5, 2026: PLAUSIBLE BUT UNPROVEN. The verification page
//     itself loads fine server-side, but a server-side POST to
//     /nbcrnassa/wwv_flow.accept returns 404 (and a POST to the f?p= URL
//     also 404s). The flow below implements the documented APEX submit
//     exactly; until a real pull returns a match, every NBCRNA result is
//     reported as unverified/unavailable, never faked.
//   WV Board of Nursing lookup (wvrn.boardsofnursing.org/licenselookup):
//     BLOCKED — Imperva Incapsula challenge. Not scraped. Manual route
//     only, plus free Nursys e-Notify enrollment for push alerts.
//   Ohio eLicense (elicense.ohio.gov/oh_verifylicense): BLOCKED —
//     Salesforce Lightning JS app, no public API, session+CSRF Aura JSON.
//     Not reverse-engineered. Manual route only.
//   Nursys QuickConfirm: RN/PN only, session-gated, unproven; Nursys
//     explicitly does NOT verify APRN licenses. Never claimed here.
//   AANA: NO public verification, NO API. The CE transcript is
//     Active-member-login only (Aptify e-Business, SSO at
//     aptify.aana.com -> www.aana.com/sso-auth/login, behind Incapsula).
//     DELETED Nov 5, 2026 (audit F9): the former server-side
//     connect-aana sign-in (username/password passed to this server
//     for one login attempt) was removed entirely — the final product
//     never hands the server a portal password, even transiently.
//     AANA sign-in happens only in the native system sign-in sheet;
//     in this preview the user signs in themselves in a new tab and
//     the assistant reads the record page they show it. AANA CE is
//     also shared AANA -> NBCRNA, so NBCRNA totals may cover the
//     same credits.
//
// Endpoints (all under /functions/v1/portal-sync):
//   GET  ?action=config   (public, booleans/labels only — no user data)
//        -> { ok, sources: { nbcrna, aana, wv, ohio } } each 'live' |
//           'unproven' | 'signin-required' | 'blocked' | 'unsupported'
//   GET  ?action=status   (auth) -> this user's portal_connections rows
//   POST { action: "verify-nbcrna", firstName, lastName, certNumber?, state? } (auth)
//        -> public NBCRNA verification pull (no password involved)
//   POST { action: "verify-license", state, firstName, lastName, licenseNumber? } (auth)
//        -> public state-board verification attempt; WV/OH report blocked
//           with the manual route, other states report unsupported
//
// Every pulled record is labelled with its source and retrieval date.
// Nothing here logs or returns passwords or full portal HTML — errors
// carry a short code plus a short human message only.
//
// FINAL NATIVE DESIGN (agreed Nov 4-5, 2026 — see PORTAL_NATIVE_SPEC in
// app.js): the finished iOS app signs the user in through Apple's system
// sign-in sheet (ASWebAuthenticationSession); iPhone Passwords + Face ID
// fill the login and the app never sees a portal password. What this
// function still owns in that design:
//   * the NBCRNA public verification pull (no login; implemented, UNPROVEN
//     — its submit endpoint 404s server-side);
//   * honest blocked/unsupported answers for WV / Ohio lookups, with the
//     manual route + Nursys e-Notify pointer;
//   * portal_connections status rows (connected / needs_reauth / failed).
// What it does NOT own: sign-in. A former connect-aana endpoint
// (server took a username/password for one AANA attempt) was DELETED
// Nov 5, 2026 (audit F9) — the final product never hands the server
// a portal password, even transiently. Sign-in happens only in the
// native system sign-in sheet.

import {
  CORS,
  json,
  err,
  authUserId,
  sbGet,
  sbUpsert,
  sbPatch,
  sbInsert,
} from "../_shared/calendar.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const NBCRNA_VERIFY_URL = "https://portal.nbcrna.com/credential-verification";
const NBCRNA_ACCEPT_URL = "https://portal.nbcrna.com/nbcrnassa/wwv_flow.accept";

const WV_LOOKUP_URL = "https://wvrn.boardsofnursing.org/licenselookup";
const OH_LOOKUP_URL = "https://elicense.ohio.gov/oh_verifylicense";

function nowIso(): string {
  return new Date().toISOString();
}

function clean(s: unknown): string {
  return String(s ?? "").trim();
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "MM/DD/YYYY" or "DD-MON-YYYY" -> "YYYY-MM-DD", or null.
function parsePortalDate(raw: string): string | null {
  const t = clean(raw);
  if (!t) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
  if (m) {
    const months: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mo = months[m[2].toUpperCase()];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Upsert one portal_connections row by (user_id, portal, state): the
// unique key is (user_id, portal, state), not the id primary key, so a
// blind upsert would duplicate rows. Never touches a password (there is
// nothing to store — portal passwords are never kept).
async function setPortalStatus(
  userId: string,
  portal: string,
  state: string | null,
  status: string,
  lastError: string | null,
): Promise<void> {
  const q =
    `select=*&user_id=eq.${encodeURIComponent(userId)}` +
    `&portal=eq.${encodeURIComponent(portal)}` +
    `&state=${state === null ? "is.null" : "eq." + encodeURIComponent(state)}`;
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await sbGet("portal_connections", q);
  } catch {
    rows = [];
  }
  const patch = {
    status,
    last_synced_at: nowIso(),
    last_error: lastError,
  };
  if (rows.length) {
    await sbPatch(
      "portal_connections",
      `id=eq.${encodeURIComponent(String(rows[0].id))}`,
      patch,
    );
  } else {
    try {
      await sbInsert("portal_connections", {
        user_id: userId,
        portal,
        state,
        ...patch,
      });
    } catch {
      // The row appeared between the select and the insert (unique
      // user_id+portal+state): re-read and patch it instead of losing
      // the status write — a lost 'failed' write is what leaves a stale
      // 'connected' label standing.
      const again = await sbGet("portal_connections", q).catch(() => []);
      if (again.length) {
        await sbPatch(
          "portal_connections",
          `id=eq.${encodeURIComponent(String(again[0].id))}`,
          patch,
        );
      } else {
        throw new Error("portal_status_write_failed");
      }
    }
  }
}

// --- NBCRNA public verification (APEX flow) ---

function apexField(html: string, name: string): string {
  const m = new RegExp(
    `name="${escRe(name)}" value="([^"]*)"`,
  ).exec(html);
  return m ? m[1] : "";
}

interface NbcrnaMatch {
  certNumber: string;
  certType: string;
  expDate: string | null;
  stateCountry: string;
}

// Parse the APEX results region: a report table whose columns are
// CERTIFICATE_NO, CERT_TY, CURRENT_EXP_DATE, STATE_COUNTRY (plus initial
// cert date / program). Returns the first data row that looks like a
// certification, or null when the page shows no results.
function parseNbcrnaResults(html: string): NbcrnaMatch | null {
  const lower = html.toLowerCase();
  if (
    lower.includes("no data found") ||
    lower.includes("no records found") ||
    lower.includes("no results found")
  ) return null;
  // Interactive/classic report rows.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1];
    if (/<th/i.test(rowHtml)) continue; // header row
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(rowHtml)) !== null) cells.push(stripTags(c[1]));
    if (cells.length < 2) continue;
    const joined = cells.join(" | ");
    // A result row carries a cert type mentioning CRNA and an expiry date.
    const dateCell = cells.find((x) => parsePortalDate(x) !== null);
    const hasCertType = /CRNA|Certified Registered Nurse/i.test(joined);
    const certNumber = cells.find((x) => /^[A-Za-z0-9][A-Za-z0-9\-]{3,}$/.test(x) && !/CRNA/i.test(x)) ?? "";
    if (hasCertType && dateCell) {
      return {
        certNumber,
        certType: cells.find((x) => /CRNA/i.test(x)) ?? "CRNA",
        expDate: parsePortalDate(dateCell),
        stateCountry: cells[cells.length - 1] ?? "",
      };
    }
  }
  return null;
}

async function handleVerifyNbcrna(
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  const certNumber = clean(body.certNumber);
  const state = clean(body.state);
  if (!firstName || !lastName) return err("missing_name", 400);

  // 1. GET the verification page first: APEX needs the session
  // (p_instance + p_page_submission_id) and the ORA_WWV cookies.
  let pageHtml = "";
  let cookie = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let page: Response;
    try {
      page = await fetch(NBCRNA_VERIFY_URL, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!page.ok) throw new Error(`verify_page_http_${page.status}`);
    const setCookie = page.headers.get("set-cookie") ?? "";
    cookie = setCookie
      .split(/,(?=[^;]+=[^;]+;)/)
      .map((p) => p.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    pageHtml = await page.text();
  } catch {
    await setPortalStatus(userId, "nbcrna", null, "failed",
      "NBCRNA verification page did not load — try again later, or check the record manually at nbcrna.com.");
    return json({
      ok: false,
      error: "nbcrna_verify_unavailable",
      message: "The NBCRNA verification page did not load from the server. Nothing was changed — check the record manually at nbcrna.com.",
    }, 502);
  }

  const instance = apexField(pageHtml, "p_instance");
  const submissionId = apexField(pageHtml, "p_page_submission_id");
  if (!instance || !submissionId) {
    await setPortalStatus(userId, "nbcrna", null, "failed",
      "NBCRNA verification page changed format — the submit session could not be read.");
    return json({
      ok: false,
      error: "nbcrna_verify_unavailable",
      message: "The NBCRNA verification page changed format, so the automatic check could not run. Check the record manually at nbcrna.com.",
    }, 502);
  }

  // 2. Submit exactly as the page's apex.submit does.
  const params = new URLSearchParams({
    p_flow_id: apexField(pageHtml, "p_flow_id") || "700",
    p_flow_step_id: apexField(pageHtml, "p_flow_step_id") || "17800",
    p_instance: instance,
    p_page_submission_id: submissionId,
    p_request: "SEARCH",
    p_reload_on_submit: apexField(pageHtml, "p_reload_on_submit"),
    P17800_FIRSTNAME: firstName,
    P17800_LASTNAME: lastName,
    P17800_CERT_NUMBER: certNumber,
    P17800_STATE: state,
    P17800_CITY: "",
    P17800_COUNTRY: "",
    P17800_POSTAL_CD: "",
    P17800_COMPANY_NM: "",
    P17800_SEARCH_FLG: "",
  });
  let resultHtml = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(NBCRNA_ACCEPT_URL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://portal.nbcrna.com/nbcrnassa/f?p=700:17800",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: params.toString(),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`accept_http_${res.status}`);
    resultHtml = await res.text();
  } catch {
    // Observed Nov 5, 2026: wwv_flow.accept 404s server-side. The flow
    // is implemented as documented; until NBCRNA serves the submit, the
    // pull is unproven and reported as such — never faked.
    await setPortalStatus(userId, "nbcrna", null, "failed",
      "NBCRNA verification submit was not accepted by the NBCRNA server (submit endpoint unavailable from the server). No record was pulled.");
    return json({
      ok: false,
      error: "nbcrna_verify_unavailable",
      message: "NBCRNA's verification submit did not answer from the server, so no record was pulled. This check is still unproven — verify the record manually at nbcrna.com, or use the manual entry below.",
    }, 502);
  }

  const match = parseNbcrnaResults(resultHtml);
  if (!match) {
    await setPortalStatus(userId, "nbcrna", null, "failed",
      `No NBCRNA record matched "${firstName} ${lastName}"${certNumber ? ` (cert ${certNumber})` : ""}. Check the spelling, or verify manually at nbcrna.com.`);
    return json({
      ok: false,
      error: "nbcrna_no_match",
      message: `No NBCRNA certification record matched that name${certNumber ? " and certification number" : ""}. Check the spelling, or verify manually at nbcrna.com.`,
    }, 404);
  }

  // 3. Store the pulled facts, labelled with source + retrieval date.
  // Credit totals are NOT in the public verification — they stay as the
  // user entered them (columns omitted, so merge-duplicates leaves them).
  const syncedAt = nowIso();
  await sbUpsert("nbcrna_profiles", {
    user_id: userId,
    certification_status: "Certified",
    certification_number: match.certNumber || certNumber || null,
    period_end: match.expDate,
    renewal_deadline: match.expDate,
    source: "public_verification",
    last_synced_at: syncedAt,
  }, "user_id");
  await setPortalStatus(userId, "nbcrna", null, "connected", null);
  return json({
    ok: true,
    source: "public_verification",
    retrievedAt: syncedAt,
    record: {
      certification_status: "Certified",
      certification_number: match.certNumber || certNumber || null,
      certification_type: match.certType,
      period_end: match.expDate,
      renewal_deadline: match.expDate,
      state_country: match.stateCountry,
      note: "Public verification only — CPC / MAC Ed / MAC Dev / CE totals are not published here and still need the NBCRNA member portal or your manual record.",
    },
  });
}

// --- State license verification ---

const STATE_NAMES: Record<string, string> = {
  WV: "West Virginia", OH: "Ohio", FL: "Florida", PA: "Pennsylvania",
  VA: "Virginia", KY: "Kentucky", MD: "Maryland", NC: "North Carolina",
  TN: "Tennessee", IN: "Indiana", MI: "Michigan",
};

function normalizeState(raw: string): { abbr: string; name: string } | null {
  const t = clean(raw).toUpperCase();
  if (!t) return null;
  if (STATE_NAMES[t]) return { abbr: t, name: STATE_NAMES[t] };
  for (const [abbr, name] of Object.entries(STATE_NAMES)) {
    if (name.toUpperCase() === t) return { abbr, name };
  }
  // Unknown state: keep the raw text as the name; only WV/OH have
  // known blocked lookups, everything else is unsupported.
  return { abbr: t.slice(0, 2), name: clean(raw) };
}

async function handleVerifyLicense(
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const st = normalizeState(String(body.state ?? ""));
  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  if (!st || !firstName || !lastName) return err("missing_fields", 400);

  if (st.abbr === "WV") {
    const msg =
      "The WV Board of Nursing lookup blocks automated checks (bot protection), so CRNA Hub cannot pull it. Open the lookup yourself: " +
      WV_LOOKUP_URL +
      " — or enroll free in Nursys e-Notify (nursys.com) for push alerts when your license status or expiry changes.";
    await setPortalStatus(userId, "state_board", st.abbr, "failed", msg);
    return json({
      ok: false,
      error: "state_verify_blocked",
      portal: "state_board",
      state: st.abbr,
      manualUrl: WV_LOOKUP_URL,
      message: msg,
    }, 502);
  }
  if (st.abbr === "OH") {
    const msg =
      "Ohio eLicense is a JavaScript app with no public API, so CRNA Hub cannot pull it. Open the lookup yourself: " +
      OH_LOOKUP_URL +
      " — or enroll free in Nursys e-Notify (nursys.com) for push alerts when your license status or expiry changes.";
    await setPortalStatus(userId, "state_board", st.abbr, "failed", msg);
    return json({
      ok: false,
      error: "state_verify_blocked",
      portal: "state_board",
      state: st.abbr,
      manualUrl: OH_LOOKUP_URL,
      message: msg,
    }, 502);
  }
  // No verified public source is implemented for this state. Nursys
  // QuickConfirm is RN/PN only and explicitly does not verify APRN
  // licenses, so it is never claimed as a pull here.
  const msg =
    `No automated public lookup is wired for ${st.name} yet, and Nursys does not verify APRN licenses. Check the ${st.name} Board of Nursing license lookup manually and enter the dates below, or enroll free in Nursys e-Notify (nursys.com) for status/expiry alerts.`;
  await setPortalStatus(userId, "state_board", st.abbr, "failed", msg);
  return json({
    ok: false,
    error: "state_verify_unsupported",
    portal: "state_board",
    state: st.abbr,
    message: msg,
  }, 502);
}

// --- Router ---

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = url.searchParams.get("action") ?? "";
      if (action === "config") {
        // Public booleans/labels only — no user data, no token needed.
        return json({
          ok: true,
          sources: {
            nbcrna: "unproven",
            aana: "signin-required",
            wv: "blocked",
            ohio: "blocked",
          },
          note: "NBCRNA public verification is implemented but unproven (its submit endpoint 404s server-side as of Nov 5, 2026). AANA needs a member sign-in that is bot-gated. WV and Ohio board lookups block automation. Final native design: sign-in happens in Apple's system sign-in sheet, never through this server — the former server-side AANA password endpoint was deleted Nov 5, 2026 — sign-in happens only in the system sign-in sheet.",
        });
      }
      const userId = await authUserId(req);
      if (!userId) return err("not_signed_in", 401);
      if (action === "status") {
        const rows = await sbGet(
          "portal_connections",
          `select=portal,state,status,last_synced_at,last_error&user_id=eq.${encodeURIComponent(userId)}&order=portal.asc`,
        );
        return json({ ok: true, connections: rows });
      }
      return err("unknown_action", 400);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const userId = await authUserId(req);
      if (!userId) return err("not_signed_in", 401);
      try {
        if (body.action === "verify-nbcrna") return await handleVerifyNbcrna(userId, body);
        if (body.action === "verify-license") return await handleVerifyLicense(userId, body);
        return err("unknown_action", 400);
      } catch (e) {
        // Unexpected throw before the handler recorded an outcome: mark
        // the attempt failed so no stale 'connected' row can survive it.
        try {
          if (body.action === "verify-nbcrna") {
            await setPortalStatus(userId, "nbcrna", null, "failed", "The NBCRNA check failed before it could finish — no record was pulled.");
          } else if (body.action === "verify-license") {
            const st = normalizeState(String(body.state ?? ""));
            if (st) await setPortalStatus(userId, "state_board", st.abbr, "failed", "The license check failed before it could finish — no record was pulled.");
          }
        } catch { /* status write itself failed; nothing more to do */ }
        throw e;
      }
    }
    return err("method_not_allowed", 405);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "portal_failed";
    if (msg === "encryption_not_configured") return err(msg, 503);
    return err("portal_failed", 502);
  }
});
