"use client";

import { useLoginWithTelegram, usePrivy } from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { TelegramIcon } from "@/src/components/homepage/telegram-icon";

import {
  describeTelegramAuthError,
  type TelegramAuthNotice,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";
import { requestHostedPrivyAuthIntent } from "./hosted-privy-auth-support";

export function HostedTelegramAuthButton({
  active = false,
  disabled: externallyDisabled = false,
  disableSignup = false,
  inviteCode = null,
  onActivate,
  onAuthenticated,
  onAuthAttemptPendingChange,
  onNoticeChange,
}: {
  active?: boolean;
  disabled?: boolean;
  disableSignup?: boolean;
  inviteCode?: string | null;
  onActivate: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
  onAuthAttemptPendingChange?: (pending: boolean) => void;
  onNoticeChange?: (notice: TelegramAuthNotice | null) => void;
}) {
  const { login, state } = useLoginWithTelegram();
  const { ready } = usePrivy();
  const [authAttemptPending, setAuthAttemptPending] = useState(false);
  const authAttemptInFlightRef = useRef(false);

  const loading = authAttemptPending || state.status === "loading";

  async function handleClick() {
    if (authAttemptInFlightRef.current || externallyDisabled) {
      return;
    }

    authAttemptInFlightRef.current = true;
    setAuthAttemptPending(true);
    onActivate();
    onNoticeChange?.(null);

    try {
      onAuthAttemptPendingChange?.(true);
      await requestHostedPrivyAuthIntent({
        inviteCode,
        method: "telegram",
      });
      await login(disableSignup ? { disableSignup: true } : undefined);
      await onAuthenticated({
        authMethod: "telegram",
      });
    } catch (error) {
      onNoticeChange?.(describeTelegramAuthError(error));
    } finally {
      authAttemptInFlightRef.current = false;
      setAuthAttemptPending(false);
      onAuthAttemptPendingChange?.(false);
    }
  }

  return (
    <HostedInlineAuthButton
      active={active}
      disabled={externallyDisabled || !ready || loading}
      icon={<TelegramIcon className="h-5 w-5" />}
      onClick={handleClick}
    >
      {loading ? "Connecting..." : "Telegram"}
    </HostedInlineAuthButton>
  );
}
