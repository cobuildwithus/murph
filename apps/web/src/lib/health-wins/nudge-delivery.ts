import { formatTimeZoneDateTimeParts, isStrictIsoDate, resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";
import { HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX } from "@murphai/hosted-execution/orchestration-control";

const NOTIFICATION = "assistant.notification.requested:";
export const HEALTH_WIN_TEXT_MAILBOX_PREFIX = `${NOTIFICATION}${HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX}`;

export function healthWinTextKeys(memberId: string, day: string) {
  const base = `${HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX}${memberId}:${day}`;
  return { base, mailbox: `${NOTIFICATION}${base}` };
}

/** The outbox can segment first, then Linq can send a trailing link and its plain-text fallback. */
export function parseHealthWinTextKey(value: string) {
  const isMailbox = value.startsWith(HEALTH_WIN_TEXT_MAILBOX_PREFIX);
  const prefix = isMailbox ? HEALTH_WIN_TEXT_MAILBOX_PREFIX : HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX;
  if (!value.startsWith(prefix)) return null;
  const match = /^([^:\s]+):(\d{4}-\d\d-\d\d)((?::bubble:(?:0|[1-9]\d*))?(?::link)?(?::fallback)?)$/u.exec(value.slice(prefix.length));
  if (!match) return null;
  const [, memberId, day, suffix] = match;
  if (!memberId || !day || !isStrictIsoDate(day) || (isMailbox && suffix)) return null;
  return { memberId, day, ...healthWinTextKeys(memberId, day) };
}

export function healthWinTextWindow(now: Date, timeZone: string): { day: string; expiresAt: Date } | null {
  try {
    const { dayKey, hour, minute } = formatTimeZoneDateTimeParts(now, timeZone);
    const minutes = hour * 60 + minute;
    if (minutes < 10 * 60 || minutes >= 13 * 60 + 30) return null;
    const end = resolveFloatingIsoTimestampInTimeZone(`${dayKey}T13:30:00`, timeZone);
    return end ? { day: dayKey, expiresAt: new Date(end.timestamp) } : null;
  } catch {
    return null;
  }
}
