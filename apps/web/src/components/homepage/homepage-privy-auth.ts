import { requestHostedBillingCheckout } from "@/src/components/hosted-onboarding/client-api";
import { requestHostedPrivyCompletionWithRetry } from "@/src/components/hosted-onboarding/hosted-privy-auth-support";
import { ensureHostedPrivyWalletReady } from "@/src/lib/hosted-onboarding/privy-client";

interface HomepagePrivyAuthUser {
  linkedAccounts?: unknown;
}

export async function completeHomepagePrivyAuth(input: {
  createWallet: () => Promise<unknown>;
  refreshUser: () => Promise<HomepagePrivyAuthUser | null>;
  user: HomepagePrivyAuthUser | null;
}): Promise<string> {
  const refreshedUser = await input.refreshUser().catch(() => null);
  await ensureHostedPrivyWalletReady({
    createWallet: input.createWallet,
    user: refreshedUser ?? input.user,
  });

  const payload = await requestHostedPrivyCompletionWithRetry();
  return resolveHomepagePrivyRedirectUrl({ payload });
}

async function resolveHomepagePrivyRedirectUrl(input: {
  payload: Awaited<ReturnType<typeof requestHostedPrivyCompletionWithRetry>>;
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

  return input.payload.stage === "active" ? "/settings" : input.payload.joinUrl;
}
