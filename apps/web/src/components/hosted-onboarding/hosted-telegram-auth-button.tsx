"use client";

import { useLoginWithTelegram, usePrivy } from "@privy-io/react-auth";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { TelegramIcon } from "@/src/components/homepage/telegram-icon";
import { Spinner } from "@/src/components/ui/spinner";

import {
  describeTelegramAuthError,
  type TelegramAuthNotice,
} from "./hosted-auth-shared";
import { HostedInlineAuthButton } from "./hosted-inline-auth-button";
import type { HostedPrivyAuthenticatedInput } from "./use-hosted-auth-completion";

const TELEGRAM_WIDGET_READY_POLL_MS = 100;
const TELEGRAM_WIDGET_READY_TIMEOUT_MS = 20_000;

export function HostedTelegramAuthButton({
  active = false,
  completionPending = false,
  disableSignup = false,
  disabled = false,
  onAuthCancel,
  onAuthQueue,
  onAuthQueueCancel,
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
  onAuthQueue?: () => boolean;
  onAuthQueueCancel?: () => void;
  onAuthStart?: () => boolean;
  onActivate: () => void;
  onAuthenticated: (input: HostedPrivyAuthenticatedInput) => Promise<void> | void;
  onNoticeChange?: (notice: TelegramAuthNotice | null) => void;
}) {
  const { login, state } = useLoginWithTelegram();
  const { authenticated, ready } = usePrivy();
  const [telegramLoginPhase, setTelegramLoginPhase] = useState<
    "idle" | "waiting" | "login"
  >("idle");
  const [telegramWidgetReady, setTelegramWidgetReady] = useState(false);
  const telegramLoginInFlightRef = useRef(false);
  const previouslyActiveRef = useRef(active);
  const pendingTelegramLoginRef = useRef<{
    queueClaimed: boolean;
    startAuthOnDrain: boolean;
  } | null>(null);

  const telegramReadyToContinue =
    telegramLoginPhase === "waiting" && ready && telegramWidgetReady;
  const loading =
    (telegramLoginPhase === "waiting" && !telegramReadyToContinue)
    || telegramLoginPhase === "login"
    || state.status === "loading";

  function cancelPendingTelegramLogin() {
    const pendingLogin = pendingTelegramLoginRef.current;
    if (!pendingLogin) return;

    pendingTelegramLoginRef.current = null;
    setTelegramLoginPhase("idle");
    setTelegramWidgetReady(false);
    if (pendingLogin.queueClaimed) {
      onAuthQueueCancel?.();
    }
  }

  const cancelPendingTelegramLoginEffect = useEffectEvent(() => {
    cancelPendingTelegramLogin();
  });
  const markTelegramWidgetReadyEffect = useEffectEvent(() => {
    const pendingLogin = pendingTelegramLoginRef.current;
    if (!pendingLogin) return;

    setTelegramWidgetReady(true);
    if (pendingLogin.queueClaimed && onAuthQueueCancel) {
      pendingLogin.queueClaimed = false;
      onAuthQueueCancel();
    }
  });

  useEffect(() => {
    const pendingLogin = pendingTelegramLoginRef.current;
    if (!pendingLogin) return;

    if (authenticated && pendingLogin.startAuthOnDrain) {
      cancelPendingTelegramLoginEffect();
    }
  }, [authenticated]);

  useEffect(() => {
    const wasActive = previouslyActiveRef.current;
    previouslyActiveRef.current = active;
    if (wasActive && !active) {
      cancelPendingTelegramLoginEffect();
    }
  }, [active]);

  useEffect(() => {
    if (telegramLoginPhase !== "waiting" || !ready) return;

    let stopped = false;
    let pollId = 0;
    const stopPolling = () => {
      stopped = true;
      window.clearInterval(pollId);
    };
    const checkWidget = () => {
      if (stopped || !isTelegramLoginWidgetReady()) return;
      stopPolling();
      markTelegramWidgetReadyEffect();
    };
    const initialCheckId = window.setTimeout(checkWidget, 0);
    pollId = window.setInterval(checkWidget, TELEGRAM_WIDGET_READY_POLL_MS);
    const timeoutId = window.setTimeout(
      stopPolling,
      TELEGRAM_WIDGET_READY_TIMEOUT_MS,
    );

    return () => {
      stopPolling();
      window.clearTimeout(initialCheckId);
      window.clearTimeout(timeoutId);
    };
  }, [ready, telegramLoginPhase]);

  async function handleClick() {
    const pendingLogin = pendingTelegramLoginRef.current;
    if (pendingLogin && telegramReadyToContinue && ready) {
      if (
        pendingLogin.startAuthOnDrain
        && onAuthStart
        && !onAuthStart()
      ) {
        cancelPendingTelegramLogin();
        return;
      }

      pendingTelegramLoginRef.current = null;
      setTelegramLoginPhase("login");
      await runTelegramLogin();
      return;
    }

    if (
      telegramLoginInFlightRef.current
      || pendingLogin !== null
    ) {
      return;
    }

    if (!ready || !isTelegramLoginWidgetReady()) {
      const startAuthOnDrain = onAuthQueue !== undefined;
      const authClaimed = onAuthQueue
        ? onAuthQueue()
        : onAuthStart
          ? onAuthStart()
          : true;
      if (!authClaimed) return;

      onActivate();
      onNoticeChange?.(null);
      queueTelegramLogin(startAuthOnDrain);
      return;
    }

    if (onAuthStart && !onAuthStart()) return;

    onActivate();
    onNoticeChange?.(null);
    setTelegramLoginPhase("login");
    await runTelegramLogin();
  }

  function queueTelegramLogin(startAuthOnDrain: boolean) {
    pendingTelegramLoginRef.current = {
      queueClaimed: startAuthOnDrain,
      startAuthOnDrain,
    };
    setTelegramWidgetReady(false);
    setTelegramLoginPhase("waiting");
  }

  async function runTelegramLogin() {
    if (telegramLoginInFlightRef.current) {
      return;
    }
    if (!ready || !isTelegramLoginWidgetReady()) {
      onAuthCancel?.();
      setTelegramLoginPhase("idle");
      setTelegramWidgetReady(false);
      return;
    }
    telegramLoginInFlightRef.current = true;

    try {
      await login(disableSignup ? { disableSignup: true } : undefined);
    } catch (error) {
      onAuthCancel?.();
      onNoticeChange?.(describeTelegramAuthError(error));
      return;
    } finally {
      telegramLoginInFlightRef.current = false;
      setTelegramLoginPhase("idle");
      setTelegramWidgetReady(false);
    }

    await onAuthenticated({
      authMethod: "telegram",
    });
  }

  return (
    <HostedTelegramAuthButtonPresentation
      active={active}
      completionPending={completionPending}
      disabled={disabled || loading || completionPending}
      loading={loading}
      onClick={handleClick}
      readyToContinue={telegramReadyToContinue}
    />
  );
}

function isTelegramLoginWidgetReady(): boolean {
  if (typeof window === "undefined") return false;

  const telegram = Reflect.get(window, "Telegram");
  if (typeof telegram !== "object" || telegram === null) return false;
  const login = Reflect.get(telegram, "Login");
  if (typeof login !== "object" || login === null) return false;

  return typeof Reflect.get(login, "auth") === "function";
}

export function HostedTelegramAuthButtonPresentation({
  active = false,
  completionPending = false,
  disabled = false,
  loading = false,
  onClick,
  readyToContinue = false,
}: {
  active?: boolean;
  completionPending?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  readyToContinue?: boolean;
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
            : readyToContinue
              ? (
                  <>
                    Continue
                    <span className="sr-only"> with Telegram</span>
                  </>
                )
              : "Telegram"}
      </HostedInlineAuthButton>
      {readyToContinue ? (
        <p
          aria-atomic="true"
          aria-live="polite"
          role="status"
          className="px-1 text-xs leading-relaxed text-muted-foreground"
        >
          Telegram is ready. Continue to open sign in.
        </p>
      ) : null}
    </div>
  );
}
