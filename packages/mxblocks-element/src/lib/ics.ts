// RFC 5545 iCalendar for the event block's "Add to calendar" (client-side download).

/** TEXT value escaping (backslash, semicolon, comma, newline). */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (UTF-8), continuation lines start with a space. */
export function icsFold(lineText: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of lineText) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines carry a leading space
    if (curLen + n > limit) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** UTC date-time: 20261015T100000Z. */
export function icsDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}

/** Local calendar date: 20261015 (all-day events use the viewer's date). */
export function icsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

export interface IcsEvent {
  title: string;
  start: number;
  end: number | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
}

export function toIcs(ev: IcsEvent, uid: string, now: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mxblocks//mxblocks-element//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDateTime(now)}`,
  ];
  if (ev.all_day) {
    const end = ev.end ?? ev.start;
    // DTEND is exclusive for all-day events: the day after the last day.
    lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end + 86_400_000)}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(ev.start)}`);
    lines.push(`DTEND:${icsDateTime(ev.end ?? ev.start + 3_600_000)}`);
  }
  lines.push(`SUMMARY:${icsEscape(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
