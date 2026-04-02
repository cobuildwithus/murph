"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  resolveHostedTelegramSettingsDisplayState,
  syncHostedLinkedTelegram,
} from "./hosted-telegram-settings-helpers";

type PrivyTelegramMethods = ReturnType<typeof usePrivy> & {
  linkTelegram?: (input?: unknown) => Promise<unknown>;
};

export function HostedTelegramSettings() {
  return <HostedTelegramSettingsInner />;
}

function HostedTelegramSettingsInner() {
  const { authenticated, linkTelegram, logout, ready } = usePrivy() as PrivyTelegramMethods;
  const { refreshUser, user } = useUser();
  const [botLink, setBotLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncedTelegramOverride, setSyncedTelegramOverride] = useState<HostedPrivyTelegramAccount | null>(null);

  const displayState = resolveHostedTelegramSettingsDisplayState({
    syncedTelegramOverride,
    user,
  });
  const currentTelegram = displayState.currentTelegram;
  const canManageTelegram = ready && authenticated && Boolean(user);
  const isLoadingAuthenticatedUser = ready && authenticated && !user;
  const isBusy = isLinkingTelegram || isSyncingTelegram;

  async function handleLinkTelegram() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!ready) {
      setErrorMessage("We are still loading your Privy session. Try again in a moment.");
      return;
    }

    if (!authenticated) {
      setErrorMessage("Sign in with your existing hosted account before you try to link Telegram.");
      return;
    }

    if (!user) {
      setErrorMessage("We are still loading your account details. Try again in a moment.");
      return;
    }

    if (typeof linkTelegram !== "function") {
      setErrorMessage("Telegram linking is not available in this Privy session yet.");
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
      setErrorMessage(toErrorMessage(error, "We could not link Telegram from Privy yet."));
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

  async function handleLogout() {
    setErrorMessage(null);
    setLoggingOut(true);

    try {
      await logout();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign out of the current Privy session."));
    } finally {
      setLoggingOut(false);
    }
  }

  async function syncLinkedTelegram(mode: "link" | "resync", expectedTelegramUserId: string | null) {
    if (!expectedTelegramUserId) {
      setErrorMessage("Telegram linked in Privy, but the latest Telegram user id is not available yet. Try again.");
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
            Finishing the hosted Telegram connection and updating your assistant routing.
          </AlertDescription>
        </Alert>
      ) : null}

      {!ready || isLoadingAuthenticatedUser ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Checking your session</AlertTitle>
          <AlertDescription>
            Checking your Privy session before we show Telegram settings.
          </AlertDescription>
        </Alert>
      ) : !authenticated ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Open your latest Murph invite or sign-in flow in this browser first. We need your Privy session
            before we can link Telegram on your account.
          </AlertDescription>
        </Alert>
      ) : !canManageTelegram ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Loading your profile</AlertTitle>
          <AlertDescription>
            Loading your Privy profile before we show Telegram settings.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900">Link Telegram</h2>
            <p className="text-sm leading-relaxed text-stone-500">
              Connect your Telegram account in Privy, then press Start once in the Murph bot so hosted Telegram
              messages can route to your assistant.
            </p>
          </div>

          <dl className="grid gap-4 rounded border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-2">
            <div className="space-y-1">
              <dt className="font-semibold text-stone-500">Linked Telegram</dt>
              <dd>
                {currentTelegram
                  ? currentTelegram.username
                    ? `@${currentTelegram.username}`
                    : `Telegram user ${currentTelegram.telegramUserId}`
                  : "Not linked yet"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="font-semibold text-stone-500">Telegram user id</dt>
              <dd className="break-all">{currentTelegram?.telegramUserId ?? "Waiting for link"}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => void handleLinkTelegram()}
              disabled={isBusy}
              size="lg"
            >
              {isLinkingTelegram ? "Linking Telegram..." : currentTelegram ? "Relink Telegram" : "Link Telegram"}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSyncTelegram()}
              disabled={isBusy || !canManageTelegram || !currentTelegram}
              variant="outline"
              size="lg"
            >
              {isSyncingTelegram ? "Syncing..." : "Sync to hosted assistant"}
            </Button>
            {botLink ? (
              <Button
                render={<a href={botLink} target="_blank" rel="noreferrer" />}
                nativeButton={false}
                variant="outline"
                size="lg"
              >
                Open Telegram bot
              </Button>
            ) : null}
          </div>

          <Alert className="border-stone-200 bg-stone-50">
            <AlertTitle>Minimal setup</AlertTitle>
            <AlertDescription>
              Link Telegram here, open the bot, and press Start once. After that, direct messages to the bot can route
              into your hosted assistant.
            </AlertDescription>
          </Alert>

          <Alert className="border-stone-200 bg-white">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Need to switch accounts? Sign out of the current Privy session here, then restart the Murph sign-in flow.
              </span>
              <Button type="button" onClick={() => void handleLogout()} disabled={loggingOut} variant="outline" size="lg">
                {loggingOut ? "Signing out..." : "Sign out of Privy"}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}
