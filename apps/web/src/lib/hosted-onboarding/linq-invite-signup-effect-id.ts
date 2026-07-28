import { sha256Hex } from "../primitives";
import { resolveHostedLinqDayUtc } from "./linq-daily-state";

const HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX = "linq-invite-signup:";
const HOSTED_LINQ_INVITE_SIGNUP_ATTEMPT_SUFFIX_PATTERN = /:a([2-9]\d*)$/;
const HOSTED_LINQ_INVITE_SIGNUP_SOURCE_EVENT_SUFFIX_PATTERN =
  /:e([0-9a-f]{32})$/u;

export type HostedLinqInviteSignupGroupJoinReplyContext = {
  outreachId: string;
  repliedAt: string;
};

/**
 * Generic signup links use one member/day identity. A group-aware reply adds
 * the exact inbound event digest so different group intentions never compete
 * for one provider key. A terminal provider failure advances only that
 * identity to attempt N+1.
 */
export function buildHostedLinqInviteSignupEffectId(input: {
  attempt?: number;
  groupJoinOutreachId?: string | null;
  memberId: string;
  occurredAt: Date | string;
  sourceEventDigest?: string | null;
  sourceEventId?: string | null;
  sourceEventIdentity?: boolean;
}): string {
  const dayUtc = resolveHostedLinqDayUtc(input.occurredAt).toISOString();
  const sourceEventDigest = resolveHostedLinqInviteSignupSourceEventDigest(input);
  const base = `${buildHostedLinqInviteSignupEffectIdMemberPrefix(input.memberId)}${dayUtc}${
    sourceEventDigest ? `:e${sourceEventDigest}` : ""
  }`;
  return typeof input.attempt === "number" && input.attempt > 1
    ? `${base}:a${input.attempt}`
    : base;
}

function resolveHostedLinqInviteSignupSourceEventDigest(input: {
  groupJoinOutreachId?: string | null;
  sourceEventDigest?: string | null;
  sourceEventId?: string | null;
  sourceEventIdentity?: boolean;
}): string | null {
  const suppliedDigest = input.sourceEventDigest?.trim() ?? "";
  if (suppliedDigest) {
    if (!/^[0-9a-f]{32}$/u.test(suppliedDigest)) {
      throw new TypeError(
        "Hosted Linq signup source-event digest must be 32 lowercase hex characters.",
      );
    }
    return suppliedDigest;
  }

  if (
    input.sourceEventIdentity !== true
    && !input.groupJoinOutreachId?.trim()
  ) {
    return null;
  }
  const sourceEventId = input.sourceEventId?.trim() ?? "";
  if (!sourceEventId) {
    throw new TypeError(
      "Hosted Linq group-aware signup identity requires a source event id.",
    );
  }
  return sha256Hex(sourceEventId).slice(0, 32);
}

export function buildHostedLinqInviteSignupEffectIdMemberPrefix(
  memberId: string,
): string {
  return `${HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX}${memberId}:`;
}

export function parseHostedLinqInviteSignupEffectId(
  id: string | null | undefined,
): {
  attempt: number;
  dayUtc: string;
  memberId: string;
  sourceEventDigest: string | null;
} | null {
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
  const identity = body.slice(firstColonIndex + 1);
  const sourceEventMatch =
    HOSTED_LINQ_INVITE_SIGNUP_SOURCE_EVENT_SUFFIX_PATTERN.exec(identity);
  const sourceEventDigest = sourceEventMatch?.[1] ?? null;
  const dayUtc = sourceEventMatch
    ? identity.slice(0, sourceEventMatch.index)
    : identity;
  if (!memberId || Number.isNaN(new Date(dayUtc).getTime())) {
    return null;
  }

  return {
    attempt,
    dayUtc,
    memberId,
    sourceEventDigest,
  };
}
