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

function resolveHostedGroupJoinOutreachUtcWindow(
  value: string | null | undefined,
): HostedGroupJoinOutreachUtcWindow | null {
  const phoneNumber = normalizePhoneNumber(value);
  if (!phoneNumber) {
    return null;
  }

  // NANP Pacific territories need separate handling from the Americas.
  if (phoneNumber.startsWith("+1670") || phoneNumber.startsWith("+1671")) {
    return hours(19, 13);
  }
  if (phoneNumber.startsWith("+1684")) {
    return hours(16, 10);
  }
  if (phoneNumber.startsWith("+1")) {
    return hours(16, 1);
  }

  if (phoneNumber.startsWith("+44")) return hours(6, 21);
  if (
    phoneNumber.startsWith("+33")
    || phoneNumber.startsWith("+34")
    || phoneNumber.startsWith("+39")
    || phoneNumber.startsWith("+49")
  ) {
    return hours(6, 20);
  }
  if (phoneNumber.startsWith("+27")) return hours(5, 20);
  if (phoneNumber.startsWith("+234")) return hours(5, 21);

  if (phoneNumber.startsWith("+52")) return hours(14, 3);
  if (phoneNumber.startsWith("+54")) return hours(9, 1);
  if (phoneNumber.startsWith("+55")) return hours(12, 0);

  if (phoneNumber.startsWith("+61")) return hours(23, 11);
  if (phoneNumber.startsWith("+64")) return hours(18, 9);
  if (phoneNumber.startsWith("+81") || phoneNumber.startsWith("+82")) {
    return hours(21, 13);
  }
  if (phoneNumber.startsWith("+86")) return hours(22, 14);
  if (phoneNumber.startsWith("+91")) return hours(0, 17);

  return null;
}

function hours(
  startHourUtc: number,
  endHourUtc: number,
): HostedGroupJoinOutreachUtcWindow {
  return {
    endMinuteUtc: endHourUtc * 60,
    startMinuteUtc: startHourUtc * 60,
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
