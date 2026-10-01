import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  type CalendarEventV1,
  parseCalendarEventDateTime,
} from "@murphai/contracts";

export interface CalendarEventPresentation {
  dateLabel: string;
  day: string;
  endsLabel: string;
  month: string;
  startsLabel: string;
  timeZoneLabel: string;
}

export function buildICalendar(
  event: CalendarEventV1,
  createdAt = new Date(),
): string {
  const startsAt = parseCalendarEventDateTime(event.startsAt);
  const endsAt = parseCalendarEventDateTime(event.endsAt);
  if (startsAt === null || endsAt === null || endsAt.instant <= startsAt.instant) {
    throw new TypeError("Expected a valid calendar event interval.");
  }

  const uid = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Murph//Calendar Link//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}@withmurph.ai`,
    `DTSTAMP:${formatUtc(createdAt.getTime())}`,
    `DTSTART:${formatUtc(startsAt.instant)}`,
    `DTEND:${formatUtc(endsAt.instant)}`,
    `SUMMARY:${escapeICalendarText(event.title)}`,
    ...(event.location
      ? [`LOCATION:${escapeICalendarText(event.location)}`]
      : []),
    ...(event.notes
      ? [`DESCRIPTION:${escapeICalendarText(event.notes)}`]
      : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.flatMap(foldICalendarLine).join("\r\n")}\r\n`;
}

export function presentCalendarEvent(
  event: CalendarEventV1,
): CalendarEventPresentation {
  const startsAt = requireCalendarDateTime(event.startsAt);
  const endsAt = requireCalendarDateTime(event.endsAt);
  const sameDay = startsAt.year === endsAt.year
    && startsAt.month === endsAt.month
    && startsAt.day === endsAt.day;

  return {
    dateLabel: formatWallDate(startsAt, "long"),
    day: String(startsAt.day),
    endsLabel: sameDay
      ? formatWallTime(endsAt)
      : `${formatWallDate(endsAt, "short")}, ${formatWallTime(endsAt)}`,
    month: formatWallDate(startsAt, "month").toUpperCase(),
    startsLabel: formatWallTime(startsAt),
    timeZoneLabel: formatOffset(startsAt.offset),
  };
}

function requireCalendarDateTime(value: string) {
  const parsed = parseCalendarEventDateTime(value);
  if (parsed === null) {
    throw new TypeError("Expected a valid calendar event date-time.");
  }
  return parsed;
}

function formatWallDate(
  value: ReturnType<typeof requireCalendarDateTime>,
  style: "long" | "month" | "short",
): string {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  return new Intl.DateTimeFormat("en-US", {
    day: style === "month" ? undefined : "numeric",
    month: style === "long" ? "long" : "short",
    timeZone: "UTC",
    weekday: style === "long" ? "long" : undefined,
    year: style === "long" ? "numeric" : undefined,
  }).format(date);
}

function formatWallTime(
  value: ReturnType<typeof requireCalendarDateTime>,
): string {
  const date = new Date(Date.UTC(2000, 0, 1, value.hour, value.minute));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: value.minute === 0 ? undefined : "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatOffset(offset: string): string {
  return offset === "Z" ? "UTC" : `UTC${offset.replace("-", "−")}`;
}

function formatUtc(value: number): string {
  return new Date(value).toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function escapeICalendarText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldICalendarLine(line: string): string[] {
  const folded: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (currentBytes + characterBytes > 75) {
      folded.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }
  folded.push(current);
  return folded;
}
