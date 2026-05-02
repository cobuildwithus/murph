"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  resolveHostedTelegramSettingsDisplayState,
  syncHostedLinkedTelegram,
  type HostedTelegramSyncOverride,
  type HostedTelegramSyncResult,
} from "./hosted-telegram-settings-helpers";
import { ConnectedAccountCard, SettingsContactLink, SettingsStatusLine } from "./connected-account-card";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { toErrorMessage } from "./hosted-settings-utils";

const MURPH_TELEGRAM_BOT_USERNAME = "withmurph_bot";
const MURPH_TELEGRAM_BOT_URL = `https://t.me/${MURPH_TELEGRAM_BOT_USERNAME}`;

type PrivyTelegramMethods = ReturnType<typeof usePrivy> & {
  linkTelegram?: (input?: unknown) => Promise<unknown>;
};

export function HostedTelegramCardSettings(props: {
  authenticated: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  onSynced?: (payload: HostedTelegramSyncResult) => Promise<void> | void;
}) {
  const { authenticated, initialLinkedAccounts, onSynced } = props;
  const { linkTelegram } = usePrivy() as PrivyTelegramMethods;
  const { refreshUser, user } = useUser();
  const autoSyncedTelegramUserIdRef = useRef<string | null>(null);
  const syncRequestSequenceRef = useRef(0);
  const [botLink, setBotLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [isQuietSyncingTelegram, setIsQuietSyncingTelegram] = useState(false);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncedTelegramOverride, setSyncedTelegramOverride] = useState<HostedTelegramSyncOverride | null>(null);

  const displayState = resolveHostedTelegramSettingsDisplayState({
    syncedTelegramOverride,
    user: user ?? { linkedAccounts: initialLinkedAccounts },
  });
  const currentTelegram = displayState.currentTelegram;
  const isBusy = isLinkingTelegram || (isSyncingTelegram && !isQuietSyncingTelegram);

  const syncLinkedTelegram = useCallback(async (
    mode: "link" | "resync",
    expectedTelegramUserId: string | null,
    options?: { quietSuccess?: boolean },
  ) => {
    if (!expectedTelegramUserId) {
      setErrorMessage("Telegram was linked but the account details aren't available yet. Try again.");
      return;
    }

    autoSyncedTelegramUserIdRef.current = expectedTelegramUserId;
    const syncRequestSequence = syncRequestSequenceRef.current + 1;
    syncRequestSequenceRef.current = syncRequestSequence;
    setIsQuietSyncingTelegram(options?.quietSuccess === true);
    setIsSyncingTelegram(true);

    try {
      const syncPresentation = await syncHostedLinkedTelegram({
        expectedTelegramUserId,
        mode,
      });

      if (syncRequestSequenceRef.current !== syncRequestSequence) return;

      setSuccessMessage(options?.quietSuccess ? null : syncPresentation.successMessage);
      setErrorMessage(syncPresentation.errorMessage);

      const { syncResult } = syncPresentation;
      if (syncResult) {
        setBotLink(syncResult.botLink);
        setSyncedTelegramOverride({
          telegramUserId: syncResult.telegramUserId,
          username: syncResult.telegramUsername,
        });

        if (mode === "link") {
          try {
            await onSynced?.(syncResult);
          } catch (error) {
            setErrorMessage(toErrorMessage(error, "Telegram was linked, but we could not refresh the page state yet."));
          }
        }
      }
    } finally {
      if (syncRequestSequenceRef.current === syncRequestSequence) {
        setIsQuietSyncingTelegram(false);
        setIsSyncingTelegram(false);
      }
    }
  }, [onSynced]);

  useEffect(() => {
    if (!authenticated || isLinkingTelegram || isSyncingTelegram) return;

    const telegramUserId = currentTelegram?.telegramUserId ?? null;
    if (!telegramUserId || autoSyncedTelegramUserIdRef.current === telegramUserId) return;

    void syncLinkedTelegram("resync", telegramUserId, { quietSuccess: true });
  }, [
    currentTelegram?.telegramUserId,
    authenticated,
    isLinkingTelegram,
    isSyncingTelegram,
    syncLinkedTelegram,
  ]);

  async function handleLinkTelegram() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!authenticated) {
      setErrorMessage("Please sign in first to link Telegram.");
      return;
    }

    if (typeof linkTelegram !== "function") {
      setErrorMessage("Telegram linking is not available yet.");
      return;
    }

    setIsLinkingTelegram(true);

    try {
      await linkTelegram();
      const refreshedUser = await refreshUser().catch(() => null);
      const refreshedTelegram = resolveHostedTelegramSettingsDisplayState({
        user: refreshedUser ?? user ?? { linkedAccounts: initialLinkedAccounts },
      }).currentTelegram;

      await syncLinkedTelegram("link", refreshedTelegram?.telegramUserId ?? null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not link Telegram right now."));
    } finally {
      setIsLinkingTelegram(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="space-y-5">
        <HostedSettingsSessionState
          authenticated={authenticated}
          signedOutDescription="Sign in to manage your Telegram connection."
        />
      </div>
    );
  }

  const telegramValue = currentTelegram?.username
    ? `@${currentTelegram.username}`
    : currentTelegram
      ? `Telegram user ${currentTelegram.telegramUserId}`
      : null;

  const statusTone = errorMessage ? "destructive" : successMessage ? "success" : "neutral";
  const statusMessage =
    errorMessage ?? successMessage ?? (isSyncingTelegram && !isQuietSyncingTelegram ? "Saving your Telegram connection…" : null);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Telegram</h2>
      </div>

      {telegramValue ? (
        <ConnectedAccountCard
          value={telegramValue}
          action={
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => void handleLinkTelegram()}
                disabled={isBusy}
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
              >
                {isLinkingTelegram ? "Changing..." : "Change"}
              </Button>
              {botLink ? (
                <Button
                  render={<a href={botLink} target="_blank" rel="noreferrer" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Open bot
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <ConnectedAccountCard
          value="Not connected"
          variant="empty"
          action={
            <Button
              type="button"
              size="sm"
              onClick={() => void handleLinkTelegram()}
              disabled={isBusy}
            >
              {isLinkingTelegram ? "Connecting..." : "Link Telegram"}
            </Button>
          }
        />
      )}

      {currentTelegram ? (
        <SettingsContactLink
          href={MURPH_TELEGRAM_BOT_URL}
          label={`Message @${MURPH_TELEGRAM_BOT_USERNAME} on Telegram`}
          external
        >
          Message @{MURPH_TELEGRAM_BOT_USERNAME}
        </SettingsContactLink>
      ) : null}

      <SettingsStatusLine message={statusMessage} tone={statusTone} />
    </div>
  );
}
