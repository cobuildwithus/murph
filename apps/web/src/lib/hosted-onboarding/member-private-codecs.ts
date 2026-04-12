import type {
  HostedMemberBillingRef,
  HostedMemberIdentity,
  HostedMemberRouting,
} from "@prisma/client";

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
      value: input.telegramUserId,
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
    telegramUserId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_TELEGRAM_USER_FIELD,
      memberId: routing.memberId,
      value: routing.telegramUserIdEncrypted,
    }),
  };
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
