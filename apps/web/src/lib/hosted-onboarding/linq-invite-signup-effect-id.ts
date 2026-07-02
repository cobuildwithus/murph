import { resolveHostedLinqDayUtc } from "./linq-daily-state";

const HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX = "linq-invite-signup:";

export function buildHostedLinqInviteSignupEffectId(input: {
  memberId: string;
  occurredAt: Date | string;
}): string {
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt).toISOString();
  return `${HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX}${input.memberId}:${dayUtc}`;
}

export function parseHostedLinqInviteSignupEffectId(
  id: string | null | undefined,
): { dayUtc: string; memberId: string } | null {
  if (!id?.startsWith(HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX)) {
    return null;
  }

  const body = id.slice(HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX.length);
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
    dayUtc,
    memberId,
  };
}
