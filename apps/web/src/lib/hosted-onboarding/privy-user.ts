import { type User as PrivyUser } from "@privy-io/node";

import { hostedOnboardingError } from "./errors";
import {
  type HostedPrivyEmailAccount,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyPhoneAccount,
  type HostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
  resolveHostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccounts,
  resolveHostedPrivyTelegramAccountSelection,
  type PrivyLinkedAccountLike,
} from "./privy-shared";

export type HostedPrivyUser = PrivyUser & HostedPrivyLinkedAccountContainer;

export interface HostedPrivyIdentity {
  email?: HostedPrivyEmailAccount | null;
  phone: HostedPrivyPhoneAccount | null;
  telegram: HostedPrivyTelegramAccount | null;
  userId: string;
}

export interface HostedPrivySessionState {
  identity: HostedPrivyIdentity;
  linkedAccounts: PrivyLinkedAccountLike[];
  verifiedPrivyUser: HostedPrivyUser;
}

export function buildHostedPrivySessionState(verifiedPrivyUser: HostedPrivyUser): HostedPrivySessionState {
  return {
    identity: resolveHostedPrivyIdentityFromVerifiedUser(verifiedPrivyUser),
    linkedAccounts: resolveHostedPrivyLinkedAccounts(verifiedPrivyUser),
    verifiedPrivyUser,
  };
}

export function resolveHostedPrivyIdentityFromVerifiedUser(user: HostedPrivyUser): HostedPrivyIdentity {
  const linkedAccountState = resolveHostedPrivyLinkedAccountState(user);
  const { phone } = linkedAccountState;
  const email = extractHostedPrivyVerifiedEmailAccount(linkedAccountState.linkedAccounts);
  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(user);

  if (telegramSelection.ambiguous) {
    throw hostedOnboardingError({
      code: "PRIVY_TELEGRAM_AMBIGUOUS",
      message: "Reconnect Telegram in Privy before continuing.",
      httpStatus: 409,
    });
  }

  if (!phone && !telegramSelection.account && !email) {
    throw hostedOnboardingError({
      code: "PRIVY_ACCOUNT_REQUIRED",
      message: "Finish email, phone, or Telegram verification before continuing.",
      httpStatus: 400,
    });
  }

  return {
    email,
    phone,
    telegram: telegramSelection.account,
    userId: user.id,
  };
}
