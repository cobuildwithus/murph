"use client";

import {
  useCreateWallet,
  useLoginWithTelegram,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { TelegramIcon } from "@/src/components/homepage/telegram-icon";

import {
  completeHostedPrivyAuth,
  type HostedPrivyClientSessionInput,
} from "./hosted-auth-completion";
import { toErrorMessage } from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";

export function HostedTelegramAuthButton({
  active = false,
  onActivate,
}: {
  active?: boolean;
  onActivate: () => void;
}) {
  const { createWallet } = useCreateWallet();
  const { login, state } = useLoginWithTelegram();
  const { ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectPending, setRedirectPending] = useState(false);
  const authSession: HostedPrivyClientSessionInput = {
    createWallet,
    refreshUser,
    user,
  };

  const loading = state.status === "loading" || redirectPending;

  async function handleClick() {
    onActivate();
    setErrorMessage(null);
    setRedirectPending(true);

    try {
      await login();
      const result = await completeHostedPrivyAuth({
        ...authSession,
      });
      window.location.assign(result.redirectUrl);
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          "Could not continue with Telegram right now.",
        ),
      );
      setRedirectPending(false);
    }
  }

  return (
    <>
      <HostedInlineAuthButton
        active={active}
        disabled={!ready || loading}
        className="order-1"
        icon={<TelegramIcon className="h-5 w-5" />}
        onClick={handleClick}
      >
        {loading ? "Connecting..." : "Telegram"}
      </HostedInlineAuthButton>

      {active && errorMessage ? (
        <Alert variant="destructive" className="order-3 sm:col-span-2">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
