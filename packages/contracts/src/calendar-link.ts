import * as z from "./zod-runtime.ts";

import { MURPH_PRODUCT_ORIGIN } from "./constants.ts";

export const CALENDAR_LINK_PATH_PREFIX = "/calendar/";
export const CALENDAR_LINK_URL_PREFIX =
  `${MURPH_PRODUCT_ORIGIN}${CALENDAR_LINK_PATH_PREFIX}`;
export const CALENDAR_LINK_URL_MAX_LENGTH = 2_048;

export const calendarEventV1Bounds = {
  title: 160,
  location: 240,
  notes: 600,
} as const;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SINGLE_LINE_PATTERN =
  /^[^\u0000-\u001F\u007F\u2028\u2029\r\n]+$/u;
const MULTILINE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function singleLineText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: "Expected text without surrounding whitespace.",
    })
    .regex(SINGLE_LINE_PATTERN, "Expected one printable line of text.");
}

const notesSchema = z
  .string()
  .min(1)
  .max(calendarEventV1Bounds.notes)
  .refine((value) => value === value.trim(), {
    message: "Expected text without surrounding whitespace.",
  })
  .refine((value) => !MULTILINE_CONTROL_PATTERN.test(value), {
    message: "Expected printable text.",
  });

const calendarDateTimeSchema = z
  .string()
  .max(35)
  .refine((value) => parseCalendarEventDateTime(value) !== null, {
    message: "Expected a valid RFC 3339 date-time with an explicit UTC offset.",
  });

export const calendarEventV1Schema = z
  .object({
    title: singleLineText(calendarEventV1Bounds.title),
    startsAt: calendarDateTimeSchema,
    endsAt: calendarDateTimeSchema,
    location: singleLineText(calendarEventV1Bounds.location).optional(),
    notes: notesSchema.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const startsAt = parseCalendarEventDateTime(event.startsAt);
    const endsAt = parseCalendarEventDateTime(event.endsAt);
    if (
      startsAt !== null
      && endsAt !== null
      && endsAt.instant <= startsAt.instant
    ) {
      context.addIssue({
        code: "custom",
        message: "Calendar event end time must be after its start time.",
        path: ["endsAt"],
      });
    }
  });

export type CalendarEventV1 = z.infer<typeof calendarEventV1Schema>;

const calendarLinkEnvelopeV1Schema = z
  .object({
    version: z.literal(1),
    event: calendarEventV1Schema,
  })
  .strict();

export interface CalendarEventDateTime {
  day: number;
  hour: number;
  instant: number;
  minute: number;
  month: number;
  offset: string;
  second: number;
  year: number;
}

export function parseCalendarEventDateTime(
  value: string,
): CalendarEventDateTime | null {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const offset = match[8] ?? "Z";
  const offsetHours = Number(match[10] ?? 0);
  const offsetMinutes = Number(match[11] ?? 0);
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > maximumDay
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHours > 14
    || offsetMinutes > 59
    || (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    return null;
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetMilliseconds = offset === "Z"
    ? 0
    : offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000;

  return {
    day,
    hour,
    instant: local.getTime() - offsetMilliseconds,
    minute,
    month,
    offset,
    second,
    year,
  };
}

export function buildCalendarEventUrl(event: CalendarEventV1): string {
  const parsed = calendarEventV1Schema.parse(event);
  const payload = encodeBase64Url(JSON.stringify({
    version: 1,
    event: parsed,
  }));
  const url = `${CALENDAR_LINK_URL_PREFIX}${payload}`;
  if (url.length >= CALENDAR_LINK_URL_MAX_LENGTH) {
    throw new TypeError("The calendar event exceeds the Messages link limit.");
  }
  return url;
}

export function parseCalendarEventPayload(payload: string): CalendarEventV1 | null {
  if (
    payload.length === 0
    || payload.length >= CALENDAR_LINK_URL_MAX_LENGTH
    || !BASE64URL_PATTERN.test(payload)
  ) {
    return null;
  }

  try {
    const json = decodeBase64Url(payload);
    if (encodeBase64Url(json) !== payload) {
      return null;
    }
    const parsed = calendarLinkEnvelopeV1Schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.event : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
