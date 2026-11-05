// Apple Calendar (CalDAV) helpers for sync-calendar.
// Apple offers no OAuth for third-party calendar apps, so CalDAV with an
// app-specific password is the only route — and that password is handled
// exactly like an OAuth refresh token: encrypted server-side on first
// setup, never returned to the browser, never logged, never stored in the
// repo. The browser sends it once, over HTTPS, to sync-calendar's
// connect-apple action; the function validates it with a PROPFIND and
// only then stores the ciphertext.
//
// Discovery: principal -> calendar-home-set -> calendars; find (or create
// with MKCALENDAR) the calendar named "CRNA Hub". Sync: REPORT
// sync-collection when the server offers a sync-token, otherwise a full
// PROPFIND of etags with a GET only for changed items.

import {
  LocalShift,
  ProviderEvent,
  nextDay,
  parseDescription,
  parseTitle,
  shiftDescription,
  shiftTitle,
} from "./calendar.ts";

const CALDAV_HOST = "https://caldav.icloud.com";

function basicAuth(appleId: string, password: string): string {
  return "Basic " + btoa(`${appleId}:${password}`);
}

async function dav(
  url: string,
  appleId: string,
  password: string,
  method: string,
  body: string | null,
  depth: string | null,
  contentType = "application/xml; charset=utf-8",
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(appleId, password),
    "Content-Type": contentType,
  };
  if (depth !== null) headers.Depth = depth;
  return await fetch(url, { method, headers, body });
}

function absHref(href: string): string {
  const h = href.replace(/&amp;/g, "&").trim();
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("//")) return "https:" + h;
  return `${CALDAV_HOST}${h.startsWith("/") ? h : "/" + h}`;
}

// Resolve an href against the URL that returned it. iCloud's discovery
// answers live on a per-account pXX-caldav.icloud.com host; resolving a
// relative href against the generic caldav.icloud.com host instead would
// send the next request to the wrong host (the discovery host only
// redirects, and a MKCALENDAR must not go through a redirect).
function resolveHref(href: string, base: string): string {
  const h = href.replace(/&amp;/g, "&").trim();
  try {
    return new URL(h, base).href;
  } catch {
    return absHref(h);
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// iCloud (and other CalDAV servers) vary the XML namespace prefix
// (D:, d:, dav:, or no prefix at all) and sometimes emit a closing tag
// instead of a self-closing one. Match on the tag LOCAL name only, so a
// prefix change can never silently break discovery again.
function elementContent(xml: string, local: string): string | null {
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)<\/(?:[A-Za-z_][\\w.-]*:)?${local}>`,
    "i",
  );
  return re.exec(xml)?.[1] ?? null;
}

function firstHref(fragment: string): string | null {
  const m = /<(?:[A-Za-z_][\w.-]*:)?href(?:\s[^>]*)?>([^<]+)<\/(?:[A-Za-z_][\w.-]*:)?href>/i.exec(fragment);
  return m ? decodeXml(m[1].trim()) : null;
}

function stepError(step: string, status: number): Error {
  return new Error(`apple_${step}_${status}`);
}

function checkDav(res: Response, step: string): void {
  if (res.status === 401) throw new Error("apple_auth_failed");
  if (!res.ok) throw stepError(step, res.status);
}

// A discovered iCloud calendar: its server URL and its display name.
// The URL is what sync stores (calendar_id); the name is only shown to
// the user when they have to pick a calendar.
export interface AppleCalendarInfo {
  url: string;
  name: string | null;
}

// Discovery only: principal -> calendar-home-set -> calendar list.
// Returns the home-set URL plus every calendar collection found there.
// Throws the same step-specific errors as ensureAppleCalendar.
export async function discoverAppleCalendars(
  appleId: string,
  password: string,
): Promise<{ homeUrl: string; calendars: AppleCalendarInfo[] }> {
  const root = await dav(CALDAV_HOST + "/", appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, "0");
  checkDav(root, "principal_failed");
  const rootXml = await root.text();
  const principalSection = elementContent(rootXml, "current-user-principal");
  if (principalSection && /<(?:[A-Za-z_][\w.-]*:)?unauthenticated/i.test(principalSection)) {
    throw new Error("apple_auth_failed");
  }
  const principalHref = principalSection ? firstHref(principalSection) : null;
  if (!principalHref) throw new Error("apple_principal_missing");
  const principalUrl = resolveHref(principalHref, CALDAV_HOST + "/");
  const homeRes = await dav(principalUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`, "0");
  checkDav(homeRes, "home_failed");
  const homeXml = await homeRes.text();
  const homeSection = elementContent(homeXml, "calendar-home-set");
  const homeHref = homeSection ? firstHref(homeSection) : null;
  if (!homeHref) throw new Error("apple_home_missing");
  const homeUrl = resolveHref(homeHref, principalUrl);
  const listRes = await dav(homeUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, "1");
  checkDav(listRes, "list_failed");
  const listXml = await listRes.text();
  const responses = listXml.split(/<(?:[A-Za-z_][\w.-]*:)?response(?:\s[^>]*)?>/i).slice(1);
  const norm = (u: string) => u.replace(/\/$/, "");
  const calendars: AppleCalendarInfo[] = [];
  for (const resp of responses) {
    const href = firstHref(resp);
    if (!href) continue;
    const url = resolveHref(href, homeUrl);
    if (norm(url) === norm(homeUrl)) continue;
    const typeSection = elementContent(resp, "resourcetype");
    const isCalendar = !!typeSection &&
      /<(?:[A-Za-z_][\w.-]*:)?calendar(?:[\s/>])/i.test(typeSection);
    if (!isCalendar) continue;
    const nameRaw = elementContent(resp, "displayname");
    calendars.push({ url, name: nameRaw !== null ? decodeXml(nameRaw) : null });
  }
  return { homeUrl, calendars };
}

// Verify a user-chosen existing calendar URL: it must sit under the
// account's calendar home-set and be a calendar collection. Used by the
// pick-an-existing-calendar fallback in connect-apple.
export async function verifyAppleCalendar(
  appleId: string,
  password: string,
  calendarUrl: string,
): Promise<string> {
  const { homeUrl } = await discoverAppleCalendars(appleId, password);
  const norm = (u: string) => u.replace(/\/$/, "");
  if (!norm(calendarUrl).startsWith(norm(homeUrl))) {
    throw new Error("apple_calendar_not_found");
  }
  const res = await dav(calendarUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`, "0");
  if (res.status === 401) throw new Error("apple_auth_failed");
  if (!res.ok) throw stepError("calendar_verify_failed", res.status);
  const xml = await res.text();
  const typeSection = elementContent(xml, "resourcetype");
  const isCalendar = !!typeSection &&
    /<(?:[A-Za-z_][\w.-]*:)?calendar(?:[\s/>])/i.test(typeSection);
  if (!isCalendar) throw new Error("apple_calendar_not_found");
  return calendarUrl;
}

// Returns the URL of the "CRNA Hub" calendar, creating it if needed.
// Each discovery step has its own error code (with the HTTP status) so a
// failure names the step instead of collapsing into apple_dav_failed:
//   apple_principal_failed_<status> / apple_principal_missing
//   apple_home_failed_<status>      / apple_home_missing
//   apple_list_failed_<status>
//   apple_calendar_create_failed_<status>
// A 401 at ANY step is apple_auth_failed (bad Apple ID / app-specific
// password), never a discovery error.
//
// Why the create URL is a UUID: iCloud calendar collections are
// addressed by a UUID under the calendar home-set
// (https://pXX-caldav.icloud.com/<dsid>/calendars/<UUID>/), the form
// Apple's own clients use. The previous code asked iCloud to create a
// collection at a friendly slug ("crna-hub"), which iCloud refuses with
// 403 — authentication had already passed, so it was never a password
// problem. If creation is still refused, the thrown error carries the
// discovered calendars on (error as any).calendars so the caller can
// offer "pick an existing calendar" instead of failing the connect.
export async function ensureAppleCalendar(
  appleId: string,
  password: string,
): Promise<string> {
  const { homeUrl, calendars } = await discoverAppleCalendars(appleId, password);
  for (const cal of calendars) {
    if (cal.name === "CRNA Hub") return cal.url;
  }
  const newUrl = homeUrl.replace(/\/?$/, "/") + crypto.randomUUID() + "/";
  const fullBody = `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>CRNA Hub</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
  const minimalBody = `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>CRNA Hub</d:displayname></d:prop></d:set></c:mkcalendar>`;
  for (const body of [fullBody, minimalBody]) {
    const mk = await dav(newUrl, appleId, password, "MKCALENDAR", body, null);
    if (mk.ok || mk.status === 405) return newUrl;
    if (mk.status === 401) throw new Error("apple_auth_failed");
    // Only retry with the minimal body; a second 403 (or any other
    // refusal) is the final answer, not a reason to keep hammering.
    if (body === fullBody) continue;
    const e = stepError("calendar_create_failed", mk.status);
    (e as unknown as { calendars: AppleCalendarInfo[] }).calendars = calendars;
    throw e;
  }
  // Unreachable: the loop always returns or throws.
  throw new Error("apple_dav_failed");
}

function icsEscape(t: string): string {
  return String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsUnescape(t: string): string {
  return String(t ?? "").replace(/\\n/g, "\n").replace(/\\,/g, ",")
    .replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function shiftToIcs(s: LocalShift): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "") + "Z";
  const desc = icsEscape(shiftDescription(s));
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CRNA Hub//Calendar Sync//EN",
    "BEGIN:VEVENT",
    `UID:${s.id}@crna-hub`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${s.date.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${nextDay(s.date).replace(/-/g, "")}`,
    `SUMMARY:${icsEscape(shiftTitle(s))}`,
    `DESCRIPTION:${desc}`,
    `LAST-MODIFIED:${stamp}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function unfoldIcs(ics: string): string[] {
  const raw = ics.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else out.push(line);
  }
  return out;
}

export function parseIcsEvent(ics: string, _fallbackHref: string): ProviderEvent | null {
  const lines = unfoldIcs(ics);
  let inEvent = false;
  const props: Record<string, string> = {};
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { inEvent = true; continue; }
    if (line === "END:VEVENT") break;
    if (!inEvent) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).split(";")[0];
    props[key] = line.slice(i + 1);
  }
  if (!props.UID) return null;
  const start = props.DTSTART ?? "";
  const date = start.length >= 8
    ? `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`
    : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { facility, type } = parseTitle(icsUnescape(props.SUMMARY ?? ""));
  const parsed = parseDescription(icsUnescape(props.DESCRIPTION ?? ""));
  const shiftId = props.UID.endsWith("@crna-hub")
    ? props.UID.slice(0, -"@crna-hub".length)
    : parsed.shiftId;
  let updatedAt: string | null = null;
  const lm = props["LAST-MODIFIED"] ?? "";
  if (/^\d{8}T\d{6}Z$/.test(lm)) {
    updatedAt = `${lm.slice(0, 4)}-${lm.slice(4, 6)}-${lm.slice(6, 8)}T${lm.slice(9, 11)}:${lm.slice(11, 13)}:${lm.slice(13, 15)}Z`;
  }
  return {
    providerEventId: props.UID,
    date,
    facility,
    type: parsed.type || type,
    pay: parsed.pay,
    note: parsed.note,
    shiftId,
    updatedAt,
    cancelled: props.STATUS === "CANCELLED",
    rawUpdatedAt: updatedAt,
    // Raw title, kept for the work-calendar import: parseTitle above
    // splits "Holzer 8" into facility "Holzer 8" / type "Shift", which
    // is wrong for import — parseWorkShiftTitle needs the raw title.
    summary: icsUnescape(props.SUMMARY ?? ""),
  };
}

// Fetch changed events. Returns { events, deletedIds, syncToken }.
// Prefers REPORT sync-collection; falls back to a full etag scan.
export async function fetchAppleEvents(
  calendarUrl: string,
  appleId: string,
  password: string,
  syncToken: string | null,
  knownEtags: Map<string, string>,
): Promise<{ events: ProviderEvent[]; deletedIds: string[]; syncToken: string | null }> {
  if (syncToken) {
    const report = await dav(calendarUrl, appleId, password, "REPORT",
      `<?xml version="1.0"?><c:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><c:sync-token>${syncToken.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:sync-token><c:sync-level>1</c:sync-level><d:prop><d:getetag/><c:calendar-data/></d:prop></c:sync-collection>`, null);
    if (report.ok) {
      const xml = await report.text();
      const token = /<c:sync-token>([^<]+)<\/c:sync-token>/i.exec(xml)?.[1] ?? null;
      const events: ProviderEvent[] = [];
      const deletedIds: string[] = [];
      for (const resp of xml.split(/<d:response>/i).slice(1)) {
        const href = /<d:href>([^<]+)<\/d:href>/i.exec(resp)?.[1];
        const status = /<d:status>HTTP\/1\.1 (\d{3})/i.exec(resp)?.[1];
        const data = /<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/i.exec(resp)?.[1];
        if (!href) continue;
        if (status === "404") { deletedIds.push(href); continue; }
        if (data) {
          const ev = parseIcsEvent(data.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), href);
          if (ev) events.push(ev);
        }
      }
      return { events, deletedIds, syncToken: token };
    }
    // Server does not support sync-collection: fall through to full scan.
  }
  const list = await dav(calendarUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`, "1");
  if (list.status === 401) throw new Error("apple_auth_failed");
  if (!list.ok) throw new Error("apple_dav_failed");
  const xml = await list.text();
  const events: ProviderEvent[] = [];
  // Collect first, then fetch in parallel batches: the old code awaited
  // one GET per event in sequence, so a calendar with ~100 events took
  // 30-80s of iCloud round trips and the sync proxy gave up at 25s
  // ("upstream_unreachable"). Eight at a time keeps it to a few seconds.
  const targets: string[] = [];
  for (const resp of xml.split(/<(?:[A-Za-z_][\w.-]*:)?response(?:\s[^>]*)?>/i).slice(1)) {
    const href = firstHref(resp);
    const etagRaw = elementContent(resp, "getetag");
    const etag = etagRaw !== null ? decodeXml(etagRaw) : undefined;
    if (!href || href.replace(/\/$/, "") === calendarUrl.replace(/\/$/, "")) continue;
    if (etag && knownEtags.get(href) === etag) continue;
    targets.push(href);
  }
  for (let i = 0; i < targets.length; i += 8) {
    const batch = await Promise.all(targets.slice(i, i + 8).map(async (href) => {
      const get = await dav(resolveHref(href, calendarUrl), appleId, password, "GET", null, null, "text/calendar");
      if (!get.ok) return null;
      return parseIcsEvent(await get.text(), href);
    }));
    for (const ev of batch) if (ev) events.push(ev);
  }
  return { events, deletedIds: [], syncToken: null };
}

// Full-calendar read in ONE request: a calendar-query REPORT with a
// time-range returns every event's ICS inline, instead of one PROPFIND
// plus one GET per event. This is what the work-calendar import uses:
// "Caleb Work Schedule" holds 100+ events, and fetching them one at a
// time is what pushed a sync past the proxy's 25s limit (the observed
// "upstream_unreachable"). Returns null when the server refuses the
// REPORT, so the caller can fall back to the etag scan above; a 401
// still throws apple_auth_failed.
export async function fetchAppleCalendarRange(
  calendarUrl: string,
  appleId: string,
  password: string,
  start: string,
  end: string,
): Promise<ProviderEvent[] | null> {
  const report = await dav(calendarUrl, appleId, password, "REPORT",
    `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, null);
  if (report.status === 401) throw new Error("apple_auth_failed");
  if (!report.ok) return null;
  const xml = await report.text();
  const events: ProviderEvent[] = [];
  for (const resp of xml.split(/<(?:[A-Za-z_][\w.-]*:)?response(?:\s[^>]*)?>/i).slice(1)) {
    const dataRaw = elementContent(resp, "calendar-data");
    if (!dataRaw) continue;
    const ev = parseIcsEvent(decodeXml(dataRaw), firstHref(resp) ?? "");
    if (ev) events.push(ev);
  }
  return events;
}

export async function putAppleEvent(
  calendarUrl: string,
  appleId: string,
  password: string,
  shift: LocalShift,
): Promise<void> {
  const url = calendarUrl.replace(/\/?$/, "/") + `${shift.id}.ics`;
  const r = await dav(url, appleId, password, "PUT", shiftToIcs(shift), null, "text/calendar; charset=utf-8");
  if (!r.ok && r.status !== 204 && r.status !== 201) throw new Error("apple_put_failed");
}

export async function deleteAppleEvent(
  calendarUrl: string,
  appleId: string,
  password: string,
  providerEventId: string,
): Promise<void> {
  // Events this sync writes live at <calendar>/<shift id>.ics, and the
  // provider event id for Apple is the ICS UID "<shift id>@crna-hub".
  // A sync-collection href is used verbatim when one is passed instead.
  let url: string;
  if (providerEventId.startsWith("http")) {
    url = providerEventId;
  } else if (providerEventId.endsWith("@crna-hub")) {
    url = calendarUrl.replace(/\/?$/, "/") +
      providerEventId.slice(0, -"@crna-hub".length) + ".ics";
  } else {
    url = calendarUrl.replace(/\/?$/, "/") + providerEventId.replace(/^\//, "");
  }
  const r = await dav(url, appleId, password, "DELETE", null, null);
  if (!r.ok && r.status !== 404) throw new Error("apple_delete_failed");
}
