"use client";

import {
  useCreateWallet,
  useLoginWithTelegram,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestHostedBillingCheckout } from "@/src/components/hosted-onboarding/client-api";
import { requestHostedPrivyCompletionWithRetry } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import { ensureHostedPrivyWalletReady } from "@/src/lib/hosted-onboarding/privy-client";

import { TelegramIcon } from "./telegram-icon";

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not continue with Telegram right now.";
}

async function resolveHomepageTelegramRedirectUrl(input: {
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

export function HomepageTelegramAuthButton() {
  const { createWallet } = useCreateWallet();
  const { login, state } = useLoginWithTelegram();
  const { ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectPending, setRedirectPending] = useState(false);

  const loading = state.status === "loading" || redirectPending;

  async function handleClick() {
    setErrorMessage(null);
    setRedirectPending(true);

    try {
      await login();

      const refreshedUser = await refreshUser().catch(() => null);
      await ensureHostedPrivyWalletReady({
        createWallet,
        user: refreshedUser ?? user,
      });

      const payload = await requestHostedPrivyCompletionWithRetry();
      const redirectUrl = await resolveHomepageTelegramRedirectUrl({ payload });
      window.location.assign(redirectUrl);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setRedirectPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        size="lg"
        disabled={!ready || loading}
        className="w-full justify-center gap-3 bg-[#229ED9] font-semibold text-white hover:bg-[#1d8dc4]"
        onClick={handleClick}
      >
        <TelegramIcon className="h-5 w-5" />
        {loading ? "Connecting Telegram..." : "Continue with Telegram"}
      </Button>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
