"use client";

import { useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { TelegramIcon } from "@/src/components/homepage/telegram-icon";
import { Spinner } from "@/src/components/ui/spinner";

import {
  describeTelegramAuthError,
  type TelegramAuthNotice,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import {
  consumeHostedTelegramOAuthDialogIntent,
  markHostedTelegramOAuthDialogIntent,
} from "./hosted-telegram-oauth-intent";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";

export function HostedTelegramAuthButton({
  active = false,
  completionPending = false,
  disableSignup = false,
  disabled = false,
  onAuthCancel,
  onAuthStart,
  onActivate,
  onAuthenticated,
  onNoticeChange,
}: {
  active?: boolean;
  completionPending?: boolean;
  disableSignup?: boolean;
  disabled?: boolean;
  onAuthCancel?: () => void;
  onAuthStart?: () => boolean;
  onActivate: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
  onNoticeChange?: (notice: TelegramAuthNotice | null) => void;
}) {
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    onComplete: () => {
      if (!consumeHostedTelegramOAuthDialogIntent()) return;

      void onAuthenticated({ authMethod: "telegram" });
    },
    onError: handleOAuthFailure,
  });
  const { ready } = usePrivy();
  const [telegramLoginPending, setTelegramLoginPending] = useState(false);
  const telegramLoginInFlightRef = useRef(false);
  const loading = telegramLoginPending || oauthLoading;

  async function handleClick() {
    if (telegramLoginInFlightRef.current || !ready) return;

    if (onAuthStart && !onAuthStart()) return;

    onActivate();
    onNoticeChange?.(null);
    await runTelegramLogin();
  }

  async function runTelegramLogin() {
    if (telegramLoginInFlightRef.current || !ready) return;

    telegramLoginInFlightRef.current = true;
    setTelegramLoginPending(true);
    markHostedTelegramOAuthDialogIntent();

    try {
      await initOAuth({
        provider: "telegram",
        ...(disableSignup ? { disableSignup: true } : {}),
      });
    } catch (error) {
      handleOAuthFailure(error);
    } finally {
      telegramLoginInFlightRef.current = false;
      setTelegramLoginPending(false);
    }
  }

  function handleOAuthFailure(error: unknown) {
    if (!consumeHostedTelegramOAuthDialogIntent()) return;

    onAuthCancel?.();
    onNoticeChange?.(describeTelegramAuthError(error));
  }

  return (
    <HostedTelegramAuthButtonPresentation
      active={active}
      completionPending={completionPending}
      disabled={disabled || !ready || loading || completionPending}
      loading={loading}
      onClick={handleClick}
    />
  );
}

export function HostedTelegramAuthButtonPresentation({
  active = false,
  completionPending = false,
  disabled = false,
  loading = false,
  onClick,
}: {
  active?: boolean;
  completionPending?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="space-y-2">
      <HostedInlineAuthButton
        active={active}
        busy={loading || completionPending}
        disabled={disabled}
        icon={
          loading || completionPending
            ? <Spinner aria-hidden="true" />
            : <TelegramIcon className="h-5 w-5" />
        }
        onClick={onClick}
      >
        {completionPending
          ? "Finishing..."
          : loading
            ? "Connecting..."
            : "Telegram"}
      </HostedInlineAuthButton>
    </div>
  );
}
