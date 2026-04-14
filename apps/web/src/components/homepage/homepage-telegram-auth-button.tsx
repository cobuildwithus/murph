"use client";

import {
  useCreateWallet,
  useLoginWithTelegram,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toErrorMessage } from "@/src/components/settings/hosted-settings-utils";

import { HomepageInlineAuthButton } from "./homepage-inline-auth-button";
import { completeHomepagePrivyAuth } from "./homepage-privy-auth";
import { TelegramIcon } from "./telegram-icon";

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
      const redirectUrl = await completeHomepagePrivyAuth({
        createWallet,
        refreshUser,
        user,
      });
      window.location.assign(redirectUrl);
    } catch (error) {
      setErrorMessage(
        toErrorMessage(error, "Could not continue with Telegram right now."),
      );
      setRedirectPending(false);
    }
  }

  return (
    <>
      <HomepageInlineAuthButton
        disabled={!ready || loading}
        className="order-1 border-[#229ED9] bg-[#229ED9] text-white hover:bg-[#1d8dc4] hover:text-white"
        icon={<TelegramIcon className="h-5 w-5" />}
        onClick={handleClick}
      >
        {loading ? "Connecting..." : "Telegram"}
      </HomepageInlineAuthButton>

      {errorMessage ? (
        <Alert variant="destructive" className="order-3 sm:col-span-2">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
