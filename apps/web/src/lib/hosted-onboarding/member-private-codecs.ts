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
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
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
const HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD = "hosted-member-routing.telegram-user-id";
const HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_SCHEMA =
  "murph.hosted-member-routing.telegram.v1";
const HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD = "hosted-member-billing-ref.stripe-customer-id";
const HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD =
  "hosted-member-billing-ref.stripe-subscription-id";

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
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}

export interface HostedMemberBillingPrivateState {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export function buildHostedMemberIdentityPrivateColumns(input: {
  memberId: string;
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
}) {
  return {
    phoneNumberEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
      memberId: input.memberId,
      value: input.phoneNumber,
    }),
    privyUserIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
      memberId: input.memberId,
      value: input.privyUserId,
    }),
    signupPhoneCodeSendAttemptId: normalizeNullableString(input.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
    signupPhoneNumberEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
      memberId: input.memberId,
      value: input.signupPhoneNumber,
    }),
    walletAddressEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD,
      memberId: input.memberId,
      value: input.walletAddress,
    }),
  } as const;
}

export function readHostedMemberIdentityPrivateState(
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
): HostedMemberIdentityPrivateState {
  return {
    phoneNumber: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
      memberId: identity.memberId,
      value: identity.phoneNumberEncrypted,
    }),
    privyUserId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
      memberId: identity.memberId,
      value: identity.privyUserIdEncrypted,
    }),
    signupPhoneCodeSendAttemptId: normalizeNullableString(identity.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: identity.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: identity.signupPhoneCodeSentAt,
    signupPhoneNumber: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
      memberId: identity.memberId,
      value: identity.signupPhoneNumberEncrypted,
    }),
    walletAddress: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD,
      memberId: identity.memberId,
      value: identity.walletAddressEncrypted,
    }),
  };
}

export function buildHostedMemberRoutingPrivateColumns(input: {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}) {
  return {
    linqChatIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
      memberId: input.memberId,
      value: input.linqChatId,
    }),
    linqRecipientPhoneEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: input.memberId,
      value: input.linqRecipientPhone,
    }),
    pendingLinqChatIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
      memberId: input.memberId,
      value: input.pendingLinqChatId,
    }),
    pendingLinqRecipientPhoneEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: input.memberId,
      value: input.pendingLinqRecipientPhone,
    }),
    telegramUserIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
      memberId: input.memberId,
      value: buildHostedMemberRoutingTelegramPrivateValue({
        telegramThreadId: input.telegramThreadId,
        telegramUserId: input.telegramUserId,
      }),
    }),
  } as const;
}

export function readHostedMemberRoutingPrivateState(
  routing: Pick<
    HostedMemberRouting,
    | "linqChatIdEncrypted"
    | "linqRecipientPhoneEncrypted"
    | "memberId"
    | "pendingLinqChatIdEncrypted"
    | "pendingLinqRecipientPhoneEncrypted"
    | "telegramUserIdEncrypted"
  >,
): HostedMemberRoutingPrivateState {
  const telegramState = readHostedMemberRoutingTelegramPrivateState({
    memberId: routing.memberId,
    telegramUserIdEncrypted: routing.telegramUserIdEncrypted,
  });

  return {
    linqChatId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.linqChatIdEncrypted,
    }),
    linqRecipientPhone: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.linqRecipientPhoneEncrypted,
    }),
    pendingLinqChatId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqChatIdEncrypted,
    }),
    pendingLinqRecipientPhone: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqRecipientPhoneEncrypted,
    }),
    telegramThreadId: telegramState.telegramThreadId,
    telegramUserId: telegramState.telegramUserId,
  };
}

export function readHostedMemberRoutingTelegramPrivateState(
  routing: Pick<HostedMemberRouting, "memberId" | "telegramUserIdEncrypted">,
): Pick<HostedMemberRoutingPrivateState, "telegramThreadId" | "telegramUserId"> {
  const decryptedValue = decryptHostedWebNullableString({
    field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
    memberId: routing.memberId,
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
    schema: HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_SCHEMA,
    telegramThreadId: telegramThreadId ?? telegramUserId,
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

  if (envelope.status === "supported") {
    const telegramUserId = normalizeNullableString(envelope.telegramUserId);
    const normalizedThreadId = normalizeHostedTelegramDirectThreadTarget(
      envelope.telegramThreadId,
    );

    return {
      telegramThreadId: normalizedThreadId ?? telegramUserId,
      telegramUserId,
    };
  }

  if (envelope.status === "unsupported") {
    return {
      telegramThreadId: null,
      telegramUserId: null,
    };
  }

  const legacyTelegramTarget = normalizeHostedTelegramDirectThreadTarget(normalized);

  return {
    telegramThreadId: legacyTelegramTarget,
    telegramUserId: legacyTelegramTarget,
  };
}

function parseHostedMemberRoutingTelegramPrivateEnvelope(
  value: string,
):
  | { status: "legacy" }
  | { status: "supported"; telegramThreadId: string | null; telegramUserId: string | null }
  | { status: "unsupported" } {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object") {
      return { status: "legacy" };
    }

    if (Array.isArray(parsed)) {
      return { status: "unsupported" };
    }

    const record = parsed as Record<string, unknown>;

    if (record.schema !== HOSTED_MEMBER_ROUTING_TELEGRAM_PRIVATE_STATE_SCHEMA) {
      return { status: "unsupported" };
    }

    return {
      status: "supported",
      telegramThreadId:
        typeof record.telegramThreadId === "string" ? record.telegramThreadId : null,
      telegramUserId: typeof record.telegramUserId === "string" ? record.telegramUserId : null,
    };
  } catch {
    return { status: "legacy" };
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

export function buildHostedMemberBillingPrivateColumns(input: {
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}) {
  return {
    stripeCustomerIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: input.memberId,
      value: input.stripeCustomerId,
    }),
    stripeSubscriptionIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: input.memberId,
      value: input.stripeSubscriptionId,
    }),
  } as const;
}

export function readHostedMemberBillingPrivateState(
  billingRef: Pick<
    HostedMemberBillingRef,
    | "memberId"
    | "stripeCustomerIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  >,
): HostedMemberBillingPrivateState {
  return {
    stripeCustomerId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeCustomerIdEncrypted,
    }),
    stripeSubscriptionId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeSubscriptionIdEncrypted,
    }),
  };
}
