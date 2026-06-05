"use client";

import {
  useCreateWallet,
  useLoginWithTelegram,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { TelegramIcon } from "@/src/components/homepage/telegram-icon";

import {
  completeHostedPrivyAuth,
  type HostedAuthCompletionResult,
  type HostedAuthCompletionUser,
  type HostedPrivyClientSessionInput,
} from "./hosted-auth-completion";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";
import { toErrorMessage } from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";

export function HostedTelegramAuthButton({
  active = false,
  disableSignup = false,
  onActivate,
  onCompleted,
}: {
  active?: boolean;
  disableSignup?: boolean;
  onActivate: () => void;
  onCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
}) {
  const { createWallet } = useCreateWallet();
  const completedUserRef = useRef<HostedAuthCompletionUser | null>(null);
  const { login, state } = useLoginWithTelegram({
    onComplete: (params) => {
      completedUserRef.current = params.user;
    },
  });
  const { ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirectPending, setRedirectPending] = useState(false);
  const authSession: HostedPrivyClientSessionInput = {
    authMethod: "telegram",
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
      await login(disableSignup ? { disableSignup: true } : undefined);
      const completedUser = completedUserRef.current;
      const result = await completeHostedPrivyAuth({
        ...authSession,
        ...(completedUser ? { completedUser } : {}),
      });
      if (onCompleted) {
        await onCompleted(result);
        return;
      }
      navigateHostedAuthRedirect(result.redirectUrl);
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
