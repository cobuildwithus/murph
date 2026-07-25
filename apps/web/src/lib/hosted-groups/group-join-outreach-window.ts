import "server-only";

import { normalizePhoneNumber } from "../hosted-onboarding/phone";

const MINUTES_PER_DAY = 24 * 60;
const UNKNOWN_TIME_ZONE_RETRY_MS = 24 * 60 * 60_000;

type HostedGroupJoinOutreachUtcWindow = {
  endMinuteUtc: number;
  startMinuteUtc: number;
};

export type HostedGroupJoinOutreachSendWindowDecision =
  | { kind: "send_now" }
  | {
      kind: "defer";
      nextAttemptAt: Date;
      reason: "recipient_quiet_hours" | "recipient_timezone_unavailable";
    };

/**
 * Uses only calling-code regions whose plausible civil-zone range has a
 * non-empty intersection outside 23:00-05:00. Unknown or geographically
 * ambiguous codes remain durable deferrals; they are never terminal skips.
 */
export function decideHostedGroupJoinOutreachSendWindow(input: {
  now: Date;
  participantPhoneNumber: string;
}): HostedGroupJoinOutreachSendWindowDecision {
  const recipientWindow = resolveHostedGroupJoinOutreachUtcWindow(
    input.participantPhoneNumber,
  );
  if (!recipientWindow) {
    return {
      kind: "defer",
      nextAttemptAt: new Date(input.now.getTime() + UNKNOWN_TIME_ZONE_RETRY_MS),
      reason: "recipient_timezone_unavailable",
    };
  }

  const currentMinuteUtc = minuteOfUtcDay(input.now);
  if (isMinuteInsideWindow(currentMinuteUtc, recipientWindow)) {
    return { kind: "send_now" };
  }

  return {
    kind: "defer",
    nextAttemptAt: nextWindowStart(input.now, recipientWindow),
    reason: "recipient_quiet_hours",
  };
}

/**
 * Recipient-safe UTC send windows by calling code.
 *
 * Each row is the intersection of 05:00-23:00 across the plausible civil zones
 * for that region, so a send inside the window is outside quiet hours for every
 * zone the code can represent. Codes are matched longest-prefix-first, which is
 * what keeps NANP Pacific territories correct without depending on the order
 * rows happen to be written in. A code absent from this table has no defensible
 * window and defers durably rather than being dropped; widening coverage means
 * adding a row whose window still satisfies the quiet-hours intersection.
 */
const HOSTED_GROUP_JOIN_OUTREACH_SEND_WINDOWS: readonly {
  callingCodes: readonly string[];
  endHourUtc: number;
  startHourUtc: number;
}[] = [
  // NANP Pacific territories sit far outside the Americas' zone range.
  { callingCodes: ["+1670", "+1671"], endHourUtc: 13, startHourUtc: 19 },
  { callingCodes: ["+1684"], endHourUtc: 10, startHourUtc: 16 },
  { callingCodes: ["+1"], endHourUtc: 1, startHourUtc: 16 },
  { callingCodes: ["+44"], endHourUtc: 21, startHourUtc: 6 },
  { callingCodes: ["+33", "+34", "+39", "+49"], endHourUtc: 20, startHourUtc: 6 },
  { callingCodes: ["+27"], endHourUtc: 20, startHourUtc: 5 },
  { callingCodes: ["+234"], endHourUtc: 21, startHourUtc: 5 },
  { callingCodes: ["+52"], endHourUtc: 3, startHourUtc: 14 },
  { callingCodes: ["+54"], endHourUtc: 1, startHourUtc: 9 },
  { callingCodes: ["+55"], endHourUtc: 0, startHourUtc: 12 },
  { callingCodes: ["+61"], endHourUtc: 11, startHourUtc: 23 },
  { callingCodes: ["+64"], endHourUtc: 9, startHourUtc: 18 },
  { callingCodes: ["+81", "+82"], endHourUtc: 13, startHourUtc: 21 },
  { callingCodes: ["+86"], endHourUtc: 14, startHourUtc: 22 },
  { callingCodes: ["+91"], endHourUtc: 17, startHourUtc: 0 },
];

export function resolveHostedGroupJoinOutreachSendWindowCoverage(): readonly {
  callingCodes: readonly string[];
  endHourUtc: number;
  startHourUtc: number;
}[] {
  return HOSTED_GROUP_JOIN_OUTREACH_SEND_WINDOWS;
}

function resolveHostedGroupJoinOutreachUtcWindow(
  value: string | null | undefined,
): HostedGroupJoinOutreachUtcWindow | null {
  const phoneNumber = normalizePhoneNumber(value);
  if (!phoneNumber) {
    return null;
  }

  let matched: { callingCode: string; endHourUtc: number; startHourUtc: number } | null =
    null;
  for (const row of HOSTED_GROUP_JOIN_OUTREACH_SEND_WINDOWS) {
    for (const callingCode of row.callingCodes) {
      if (
        phoneNumber.startsWith(callingCode)
        && callingCode.length > (matched?.callingCode.length ?? 0)
      ) {
        matched = {
          callingCode,
          endHourUtc: row.endHourUtc,
          startHourUtc: row.startHourUtc,
        };
      }
    }
  }
  if (!matched) {
    return null;
  }

  return {
    endMinuteUtc: matched.endHourUtc * 60,
    startMinuteUtc: matched.startHourUtc * 60,
  };
}

function minuteOfUtcDay(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

function isMinuteInsideWindow(
  minuteUtc: number,
  window: HostedGroupJoinOutreachUtcWindow,
): boolean {
  if (window.startMinuteUtc < window.endMinuteUtc) {
    return minuteUtc >= window.startMinuteUtc && minuteUtc < window.endMinuteUtc;
  }

  return minuteUtc >= window.startMinuteUtc || minuteUtc < window.endMinuteUtc;
}

function nextWindowStart(
  now: Date,
  window: HostedGroupJoinOutreachUtcWindow,
): Date {
  const currentMinuteUtc = minuteOfUtcDay(now);
  const startToday = atUtcMinuteOfDay(now, window.startMinuteUtc);
  if (currentMinuteUtc < window.startMinuteUtc) {
    return startToday;
  }

  return new Date(startToday.getTime() + MINUTES_PER_DAY * 60_000);
}

function atUtcMinuteOfDay(value: Date, minuteUtc: number): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    Math.floor(minuteUtc / 60),
    minuteUtc % 60,
  ));
}
