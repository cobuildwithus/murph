"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  resolveHostedTelegramSettingsDisplayState,
  syncHostedLinkedTelegram,
} from "./hosted-telegram-settings-helpers";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedTelegramSettingsContent } from "./hosted-telegram-settings-sections";
import { toErrorMessage } from "./hosted-settings-utils";

type PrivyTelegramMethods = ReturnType<typeof usePrivy> & {
  linkTelegram?: (input?: unknown) => Promise<unknown>;
};

export function HostedTelegramSettings(props: {
  authenticated: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
}) {
  const { linkTelegram } = usePrivy() as PrivyTelegramMethods;
  const { refreshUser, user } = useUser();
  const [botLink, setBotLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncedTelegramOverride, setSyncedTelegramOverride] = useState<HostedPrivyTelegramAccount | null>(null);

  const displayState = resolveHostedTelegramSettingsDisplayState({
    syncedTelegramOverride,
    user: {
      linkedAccounts: props.initialLinkedAccounts,
    },
  });
  const currentTelegram = displayState.currentTelegram;
  const canManageTelegram = props.authenticated;
  const isBusy = isLinkingTelegram || isSyncingTelegram;

  async function handleLinkTelegram() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!props.authenticated) {
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
        user: refreshedUser ?? user,
      }).currentTelegram;

      await syncLinkedTelegram("link", refreshedTelegram?.telegramUserId ?? null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not link Telegram right now."));
    } finally {
      setIsLinkingTelegram(false);
    }
  }

  async function handleSyncTelegram() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentTelegram?.telegramUserId) {
      setErrorMessage("Link Telegram in Privy before you try to sync it.");
      return;
    }

    await syncLinkedTelegram("resync", currentTelegram.telegramUserId);
  }

  async function syncLinkedTelegram(mode: "link" | "resync", expectedTelegramUserId: string | null) {
    if (!expectedTelegramUserId) {
      setErrorMessage("Telegram was linked but the account details aren't available yet. Try again.");
      return;
    }

    setIsSyncingTelegram(true);

    try {
      const syncPresentation = await syncHostedLinkedTelegram({
        expectedTelegramUserId,
        mode,
      });
      setSuccessMessage(syncPresentation.successMessage);
      setErrorMessage(syncPresentation.errorMessage);

      const { syncResult } = syncPresentation;

      if (syncResult) {
        setBotLink(syncResult.botLink);
        setSyncedTelegramOverride((current) => ({
          firstName: current?.firstName ?? null,
          lastName: current?.lastName ?? null,
          photoUrl: current?.photoUrl ?? null,
          telegramUserId: syncResult.telegramUserId,
          username: syncResult.telegramUsername,
        }));
      }
    } finally {
      setIsSyncingTelegram(false);
    }
  }

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <AlertTitle>Telegram updated</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update Telegram</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {isSyncingTelegram ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Finishing Telegram sync</AlertTitle>
          <AlertDescription>
            Saving your Telegram connection&hellip;
          </AlertDescription>
        </Alert>
      ) : null}

      {!canManageTelegram ? (
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your Telegram connection."
        />
      ) : (
        <HostedTelegramSettingsContent
          botLink={botLink}
          currentTelegram={currentTelegram}
          isBusy={isBusy}
          isLinkingTelegram={isLinkingTelegram}
          isSyncingTelegram={isSyncingTelegram}
          onLinkTelegram={handleLinkTelegram}
          onSyncTelegram={handleSyncTelegram}
        />
      )}
    </div>
  );
}
