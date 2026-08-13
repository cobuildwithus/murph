import type {
  HostedMemberBillingRef,
  HostedMemberIdentity,
  HostedMemberRouting,
} from "@prisma/client";
import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import {
  decryptHostedWebNullableFields,
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
  encryptHostedWebNullableStringFromPreparedRoot,
  type PreparedHostedWebEncryptionRoot,
  type HostedWebEncryptionPrismaClient,
} from "../hosted-web/encryption";
import { normalizeNullableString } from "./shared";

const HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD = "hosted-member-identity.privy-user-id";
const HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD = "hosted-member-identity.phone-number";
const HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD = "hosted-member-identity.wallet-address";
const HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD = "hosted-member-identity.signup-phone-number";
const HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD = "hosted-member-routing.home-linq-chat-id";
const HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD =
  "hosted-member-routing.home-linq-recipient-phone";
const HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD =
  "hosted-member-routing.pending-linq-chat-id";
const HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD =
  "hosted-member-routing.pending-linq-recipient-phone";
const HOSTED_MEMBER_ROUTING_PENDING_LINQ_PARTICIPANT_CONTACT_FIELD =
  "hosted-member-routing.pending-linq-participant-contact";
const HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD = "hosted-member-routing.telegram-user-id";
const HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_CURRENT_SCHEMA =
  "murph.hosted-member-routing.telegram.v2";
const HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_LEGACY_SCHEMA =
  "murph.hosted-member-routing.telegram.v1";
const HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD = "hosted-member-billing-ref.stripe-customer-id";
const HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD =
  "hosted-member-billing-ref.stripe-subscription-id";
const HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_SCHEDULE_FIELD =
  "hosted-member-billing-ref.stripe-subscription-schedule-id";
const HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_SESSION_FIELD =
  "hosted-member-billing-ref.stripe-checkout-session-id";

export interface HostedMemberIdentityPrivateState {
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
}

export interface HostedMemberRoutingPrivateState {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  pendingLinqChatId: string | null;
  pendingLinqParticipantContact: string | null;
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}


export interface HostedMemberBillingPrivateState {
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionScheduleId: string | null;
}

export async function buildHostedMemberIdentityPrivateColumns(input: {
  memberId: string;
  phoneNumber: string | null;
  preparedRoot?: PreparedHostedWebEncryptionRoot;
  prisma?: HostedWebEncryptionPrismaClient;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
}) {
  const encryptPrivateField = (field: string, value: string | null | undefined) =>
    input.preparedRoot
      ? encryptHostedWebNullableStringFromPreparedRoot({
          field,
          memberId: input.memberId,
          prepared: input.preparedRoot,
          value,
        })
      : encryptHostedWebNullableString({
          field,
          memberId: input.memberId,
          prisma: input.prisma,
          value,
        });

  const phoneNumberEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
    input.phoneNumber,
  );
  const privyUserIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
    input.privyUserId,
  );
  const signupPhoneNumberEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
    input.signupPhoneNumber,
  );
  return {
    phoneNumberEncrypted,
    privyUserIdEncrypted,
    signupPhoneCodeSendAttemptId: normalizeNullableString(input.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
    signupPhoneNumberEncrypted,
  } as const;
}

export async function readHostedMemberIdentityPrivateState(
  identity: Pick<
    HostedMemberIdentity,
    | "memberId"
    | "phoneNumberEncrypted"
    | "privyUserIdEncrypted"
    | "signupPhoneCodeSendAttemptId"
    | "signupPhoneCodeSendAttemptStartedAt"
    | "signupPhoneCodeSentAt"
    | "signupPhoneNumberEncrypted"
    | "walletAddressEncrypted"
  >,
  prisma?: HostedWebEncryptionPrismaClient,
): Promise<HostedMemberIdentityPrivateState> {
  const [
    phoneNumber,
    privyUserId,
    signupPhoneNumber,
    walletAddress,
  ] = await decryptHostedWebNullableFields({
    entries: [{
      field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
      memberId: identity.memberId,
      value: identity.phoneNumberEncrypted,
    }, {
      field: HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
      memberId: identity.memberId,
      value: identity.privyUserIdEncrypted,
    }, {
      field: HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
      memberId: identity.memberId,
      value: identity.signupPhoneNumberEncrypted,
    }, {
      field: HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD,
      memberId: identity.memberId,
      value: identity.walletAddressEncrypted,
    }],
    prisma,
  });

  return {
    phoneNumber: phoneNumber ?? null,
    privyUserId: privyUserId ?? null,
    signupPhoneCodeSendAttemptId: normalizeNullableString(identity.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: identity.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: identity.signupPhoneCodeSentAt,
    signupPhoneNumber: signupPhoneNumber ?? null,
    walletAddress: walletAddress ?? null,
  };
}

export async function readHostedMemberIdentityPhoneNumber(
  identity: Pick<HostedMemberIdentity, "memberId" | "phoneNumberEncrypted">,
  prisma?: HostedWebEncryptionPrismaClient,
): Promise<string | null> {
  return decryptHostedWebNullableString({
    field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
    memberId: identity.memberId,
    prisma,
    value: identity.phoneNumberEncrypted,
  });
}

export async function buildHostedMemberRoutingPrivateColumns(input: {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqParticipantContact?: string | null;
  pendingLinqRecipientPhone: string | null;
  preparedRoot?: PreparedHostedWebEncryptionRoot;
  prisma?: HostedWebEncryptionPrismaClient;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}) {
  const encryptPrivateField = (field: string, value: string | null | undefined) =>
    input.preparedRoot
      ? encryptHostedWebNullableStringFromPreparedRoot({
          field,
          memberId: input.memberId,
          prepared: input.preparedRoot,
          value,
        })
      : encryptHostedWebNullableString({
          field,
          memberId: input.memberId,
          prisma: input.prisma,
          value,
        });

  const linqChatIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
    input.linqChatId,
  );
  const linqRecipientPhoneEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
    input.linqRecipientPhone,
  );
  const pendingLinqChatIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
    input.pendingLinqChatId,
  );
  const pendingLinqRecipientPhoneEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
    input.pendingLinqRecipientPhone,
  );
  const pendingLinqParticipantContactEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_PENDING_LINQ_PARTICIPANT_CONTACT_FIELD,
    input.pendingLinqParticipantContact,
  );
  const telegramUserIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
    buildHostedMemberRoutingTelegramPrivateValue({
      telegramThreadId: input.telegramThreadId,
      telegramUserId: input.telegramUserId,
    }),
  );

  return {
    linqChatIdEncrypted,
    linqRecipientPhoneEncrypted,
    pendingLinqChatIdEncrypted,
    pendingLinqParticipantContactEncrypted,
    pendingLinqRecipientPhoneEncrypted,
    telegramUserIdEncrypted,
  } as const;
}

export async function readHostedMemberRoutingPrivateState(
  routing: Pick<
    HostedMemberRouting,
    | "linqChatIdEncrypted"
    | "linqRecipientPhoneEncrypted"
    | "memberId"
    | "pendingLinqChatIdEncrypted"
    | "pendingLinqParticipantContactEncrypted"
    | "pendingLinqRecipientPhoneEncrypted"
    | "telegramUserIdEncrypted"
  >,
  prisma?: HostedWebEncryptionPrismaClient,
  retainFailureInScopedCache?: boolean,
): Promise<HostedMemberRoutingPrivateState> {
  const [
    telegramPrivateValue,
    linqChatId,
    linqRecipientPhone,
    pendingLinqChatId,
    pendingLinqParticipantContact,
    pendingLinqRecipientPhone,
  ] = await decryptHostedWebNullableFields({
    entries: [{
      field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
      memberId: routing.memberId,
      value: routing.telegramUserIdEncrypted,
    }, {
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.linqChatIdEncrypted,
    }, {
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.linqRecipientPhoneEncrypted,
    }, {
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqChatIdEncrypted,
    }, {
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_PARTICIPANT_CONTACT_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqParticipantContactEncrypted,
    }, {
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqRecipientPhoneEncrypted,
    }],
    prisma,
    retainFailureInScopedCache,
  });
  const telegramState = parseHostedMemberRoutingTelegramPrivateValue(
    telegramPrivateValue ?? null,
  );

  return {
    linqChatId: linqChatId ?? null,
    linqRecipientPhone: linqRecipientPhone ?? null,
    pendingLinqChatId: pendingLinqChatId ?? null,
    pendingLinqParticipantContact: pendingLinqParticipantContact ?? null,
    pendingLinqRecipientPhone: pendingLinqRecipientPhone ?? null,
    telegramThreadId: telegramState.telegramThreadId,
    telegramUserId: telegramState.telegramUserId,
  };
}

export async function readHostedMemberRoutingTelegramPrivateState(
  routing: Pick<HostedMemberRouting, "memberId" | "telegramUserIdEncrypted">,
  prisma?: HostedWebEncryptionPrismaClient,
): Promise<Pick<HostedMemberRoutingPrivateState, "telegramThreadId" | "telegramUserId">> {
  const decryptedValue = await decryptHostedWebNullableString({
    field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
    memberId: routing.memberId,
    prisma,
    value: routing.telegramUserIdEncrypted,
  });

  return parseHostedMemberRoutingTelegramPrivateValue(decryptedValue);
}


function buildHostedMemberRoutingTelegramPrivateValue(input: {
  telegramThreadId: string | null;
  telegramUserId: string | null;
}): string | null {
  const telegramUserId = normalizeNullableString(input.telegramUserId);
  const rawTelegramThreadId = normalizeNullableString(input.telegramThreadId);
  const telegramThreadId = rawTelegramThreadId === null
    ? null
    : normalizeHostedTelegramDirectThreadTarget(rawTelegramThreadId);

  if (rawTelegramThreadId !== null && telegramThreadId === null) {
    throw new TypeError("Hosted Telegram routing requires a valid Telegram thread target.");
  }

  if (telegramUserId === null && telegramThreadId === null) {
    return null;
  }

  return JSON.stringify({
    schema: HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_CURRENT_SCHEMA,
    telegramThreadId,
    telegramUserId,
  });
}

function parseHostedMemberRoutingTelegramPrivateValue(
  value: string | null,
): Pick<HostedMemberRoutingPrivateState, "telegramThreadId" | "telegramUserId"> {
  const normalized = normalizeNullableString(value);

  if (normalized === null) {
    return {
      telegramThreadId: null,
      telegramUserId: null,
    };
  }

  const envelope = parseHostedMemberRoutingTelegramPrivateEnvelope(normalized);

  if (envelope.status === "current") {
    const telegramUserId = normalizeNullableString(envelope.telegramUserId);
    const normalizedThreadId = normalizeHostedTelegramDirectThreadTarget(
      envelope.telegramThreadId,
    );

    return {
      telegramThreadId: normalizedThreadId,
      telegramUserId,
    };
  }

  if (envelope.status === "legacy") {
    const telegramUserId = normalizeNullableString(envelope.telegramUserId);

    return {
      telegramThreadId: normalizeHostedTelegramLegacyDirectThreadTarget(
        envelope.telegramThreadId,
        telegramUserId,
      ),
      telegramUserId,
    };
  }

  return {
    telegramThreadId: null,
    telegramUserId: null,
  };
}

function parseHostedMemberRoutingTelegramPrivateEnvelope(
  value: string,
):
  | { status: "current"; telegramThreadId: string | null; telegramUserId: string | null }
  | { status: "legacy"; telegramThreadId: string | null; telegramUserId: string | null }
  | { status: "unsupported" } {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") {
      return { status: "unsupported" };
    }

    if (Array.isArray(parsed)) {
      return { status: "unsupported" };
    }

    const record = parsed as Record<string, unknown>;

    if (record.schema === HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_LEGACY_SCHEMA) {
      return {
        status: "legacy",
        telegramThreadId:
          typeof record.telegramThreadId === "string" ? record.telegramThreadId : null,
        telegramUserId: typeof record.telegramUserId === "string" ? record.telegramUserId : null,
      };
    }

    if (record.schema !== HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_CURRENT_SCHEMA) {
      return { status: "unsupported" };
    }

    return {
      status: "current",
      telegramThreadId:
        typeof record.telegramThreadId === "string" ? record.telegramThreadId : null,
      telegramUserId: typeof record.telegramUserId === "string" ? record.telegramUserId : null,
    };
  } catch {
    return { status: "unsupported" };
  }
}

export function normalizeHostedTelegramDirectThreadTarget(
  value: string | null,
): string | null {
  const normalized = normalizeNullableString(value);

  if (normalized === null) {
    return null;
  }

  const parsed = parseTelegramThreadTarget(normalized);

  if (!parsed || parsed.messageThreadId != null) {
    return null;
  }

  if (
    !parsed.businessConnectionId &&
    !parsed.directMessagesTopicId &&
    parsed.chatId.startsWith("-")
  ) {
    return null;
  }

  return serializeTelegramThreadTarget(parsed);
}

function normalizeHostedTelegramLegacyDirectThreadTarget(
  value: string | null,
  telegramUserId: string | null,
): string | null {
  const normalized = normalizeNullableString(value);

  if (normalized === null || normalized === telegramUserId) {
    return null;
  }

  const parsed = parseTelegramThreadTarget(normalized);

  if (
    !parsed
    || parsed.messageThreadId != null
    || (!parsed.businessConnectionId && !parsed.directMessagesTopicId)
  ) {
    return null;
  }

  return serializeTelegramThreadTarget(parsed);
}

export async function buildHostedMemberBillingPrivateColumns(input: {
  memberId: string;
  prisma?: HostedWebEncryptionPrismaClient;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionScheduleId?: string | null;
}) {
  const encryptPrivateField = (field: string, value: string | null | undefined) =>
    encryptHostedWebNullableString({
      field,
      memberId: input.memberId,
      prisma: input.prisma,
      value,
    });

  const stripeCustomerIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
    input.stripeCustomerId,
  );
  const stripeSubscriptionIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
    input.stripeSubscriptionId,
  );
  const stripeSubscriptionScheduleIdEncrypted = await encryptPrivateField(
    HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_SCHEDULE_FIELD,
    input.stripeSubscriptionScheduleId,
  );

  return {
    stripeCustomerIdEncrypted,
    stripeSubscriptionIdEncrypted,
    stripeSubscriptionScheduleIdEncrypted,
  } as const;
}

export async function buildHostedMemberBillingCheckoutSessionPrivateColumn(
  input: {
    memberId: string;
    prisma?: HostedWebEncryptionPrismaClient;
    stripeCheckoutSessionId: string | null;
  },
) {
  return {
    stripeCheckoutSessionIdEncrypted:
      await encryptHostedWebNullableString({
        field: HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
        memberId: input.memberId,
        prisma: input.prisma,
        value: input.stripeCheckoutSessionId,
      }),
  } as const;
}

export async function readHostedMemberBillingPrivateState(
  billingRef: Pick<
    HostedMemberBillingRef,
    | "memberId"
    | "stripeCustomerIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  > & {
    stripeCheckoutSessionIdEncrypted?: string | null;
    stripeSubscriptionScheduleIdEncrypted?: string | null;
  },
  prisma?: HostedWebEncryptionPrismaClient,
): Promise<HostedMemberBillingPrivateState> {
  const [
    stripeCheckoutSessionId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionScheduleId,
  ] =
    await decryptHostedWebNullableFields({
      entries: [{
        field: HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_SESSION_FIELD,
        memberId: billingRef.memberId,
        value: billingRef.stripeCheckoutSessionIdEncrypted,
      }, {
        field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
        memberId: billingRef.memberId,
        value: billingRef.stripeCustomerIdEncrypted,
      }, {
        field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
        memberId: billingRef.memberId,
        value: billingRef.stripeSubscriptionIdEncrypted,
      }, {
        field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_SCHEDULE_FIELD,
        memberId: billingRef.memberId,
        value: billingRef.stripeSubscriptionScheduleIdEncrypted,
      }],
      prisma,
    });

  return {
    stripeCheckoutSessionId: stripeCheckoutSessionId ?? null,
    stripeCustomerId: stripeCustomerId ?? null,
    stripeSubscriptionId: stripeSubscriptionId ?? null,
    stripeSubscriptionScheduleId: stripeSubscriptionScheduleId ?? null,
  };
}
