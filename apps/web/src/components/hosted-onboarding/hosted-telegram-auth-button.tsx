"use client";

import { useLoginWithTelegram, usePrivy } from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { TelegramIcon } from "@/src/components/homepage/telegram-icon";

import type { HostedAuthCompletionUser } from "./hosted-auth-completion";
import { toErrorMessage } from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";

export function HostedTelegramAuthButton({
  active = false,
  disableSignup = false,
  onActivate,
  onAuthenticated,
}: {
  active?: boolean;
  disableSignup?: boolean;
  onActivate: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
}) {
  const completedUserRef = useRef<HostedAuthCompletionUser | null>(null);
  const { login, state } = useLoginWithTelegram({
    onComplete: (params) => {
      completedUserRef.current = params.user;
    },
  });
  const { ready } = usePrivy();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loading = state.status === "loading";

  async function handleClick() {
    onActivate();
    setErrorMessage(null);

    try {
      await login(disableSignup ? { disableSignup: true } : undefined);
    } catch (error) {
      setErrorMessage(
        toErrorMessage(
          error,
          "Could not continue with Telegram right now.",
        ),
      );
      return;
    }

    await onAuthenticated({
      authMethod: "telegram",
      completedUser: completedUserRef.current,
    });
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
