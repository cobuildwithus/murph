import { resolveHostedLinqDayUtc } from "./linq-daily-state";

const HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX = "linq-invite-signup:";
const HOSTED_LINQ_INVITE_SIGNUP_ATTEMPT_SUFFIX_PATTERN = /:a([2-9]\d*)$/;
const HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX =
  "linq-invite-signup-source:v1:";

export type HostedLinqInviteSignupGroupJoinReplyContext = {
  outreachId: string;
  repliedAt: string;
  sourceEventId: string | null;
};

export type HostedLinqInviteSignupDeliverySourceRef = {
  effectId: string;
  groupJoinReplyContext: HostedLinqInviteSignupGroupJoinReplyContext | null;
  occurredAt: string | null;
  sourceEventId: string | null;
};

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
  const base = `${buildHostedLinqInviteSignupEffectIdMemberPrefix(input.memberId)}${dayUtc}`;
  return typeof input.attempt === "number" && input.attempt > 1
    ? `${base}:a${input.attempt}`
    : base;
}

export function buildHostedLinqInviteSignupEffectIdMemberPrefix(
  memberId: string,
): string {
  return `${HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX}${memberId}:`;
}

export function buildHostedLinqInviteSignupDeliverySourceRefMemberPrefix(
  memberId: string,
): string {
  const effectIdPrefix = JSON.stringify(
    buildHostedLinqInviteSignupEffectIdMemberPrefix(memberId),
  );
  return `${HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX}[${
    effectIdPrefix.slice(0, -1)
  }`;
}

export function buildHostedLinqInviteSignupGroupJoinSourceRefFragment(
  outreachId: string,
): string {
  const normalized = outreachId.trim();
  if (!normalized) {
    throw new TypeError(
      "Hosted Linq group-join signup delivery source requires an outreach id.",
    );
  }
  return JSON.stringify(normalized);
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

export function buildHostedLinqInviteSignupDeliverySourceRef(input: {
  effectId: string;
  groupJoinOutreachId?: string | null;
  groupJoinRepliedAt?: string | null;
  sourceEventId?: string | null;
}): string {
  const groupJoinOutreachId = input.groupJoinOutreachId?.trim() ?? "";
  const groupJoinRepliedAt = input.groupJoinRepliedAt?.trim() ?? "";
  const sourceEventId = input.sourceEventId?.trim() ?? "";
  if (!groupJoinOutreachId && !sourceEventId) {
    return input.effectId;
  }
  if (
    !parseHostedLinqInviteSignupEffectId(input.effectId)
    || !groupJoinRepliedAt
  ) {
    throw new TypeError(
      "Hosted Linq signup delivery source requires a valid effect and occurrence time.",
    );
  }
  const repliedAt = new Date(groupJoinRepliedAt);
  if (Number.isNaN(repliedAt.getTime())) {
    throw new TypeError(
      "Hosted Linq signup delivery source requires a valid occurrence time.",
    );
  }
  return `${HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX}${JSON.stringify(
    sourceEventId
      ? [
          input.effectId,
          groupJoinOutreachId || null,
          repliedAt.toISOString(),
          sourceEventId,
        ]
      : [
          input.effectId,
          groupJoinOutreachId,
          repliedAt.toISOString(),
        ],
  )}`;
}

export function parseHostedLinqInviteSignupDeliverySourceRef(
  sourceRef: string | null | undefined,
): HostedLinqInviteSignupDeliverySourceRef | null {
  const normalized = sourceRef?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  if (parseHostedLinqInviteSignupEffectId(normalized)) {
    return {
      effectId: normalized,
      groupJoinReplyContext: null,
      occurredAt: null,
      sourceEventId: null,
    };
  }
  if (!normalized.startsWith(HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      normalized.slice(HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX.length),
    );
  } catch {
    return null;
  }
  if (
    !Array.isArray(decoded)
    || (decoded.length !== 3 && decoded.length !== 4)
    || typeof decoded[0] !== "string"
    || (
      typeof decoded[1] !== "string"
      && !(decoded.length === 4 && decoded[1] === null)
    )
    || typeof decoded[2] !== "string"
    || (decoded.length === 4 && typeof decoded[3] !== "string")
    || !parseHostedLinqInviteSignupEffectId(decoded[0])
    || (typeof decoded[1] === "string" && !decoded[1].trim())
    || Number.isNaN(new Date(decoded[2]).getTime())
    || (decoded.length === 4 && !decoded[3].trim())
  ) {
    return null;
  }
  return {
    effectId: decoded[0],
    groupJoinReplyContext: typeof decoded[1] === "string"
      ? {
          outreachId: decoded[1].trim(),
          repliedAt: new Date(decoded[2]).toISOString(),
          sourceEventId: decoded.length === 4 ? decoded[3].trim() : null,
        }
      : null,
    occurredAt: new Date(decoded[2]).toISOString(),
    sourceEventId: decoded.length === 4 ? decoded[3].trim() : null,
  };
}
