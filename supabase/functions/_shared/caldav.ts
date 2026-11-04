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
  if (href.startsWith("http")) return href.replace(/&amp;/g, "&");
  return `${CALDAV_HOST}${href}`;
}

// Returns the URL of the "CRNA Hub" calendar, creating it if needed.
export async function ensureAppleCalendar(
  appleId: string,
  password: string,
): Promise<string> {
  const root = await dav(CALDAV_HOST + "/", appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`, "0");
  if (root.status === 401) throw new Error("apple_auth_failed");
  if (!root.ok) throw new Error("apple_dav_failed");
  const rootXml = await root.text();
  const inner = /<d:current-user-principal>[\s\S]*?<d:href>([^<]+)<\/d:href>/i.exec(rootXml)?.[1];
  const principalUrl = inner ? absHref(inner) : null;
  if (!principalUrl) throw new Error("apple_dav_failed");
  const homeRes = await dav(principalUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`, "0");
  if (!homeRes.ok) throw new Error("apple_dav_failed");
  const homeXml = await homeRes.text();
  const homeHref = /<c:calendar-home-set>[\s\S]*?<d:href>([^<]+)<\/d:href>/i.exec(homeXml)?.[1];
  if (!homeHref) throw new Error("apple_dav_failed");
  const homeUrl = absHref(homeHref);
  const listRes = await dav(homeUrl, appleId, password, "PROPFIND",
    `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, "1");
  if (!listRes.ok) throw new Error("apple_dav_failed");
  const listXml = await listRes.text();
  const responses = listXml.split(/<d:response>/i).slice(1);
  for (const resp of responses) {
    const isCalendar = /<c:calendar\s*\/>/i.test(resp);
    const name = /<d:displayname>([^<]*)<\/d:displayname>/i.exec(resp)?.[1];
    const href = /<d:href>([^<]+)<\/d:href>/i.exec(resp)?.[1];
    if (isCalendar && name === "CRNA Hub" && href) return absHref(href);
  }
  const newUrl = homeUrl.replace(/\/?$/, "/") + "crna-hub/";
  const mk = await dav(newUrl, appleId, password, "MKCALENDAR",
    `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>CRNA Hub</d:displayname></d:prop></d:set></c:mkcalendar>`, null);
  if (mk.ok || mk.status === 405) return newUrl;
  throw new Error("apple_calendar_create_failed");
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
  for (const resp of xml.split(/<d:response>/i).slice(1)) {
    const href = /<d:href>([^<]+)<\/d:href>/i.exec(resp)?.[1];
    const etag = /<d:getetag>([^<]+)<\/d:getetag>/i.exec(resp)?.[1];
    if (!href || href.replace(/\/$/, "") === calendarUrl.replace(/\/$/, "")) continue;
    if (etag && knownEtags.get(href) === etag) continue;
    const get = await dav(absHref(href), appleId, password, "GET", null, null, "text/calendar");
    if (!get.ok) continue;
    const ev = parseIcsEvent(await get.text(), href);
    if (ev) events.push(ev);
  }
  return { events, deletedIds: [], syncToken: null };
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
