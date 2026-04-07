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
const HOSTED_MEMBER_IDENTITY_WALLET_ADDRESS_FIELD = "hosted-member-identity.wallet-address";
const HOSTED_MEMBER_IDENTITY_SIGNUP_PHONE_FIELD = "hosted-member-identity.signup-phone-number";
const HOSTED_MEMBER_ROUTING_LINQ_CHAT_FIELD = "hosted-member-routing.linq-chat-id";
const HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD = "hosted-member-billing-ref.stripe-customer-id";
const HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD =
  "hosted-member-billing-ref.stripe-subscription-id";
const HOSTED_MEMBER_BILLING_STRIPE_EVENT_FIELD =
  "hosted-member-billing-ref.stripe-latest-billing-event-id";
const HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_FIELD =
  "hosted-member-billing-ref.stripe-latest-checkout-session-id";

export interface HostedMemberIdentityPrivateState {
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
}

export interface HostedMemberRoutingPrivateState {
  linqChatId: string | null;
}

export interface HostedMemberBillingPrivateState {
  stripeCustomerId: string | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
}

export function buildHostedMemberIdentityPrivateColumns(input: {
  memberId: string;
  privyUserId: string | null;
  signupPhoneCodeSendAttemptId: string | null;
  signupPhoneCodeSendAttemptStartedAt: Date | null;
  signupPhoneCodeSentAt: Date | null;
  signupPhoneNumber: string | null;
  walletAddress: string | null;
}) {
  return {
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
    | "privyUserIdEncrypted"
    | "signupPhoneCodeSendAttemptId"
    | "signupPhoneCodeSendAttemptStartedAt"
    | "signupPhoneCodeSentAt"
    | "signupPhoneNumberEncrypted"
    | "walletAddressEncrypted"
  >,
): HostedMemberIdentityPrivateState {
  return {
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
  memberId: string;
}) {
  return {
    linqChatIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_LINQ_CHAT_FIELD,
      memberId: input.memberId,
      value: input.linqChatId,
    }),
  } as const;
}

export function readHostedMemberRoutingPrivateState(
  routing: Pick<HostedMemberRouting, "linqChatIdEncrypted" | "memberId">,
): HostedMemberRoutingPrivateState {
  return {
    linqChatId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_ROUTING_LINQ_CHAT_FIELD,
      memberId: routing.memberId,
      value: routing.linqChatIdEncrypted,
    }),
  };
}

export function buildHostedMemberBillingPrivateColumns(input: {
  memberId: string;
  stripeCustomerId: string | null;
  stripeLatestBillingEventId: string | null;
  stripeLatestCheckoutSessionId: string | null;
  stripeSubscriptionId: string | null;
}) {
  return {
    stripeCustomerIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: input.memberId,
      value: input.stripeCustomerId,
    }),
    stripeLatestBillingEventIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_EVENT_FIELD,
      memberId: input.memberId,
      value: input.stripeLatestBillingEventId,
    }),
    stripeLatestCheckoutSessionIdEncrypted: encryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_FIELD,
      memberId: input.memberId,
      value: input.stripeLatestCheckoutSessionId,
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
    | "stripeLatestBillingEventIdEncrypted"
    | "stripeLatestCheckoutSessionIdEncrypted"
    | "stripeSubscriptionIdEncrypted"
  >,
): HostedMemberBillingPrivateState {
  return {
    stripeCustomerId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeCustomerIdEncrypted,
    }),
    stripeLatestBillingEventId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_EVENT_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeLatestBillingEventIdEncrypted,
    }),
    stripeLatestCheckoutSessionId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_CHECKOUT_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeLatestCheckoutSessionIdEncrypted,
    }),
    stripeSubscriptionId: decryptHostedWebNullableString({
      field: HOSTED_MEMBER_BILLING_STRIPE_SUBSCRIPTION_FIELD,
      memberId: billingRef.memberId,
      value: billingRef.stripeSubscriptionIdEncrypted,
    }),
  };
}
