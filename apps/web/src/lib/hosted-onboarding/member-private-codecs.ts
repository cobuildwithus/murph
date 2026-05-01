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

export async function buildHostedMemberIdentityPrivateColumns(input: {
  memberId: string;
  phoneNumber: string | null;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
}) {
  const [
    phoneNumberEncrypted,
    privyUserIdEncrypted,
    signupPhoneNumberEncrypted,
    walletAddressEncrypted,
  ] = await Promise.all([
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
      memberId: input.memberId,
      value: input.phoneNumber,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
      memberId: input.memberId,
      value: input.privyUserId,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
      memberId: input.memberId,
      value: input.signupPhoneNumber,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD,
      memberId: input.memberId,
      value: input.walletAddress,
    }),
  ]);

  return {
    phoneNumberEncrypted,
    privyUserIdEncrypted,
    signupPhoneCodeSendAttemptId: normalizeNullableString(input.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt,
    signupPhoneNumberEncrypted,
    walletAddressEncrypted,
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
): Promise<HostedMemberIdentityPrivateState> {
  const [
    phoneNumber,
    privyUserId,
    signupPhoneNumber,
    walletAddress,
  ] = await Promise.all([
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PHONE_NUMBER_FIELD,
      memberId: identity.memberId,
      value: identity.phoneNumberEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_PRIVY_USER_FIELD,
      memberId: identity.memberId,
      value: identity.privyUserIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD,
      memberId: identity.memberId,
      value: identity.signupPhoneNumberEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD,
      memberId: identity.memberId,
      value: identity.walletAddressEncrypted,
    }),
  ]);

  return {
    phoneNumber,
    privyUserId,
    signupPhoneCodeSendAttemptId: normalizeNullableString(identity.signupPhoneCodeSendAttemptId),
    signupPhoneCodeSendAttemptStartedAt: identity.signupPhoneCodeSendAttemptStartedAt,
    signupPhoneCodeSentAt: identity.signupPhoneCodeSentAt,
    signupPhoneNumber,
    walletAddress,
  };
}

export async function buildHostedMemberRoutingPrivateColumns(input: {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqRecipientPhone: string | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}) {
  const [
    linqChatIdEncrypted,
    linqRecipientPhoneEncrypted,
    pendingLinqChatIdEncrypted,
    pendingLinqRecipientPhoneEncrypted,
    telegramUserIdEncrypted,
  ] = await Promise.all([
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
      memberId: input.memberId,
      value: input.linqChatId,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: input.memberId,
      value: input.linqRecipientPhone,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
      memberId: input.memberId,
      value: input.pendingLinqChatId,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: input.memberId,
      value: input.pendingLinqRecipientPhone,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
      memberId: input.memberId,
      value: buildHostedMemberRoutingTelegramPrivateValue({
        telegramThreadId: input.telegramThreadId,
        telegramUserId: input.telegramUserId,
      }),
    }),
  ]);

  return {
    linqChatIdEncrypted,
    linqRecipientPhoneEncrypted,
    pendingLinqChatIdEncrypted,
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
    | "pendingLinqRecipientPhoneEncrypted"
    | "telegramUserIdEncrypted"
  >,
): Promise<HostedMemberRoutingPrivateState> {
  const [
    telegramState,
    linqChatId,
    linqRecipientPhone,
    pendingLinqChatId,
    pendingLinqRecipientPhone,
  ] = await Promise.all([
    readHostedMemberRoutingTelegramPrivateState({
    memberId: routing.memberId,
    telegramUserIdEncrypted: routing.telegramUserIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.linqChatIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_HOME_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.linqRecipientPhoneEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqChatIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_PENDING_LINQ_RECIPIENT_PHONE_FIELD,
      memberId: routing.memberId,
      value: routing.pendingLinqRecipientPhoneEncrypted,
    }),
  ]);

  return {
    linqChatId,
    linqRecipientPhone,
    pendingLinqChatId,
    pendingLinqRecipientPhone,
    telegramThreadId: telegramState.telegramThreadId,
    telegramUserId: telegramState.telegramUserId,
  };
}

export async function readHostedMemberRoutingTelegramPrivateState(
  routing: Pick<HostedMemberRouting, "memberId" | "telegramUserIdEncrypted">,
): Promise<Pick<HostedMemberRoutingPrivateState, "telegramThreadId" | "telegramUserId">> {
  const decryptedValue = await decryptHostedWebNullableString({
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

  return {
    telegramThreadId: null,
    telegramUserId: null,
  };
}

function parseHostedMemberRoutingTelegramPrivateEnvelope(
  value: string,
):
  | { status: "supported"; telegramThreadId: string | null; telegramUserId: string | null }
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

export async function buildHostedMemberBillingPrivateColumns(input: {
  memberId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}) {
  const [stripeCustomerIdEncrypted, stripeSubscriptionIdEncrypted] = await Promise.all([
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: input.memberId,
      value: input.stripeCustomerId,
    }),
    encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: input.memberId,
      value: input.stripeSubscriptionId,
    }),
  ]);

  return {
    stripeCustomerIdEncrypted,
    stripeSubscriptionIdEncrypted,
  } as const;
}

export async function readHostedMemberBillingPrivateState(
  billingRef: Pick<
    HostedMemberBillingRef,
    | "memberId"
    | "stripeCustomerIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  >,
): Promise<HostedMemberBillingPrivateState> {
  const [stripeCustomerId, stripeSubscriptionId] = await Promise.all([
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeCustomerIdEncrypted,
    }),
    decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeSubscriptionIdEncrypted,
    }),
  ]);

  return {
    stripeCustomerId,
    stripeSubscriptionId,
  };
}
