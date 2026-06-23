"use client";

import { useEffect, useRef, useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import type { HostedCodexAuthConnectionView } from "@/src/lib/codex-auth/store";

const HOSTED_CODEX_AUTH_POLL_MS = 1_500;
const HOSTED_CODEX_AUTH_POPUP_NAME = "murph-chatgpt-connect";
const HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE = "HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE";

export function HostedChatGptSettings(props: {
  initialConnection: HostedCodexAuthConnectionView;
}) {
  const [connection, setConnection] = useState(props.initialConnection);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const openedVerificationUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (connection.state !== "connecting" && connection.state !== "disconnecting") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await requestHostedOnboardingJson<HostedCodexAuthConnectionView>({
          method: "GET",
          url: "/api/settings/chatgpt",
        });
        if (!cancelled) {
          setConnection(next);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(formatHostedChatGptError(error));
        }
      }
    };

    const interval = window.setInterval(() => void poll(), HOSTED_CODEX_AUTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connection.state]);

  useEffect(() => {
    if (connection.state === "connected") {
      popupRef.current?.close();
      popupRef.current = null;
      openedVerificationUrlRef.current = null;
      return;
    }
    if (
      connection.state !== "connecting"
      || !connection.verificationUrl
      || openedVerificationUrlRef.current === connection.verificationUrl
    ) {
      return;
    }

    openedVerificationUrlRef.current = connection.verificationUrl;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.opener = null;
      popupRef.current.location.replace(connection.verificationUrl);
    }
  }, [connection]);

  async function connectChatGpt() {
    if (pending) {
      return;
    }

    const popup = window.open(
      "about:blank",
      HOSTED_CODEX_AUTH_POPUP_NAME,
      "popup,width=560,height=760",
    );
    if (popup) {
      popup.document.title = "Connect ChatGPT";
      popup.document.body.textContent = "Starting ChatGPT sign in...";
      popupRef.current = popup;
    }

    setPending(true);
    setErrorMessage(null);
    try {
      const next = await requestHostedOnboardingJson<HostedCodexAuthConnectionView>({
        method: "POST",
        payload: {},
        url: "/api/settings/chatgpt",
      });
      setConnection(next);
    } catch (error) {
      popup?.close();
      popupRef.current = null;
      if (isHostedCodexAuthRuntimeUnavailableError(error)) {
        setConnection({ state: "connect_error" });
      }
      setErrorMessage(formatHostedChatGptError(error));
    } finally {
      setPending(false);
    }
  }

  async function disconnectChatGpt() {
    if (pending) {
      return;
    }

    setPending(true);
    setErrorMessage(null);
    try {
      const next = await requestHostedOnboardingJson<HostedCodexAuthConnectionView>({
        method: "DELETE",
        payload: {},
        url: "/api/settings/chatgpt",
      });
      setConnection(next);
    } catch (error) {
      if (isHostedCodexAuthRuntimeUnavailableError(error)) {
        setConnection({ state: "disconnect_error" });
      }
      setErrorMessage(formatHostedChatGptError(error));
    } finally {
      setPending(false);
    }
  }

  const connecting = connection.state === "connecting";
  const connected = connection.state === "connected";
  const disconnecting = connection.state === "disconnecting";
  const connectFailed = connection.state === "connect_error" || connection.state === "error";
  const disconnectFailed = connection.state === "disconnect_error";
  const visibleErrorMessage = errorMessage
    ?? (connectFailed
      ? "Could not finish ChatGPT sign in. Try connecting again."
      : disconnectFailed
        ? "Could not disconnect ChatGPT. Try disconnecting again."
        : null);

  return (
    <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-serif text-2xl font-semibold text-foreground">
            ChatGPT
          </p>
          <Badge className="font-mono text-[10px] uppercase" variant="secondary">
            {connected
              ? "Connected"
              : connecting
                ? "Connecting"
                : disconnecting
                  ? "Disconnecting"
                  : disconnectFailed
                    ? "Disconnect failed"
                    : connectFailed
                      ? "Connection failed"
                      : "Not connected"}
          </Badge>
        </div>
        <p className="max-w-xl text-sm text-pretty text-muted-foreground">
          Use your ChatGPT account for Codex tasks in Murph.
        </p>

        {connecting && connection.userCode ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
            <p className="text-muted-foreground">
              Enter this one-time code on OpenAI&apos;s sign-in page:
            </p>
            <code className="block font-mono text-lg font-semibold text-foreground">
              {connection.userCode}
            </code>
            {connection.verificationUrl ? (
              <a
                className="inline-flex font-medium text-primary underline underline-offset-4"
                href={connection.verificationUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open ChatGPT sign in
              </a>
            ) : null}
          </div>
        ) : null}

        {visibleErrorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {visibleErrorMessage}
          </p>
        ) : null}
      </div>

      <div className="shrink-0">
        {connected || disconnecting || disconnectFailed ? (
          <Button
            disabled={pending || disconnecting}
            onClick={() => void disconnectChatGpt()}
            type="button"
            variant="outline"
          >
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </Button>
        ) : (
          <Button
            disabled={pending || connecting}
            onClick={() => void connectChatGpt()}
            type="button"
          >
            {pending || connecting ? "Connecting..." : "Connect ChatGPT"}
          </Button>
        )}
      </div>
    </div>
  );
}

function formatHostedChatGptError(error: unknown): string {
  return error instanceof HostedOnboardingApiError
    ? error.message
    : "Could not update your ChatGPT connection right now.";
}

function isHostedCodexAuthRuntimeUnavailableError(
  error: unknown,
): error is HostedOnboardingApiError {
  return error instanceof HostedOnboardingApiError
    && error.code === HOSTED_CODEX_AUTH_RUNTIME_UNAVAILABLE
    && error.retryable;
}
