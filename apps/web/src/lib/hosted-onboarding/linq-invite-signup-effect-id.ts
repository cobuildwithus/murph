import { resolveHostedLinqDayUtc } from "./linq-daily-state";

const HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX = "linq-invite-signup:";
const HOSTED_LINQ_INVITE_SIGNUP_ATTEMPT_SUFFIX_PATTERN = /:a([2-9]\d*)$/;

/**
 * One signup-link delivery per member per UTC day is the base identity; a
 * terminal provider failure reopens the day and the retry runs as attempt
 * N+1 with its own effect id, so the provider idempotency key differs per
 * attempt and Linq cannot dedupe a retry against the dead message. Attempt 1
 * carries no suffix so pre-existing delivery rows keep their identity.
 */
export function buildHostedLinqInviteSignupEffectId(input: {
  attempt?: number;
  memberId: string;
  occurredAt: Date | string;
}): string {
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt).toISOString();
  const base = `${HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX}${input.memberId}:${dayUtc}`;
  return typeof input.attempt === "number" && input.attempt > 1
    ? `${base}:a${input.attempt}`
    : base;
}

export function parseHostedLinqInviteSignupEffectId(
  id: string | null | undefined,
): { attempt: number; dayUtc: string; memberId: string } | null {
  if (!id?.startsWith(HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX)) {
    return null;
  }

  const attemptMatch = HOSTED_LINQ_INVITE_SIGNUP_ATTEMPT_SUFFIX_PATTERN.exec(id);
  const attempt = attemptMatch ? Number.parseInt(attemptMatch[1] ?? "", 10) : 1;
  const body = (attemptMatch ? id.slice(0, attemptMatch.index) : id)
    .slice(HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX.length);
  const firstColonIndex = body.indexOf(":");
  if (firstColonIndex <= 0) {
    return null;
  }

  const memberId = body.slice(0, firstColonIndex);
  const dayUtc = body.slice(firstColonIndex + 1);
  if (!memberId || Number.isNaN(new Date(dayUtc).getTime())) {
    return null;
  }

  return {
    attempt,
    dayUtc,
    memberId,
  };
}
