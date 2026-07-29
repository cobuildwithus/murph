"use client";

import { useLoginWithTelegram, usePrivy } from "@privy-io/react-auth";

import { TelegramIcon } from "@/src/components/homepage/telegram-icon";
import { Spinner } from "@/src/components/ui/spinner";

import {
  describeTelegramAuthError,
  type TelegramAuthNotice,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";

export function HostedTelegramAuthButton({
  active = false,
  completionPending = false,
  disableSignup = false,
  disabled = false,
  onActivate,
  onAuthenticated,
  onNoticeChange,
}: {
  active?: boolean;
  completionPending?: boolean;
  disableSignup?: boolean;
  disabled?: boolean;
  onActivate: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
  onNoticeChange?: (notice: TelegramAuthNotice | null) => void;
}) {
  const { login, state } = useLoginWithTelegram();
  const { ready } = usePrivy();

  const loading = state.status === "loading";

  async function handleClick() {
    onActivate();
    onNoticeChange?.(null);

    try {
      await login(disableSignup ? { disableSignup: true } : undefined);
    } catch (error) {
      onNoticeChange?.(describeTelegramAuthError(error));
      return;
    }

    await onAuthenticated({
      authMethod: "telegram",
    });
  }

  return (
    <HostedInlineAuthButton
      active={active}
      busy={completionPending}
      disabled={disabled || !ready || loading || completionPending}
      icon={
        completionPending
          ? <Spinner aria-hidden="true" />
          : <TelegramIcon className="h-5 w-5" />
      }
      onClick={handleClick}
    >
      {completionPending ? "Finishing..." : loading ? "Connecting..." : "Telegram"}
    </HostedInlineAuthButton>
  );
}
