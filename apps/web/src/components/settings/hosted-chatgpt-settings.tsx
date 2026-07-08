"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, ExternalLink, RefreshCw } from "lucide-react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import type {
  HostedCodexAuthConnectionView,
} from "@/src/lib/codex-auth/store";
import { cn } from "@/src/lib/utils";

import { SettingsStatusLine } from "./connected-account-card";

const CHATGPT_SETTINGS_URL = "/api/settings/chatgpt";
const POLL_MS = 2_000;

export function HostedChatGptSettings(props: {
  authenticated: boolean;
  initialConnection: HostedCodexAuthConnectionView | null;
}) {
  if (!props.authenticated || !props.initialConnection) {
    return null;
  }

  return <ChatGptConnection initialConnection={props.initialConnection} />;
}

function ChatGptConnection(props: {
  initialConnection: HostedCodexAuthConnectionView;
}) {
  const [connection, setConnection] =
    useState<HostedCodexAuthConnectionView>(props.initialConnection);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<"connect" | "disconnect" | "refresh" | null>(null);
  const isAttemptRunning =
    connection.state === "connecting" || connection.state === "disconnecting";

  const refresh = useCallback(async () => {
    const next = await requestHostedOnboardingJson<HostedCodexAuthConnectionView>({
      url: CHATGPT_SETTINGS_URL,
    });
    setConnection(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isAttemptRunning) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(timeout);
  }, [isAttemptRunning, refresh, connection]);

  const runAction = useCallback(async (action: "connect" | "disconnect" | "refresh") => {
    setError(null);
    setPendingAction(action);
    try {
      const next = action === "refresh"
        ? await refresh()
        : await requestHostedOnboardingJson<HostedCodexAuthConnectionView>({
            method: action === "connect" ? "POST" : "DELETE",
            payload: {},
            url: CHATGPT_SETTINGS_URL,
          });
      setConnection(next);
    } catch (caught) {
      setError(caught instanceof HostedOnboardingApiError
        ? caught.message
        : "We couldn't update your ChatGPT connection. Try again.");
    } finally {
      setPendingAction(null);
    }
  }, [refresh]);

  const isConnected = connection.state === "connected";
  const action = readChatGptConnectionAction(connection);
  const valueText = readChatGptConnectionValue(connection);
  const statusText = readChatGptConnectionStatus(connection, error);
  const statusTone = error || connection.state === "connect_error"
      || connection.state === "disconnect_error"
      || connection.state === "error"
    ? "destructive"
    : isConnected
      ? "success"
      : "neutral";
  const iconClass = isConnected ? "text-[#7a8c6e]" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
        <Bot
          className={cn("size-[18px] shrink-0", iconClass)}
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
            ChatGPT
          </span>
          <p
            className={cn(
              "break-words font-serif text-base tracking-tight",
              isConnected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {valueText}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connection.state === "connecting" && connection.verificationUrl ? (
            <a
              href={connection.verificationUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open ChatGPT verification page"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open ChatGPT
            </a>
          ) : null}
          {action === "refresh" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={pendingAction !== null}
              aria-label="Refresh ChatGPT connection"
              onClick={() => void runAction("refresh")}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="default"
              variant={isConnected ? "outline" : "default"}
              disabled={pendingAction !== null || connection.state === "disconnecting"}
              onClick={() => void runAction(action)}
            >
              {readChatGptConnectionButton(connection, pendingAction)}
            </Button>
          )}
        </div>
      </div>
      <SettingsStatusLine message={statusText} tone={statusTone} />
    </div>
  );
}

function readChatGptConnectionValue(connection: HostedCodexAuthConnectionView): string {
  switch (connection.state) {
    case "connected":
      return "Connected";
    case "connecting":
      return connection.userCode ? `Code ${connection.userCode}` : "Starting connection";
    case "disconnecting":
      return "Disconnecting";
    case "connect_error":
      return "Connection failed";
    case "disconnect_error":
      return "Disconnect failed";
    case "error":
      return "Needs attention";
    case "disconnected":
      return "Not connected";
  }
}

function readChatGptConnectionStatus(
  connection: HostedCodexAuthConnectionView,
  error: string | null,
): string | null {
  if (error) {
    return error;
  }
  if (connection.state === "connecting" && connection.userCode) {
    return "Waiting for ChatGPT confirmation.";
  }
  if (connection.state === "connecting") {
    return "Waiting for a verification code.";
  }
  if (connection.state === "disconnecting") {
    return "Removing ChatGPT access.";
  }
  if (connection.state === "connect_error") {
    return "Start a new connection attempt.";
  }
  if (connection.state === "disconnect_error") {
    return "Try disconnecting again.";
  }
  if (connection.state === "error") {
    return "Start a new connection attempt.";
  }
  return null;
}

function readChatGptConnectionAction(
  connection: HostedCodexAuthConnectionView,
): "connect" | "disconnect" | "refresh" {
  if (connection.state === "connected" || connection.state === "disconnect_error") {
    return "disconnect";
  }
  if (connection.state === "connecting" || connection.state === "disconnecting") {
    return "refresh";
  }
  return "connect";
}

function readChatGptConnectionButton(
  connection: HostedCodexAuthConnectionView,
  pendingAction: "connect" | "disconnect" | "refresh" | null,
): string {
  if (pendingAction === "connect") {
    return "Connecting...";
  }
  if (pendingAction === "disconnect") {
    return "Disconnecting...";
  }
  if (connection.state === "connected" || connection.state === "disconnect_error") {
    return "Disconnect";
  }
  return "Connect";
}
