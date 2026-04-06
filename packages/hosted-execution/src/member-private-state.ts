export const HOSTED_MEMBER_PRIVATE_STATE_SCHEMA = "murph.hosted-member-private-state.v1";

export interface HostedMemberPrivateState {
  linqChatId: string | null;
  memberId: string;
  privyUserId: string | null;
  schema: typeof HOSTED_MEMBER_PRIVATE_STATE_SCHEMA;
  stripeCustomerId: string | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
  updatedAt: string;
  walletAddress: string | null;
}

export interface HostedMemberPrivateStatePatch {
  linqChatId?: string | null;
  privyUserId?: string | null;
  stripeCustomerId?: string | null;
  stripeLatestBillingEventId?: string | null;
  stripeLatestCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  walletAddress?: string | null;
}

export function applyHostedMemberPrivateStatePatch(input: {
  current: HostedMemberPrivateState | null;
  memberId: string;
  now?: string;
  patch: HostedMemberPrivateStatePatch;
}): HostedMemberPrivateState {
  const current = input.current;
  const memberId = requireNonEmptyString(input.memberId, "Hosted member private state memberId");
  const updatedAt = normalizeIsoTimestamp(input.now) ?? new Date().toISOString();

  if (current && current.memberId !== memberId) {
    throw new TypeError(
      `Hosted member private state memberId mismatch: expected ${memberId}, received ${current.memberId}.`,
    );
  }

  return {
    linqChatId: patchNullableString(input.patch.linqChatId, current?.linqChatId ?? null),
    memberId,
    privyUserId: patchNullableString(input.patch.privyUserId, current?.privyUserId ?? null),
    schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
    stripeCustomerId: patchNullableString(
      input.patch.stripeCustomerId,
      current?.stripeCustomerId ?? null,
    ),
    stripeLatestBillingEventId: patchNullableString(
      input.patch.stripeLatestBillingEventId,
      current?.stripeLatestBillingEventId ?? null,
    ),
    stripeLatestCheckoutSessionId: patchNullableString(
      input.patch.stripeLatestCheckoutSessionId,
      current?.stripeLatestCheckoutSessionId ?? null,
    ),
    stripeSubscriptionId: patchNullableString(
      input.patch.stripeSubscriptionId,
      current?.stripeSubscriptionId ?? null,
    ),
    updatedAt,
    walletAddress: patchNullableString(input.patch.walletAddress, current?.walletAddress ?? null),
  };
}

export function createHostedMemberPrivateState(input: {
  linqChatId?: string | null;
  memberId: string;
  now?: string;
  privyUserId?: string | null;
  stripeCustomerId?: string | null;
  stripeLatestBillingEventId?: string | null;
  stripeLatestCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  walletAddress?: string | null;
}): HostedMemberPrivateState {
  return applyHostedMemberPrivateStatePatch({
    current: null,
    memberId: input.memberId,
    now: input.now,
    patch: {
      linqChatId: input.linqChatId,
      privyUserId: input.privyUserId,
      stripeCustomerId: input.stripeCustomerId,
      stripeLatestBillingEventId: input.stripeLatestBillingEventId,
      stripeLatestCheckoutSessionId: input.stripeLatestCheckoutSessionId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      walletAddress: input.walletAddress,
    },
  });
}

export function parseHostedMemberPrivateState(value: unknown): HostedMemberPrivateState {
  const record = requireRecord(value, "Hosted member private state");
  const schema = requireNonEmptyString(record.schema, "Hosted member private state schema");

  if (schema !== HOSTED_MEMBER_PRIVATE_STATE_SCHEMA) {
    throw new TypeError(
      `Hosted member private state schema must be ${HOSTED_MEMBER_PRIVATE_STATE_SCHEMA}.`,
    );
  }

  return {
    linqChatId: normalizeNullableString(record.linqChatId),
    memberId: requireNonEmptyString(record.memberId, "Hosted member private state memberId"),
    privyUserId: normalizeNullableString(record.privyUserId),
    schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
    stripeCustomerId: normalizeNullableString(record.stripeCustomerId),
    stripeLatestBillingEventId: normalizeNullableString(record.stripeLatestBillingEventId),
    stripeLatestCheckoutSessionId: normalizeNullableString(record.stripeLatestCheckoutSessionId),
    stripeSubscriptionId: normalizeNullableString(record.stripeSubscriptionId),
    updatedAt: requireIsoTimestamp(record.updatedAt, "Hosted member private state updatedAt"),
    walletAddress: normalizeNullableString(record.walletAddress),
  };
}

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function patchNullableString(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  return value === undefined ? fallback : normalizeNullableString(value);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const normalized = normalizeIsoTimestamp(typeof value === "string" ? value : null);

  if (!normalized) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return normalized;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}
