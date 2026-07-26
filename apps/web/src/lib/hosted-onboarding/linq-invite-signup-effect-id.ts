import { sha256Hex } from "../primitives";
import { resolveHostedLinqDayUtc } from "./linq-daily-state";

const HOSTED_LINQ_INVITE_SIGNUP_EFFECT_ID_PREFIX = "linq-invite-signup:";
const HOSTED_LINQ_INVITE_SIGNUP_ATTEMPT_SUFFIX_PATTERN = /:a([2-9]\d*)$/;
const HOSTED_LINQ_INVITE_SIGNUP_SOURCE_EVENT_SUFFIX_PATTERN =
  /:e([0-9a-f]{32})$/u;
const HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX =
  "linq-invite-signup-source:v1:";

export type HostedLinqInviteSignupGroupJoinReplyContext = {
  outreachId: string;
  repliedAt: string;
};

export type HostedLinqInviteSignupDeliverySourceRef = {
  effectId: string;
  groupJoinReplyContext: HostedLinqInviteSignupGroupJoinReplyContext | null;
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

export function buildHostedLinqInviteSignupDeliverySourceRef(input: {
  effectId: string;
  groupJoinOutreachId?: string | null;
  groupJoinRepliedAt?: string | null;
}): string {
  const groupJoinOutreachId = input.groupJoinOutreachId?.trim() ?? "";
  const groupJoinRepliedAt = input.groupJoinRepliedAt?.trim() ?? "";
  if (!groupJoinOutreachId) {
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
  return `${HOSTED_LINQ_INVITE_SIGNUP_SOURCE_REF_PREFIX}${JSON.stringify([
    input.effectId,
    groupJoinOutreachId,
    repliedAt.toISOString(),
  ])}`;
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
    || decoded.length !== 3
    || typeof decoded[0] !== "string"
    || typeof decoded[1] !== "string"
    || typeof decoded[2] !== "string"
    || !parseHostedLinqInviteSignupEffectId(decoded[0])
    || !decoded[1].trim()
    || Number.isNaN(new Date(decoded[2]).getTime())
  ) {
    return null;
  }
  return {
    effectId: decoded[0],
    groupJoinReplyContext: {
      outreachId: decoded[1].trim(),
      repliedAt: new Date(decoded[2]).toISOString(),
    },
  };
}
