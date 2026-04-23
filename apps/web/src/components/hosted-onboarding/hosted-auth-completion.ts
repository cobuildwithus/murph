import type { HostedAuthenticationIntent } from "@/src/lib/hosted-onboarding/authentication-intent";
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
  intent: HostedAuthenticationIntent;
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
    intent: input.intent,
    inviteCode: input.inviteCode,
  });
  await input.refreshUser?.().catch(() => null);
  const redirectUrl = await resolveHostedAuthRedirectUrl({
    intent: input.intent,
    payload,
  });

  return {
    payload,
    redirectUrl,
  };
}

async function resolveHostedAuthRedirectUrl(input: {
  intent: HostedAuthenticationIntent;
  payload: HostedPrivyCompletionPayload;
}): Promise<string> {
  if (input.payload.stage === "checkout") {
    return input.payload.joinUrl;
  }

  if (input.intent === "signin" || isHostedOnboardingAccessibleStage(input.payload.stage)) {
    return "/settings";
  }

  return input.payload.joinUrl;
}
