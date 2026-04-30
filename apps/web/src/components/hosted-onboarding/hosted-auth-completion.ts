import {
  ensureHostedPrivyPhoneReady,
  ensureHostedPrivyWalletReady,
} from "@/src/lib/hosted-onboarding/privy-client";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedPrivyCompletionWithRetry } from "./hosted-privy-auth-support";

export interface HostedAuthCompletionUser {
  linkedAccounts?: unknown;
}

export interface HostedPrivyClientSessionInput {
  createWallet: () => Promise<unknown>;
  refreshUser?: () => Promise<HostedAuthCompletionUser | null>;
  requirePhone?: boolean;
  user: HostedAuthCompletionUser | null;
}

interface HostedAuthCompletionInput extends HostedPrivyClientSessionInput {
  inviteCode?: string | null;
}

export interface HostedAuthCompletionResult {
  payload: HostedPrivyCompletionPayload;
  redirectUrl: string;
}

export async function completeHostedPrivyAuth(
  input: HostedAuthCompletionInput,
): Promise<HostedAuthCompletionResult> {
  const refreshedUser = input.refreshUser
    ? await input.refreshUser().catch(() => null)
    : null;
  const currentUser = refreshedUser ?? input.user;

  if (input.requirePhone) {
    await ensureHostedPrivyPhoneReady({
      createWallet: input.createWallet,
      user: currentUser,
    });
  } else {
    await ensureHostedPrivyWalletReady({
      createWallet: input.createWallet,
      user: currentUser,
    });
  }

  const payload = await requestHostedPrivyCompletionWithRetry({
    inviteCode: input.inviteCode,
  });
  await input.refreshUser?.().catch(() => null);
  const redirectUrl = await resolveHostedAuthRedirectUrl({
    payload,
  });

  return {
    payload,
    redirectUrl,
  };
}

export async function resolveHostedAuthRedirectUrl(input: {
  payload: HostedPrivyCompletionPayload;
}): Promise<string> {
  if (input.payload.stage === "checkout") {
    return input.payload.joinUrl;
  }

  if (isHostedOnboardingAccessibleStage(input.payload.stage)) {
    return "/home";
  }

  return input.payload.joinUrl;
}
