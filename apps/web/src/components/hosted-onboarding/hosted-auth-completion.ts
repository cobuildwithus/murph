import {
  ensureHostedPrivyPhoneReady,
  ensureHostedPrivyWalletReady,
} from "@/src/lib/hosted-onboarding/privy-client";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedBillingCheckout } from "./client-api";
import { requestHostedPrivyCompletionWithRetry } from "./hosted-privy-auth-support";
import type { HostedAuthIntent } from "./hosted-auth-shared";

interface HostedAuthCompletionUser {
  linkedAccounts?: unknown;
}

interface HostedAuthCompletionInput {
  createWallet: () => Promise<unknown>;
  intent: HostedAuthIntent;
  inviteCode?: string | null;
  refreshUser?: () => Promise<HostedAuthCompletionUser | null>;
  requirePhone?: boolean;
  user: HostedAuthCompletionUser | null;
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

  const payload = await requestHostedPrivyCompletionWithRetry(input.inviteCode);
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
  intent: HostedAuthIntent;
  payload: HostedPrivyCompletionPayload;
}): Promise<string> {
  if (input.payload.stage === "checkout") {
    const checkout = await requestHostedBillingCheckout({
      inviteCode: input.payload.inviteCode,
    });

    if (checkout.alreadyActive) {
      return "/settings";
    }

    if (!checkout.url) {
      throw new Error("Checkout did not return a redirect URL.");
    }

    return checkout.url;
  }

  if (input.intent === "signin" || input.payload.stage === "active") {
    return "/settings";
  }

  return input.payload.joinUrl;
}
