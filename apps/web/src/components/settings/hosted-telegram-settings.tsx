"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useState } from "react";

import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  resolveHostedTelegramSettingsDisplayState,
  syncHostedLinkedTelegram,
} from "./hosted-telegram-settings-helpers";

interface HostedTelegramSettingsProps {
  expectedPrivyUserId: string;
}

type PrivyTelegramMethods = ReturnType<typeof usePrivy> & {
  linkTelegram?: (input?: unknown) => Promise<unknown>;
};

export function HostedTelegramSettings(props: HostedTelegramSettingsProps) {
  return <HostedTelegramSettingsInner {...props} />;
}

function HostedTelegramSettingsInner({ expectedPrivyUserId }: HostedTelegramSettingsProps) {
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
  const canManageTelegram = ready && authenticated && user?.id === expectedPrivyUserId;
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

    if (user.id !== expectedPrivyUserId) {
      setErrorMessage("This Privy session belongs to a different account than the current hosted session.");
      return;
    }

    if (typeof linkTelegram !== "function") {
      setErrorMessage("Telegram linking is not available in this Privy session yet.");
      return;
    }

    setIsLinkingTelegram(true);

    try {
      await linkTelegram();
      await refreshUser().catch(() => null);
      await syncLinkedTelegram("link");
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

    await syncLinkedTelegram("resync");
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

  async function syncLinkedTelegram(mode: "link" | "resync") {
    setIsSyncingTelegram(true);

    try {
      const syncPresentation = await syncHostedLinkedTelegram({
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
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm leading-snug text-green-700">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {isSyncingTelegram ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          Finishing the hosted Telegram connection and updating your assistant routing.
        </div>
      ) : null}

      {!ready || isLoadingAuthenticatedUser ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          Checking your Privy session before we show Telegram settings.
        </div>
      ) : !authenticated ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
          Open your latest Murph invite or sign-in flow in this browser first. We need the matching Privy session
          before we can link Telegram on your hosted account.
        </div>
      ) : !user ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          Loading your Privy profile.
        </div>
      ) : user.id !== expectedPrivyUserId ? (
        <div className="space-y-3 rounded border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-700">
          <p>
            You are signed in to a different Privy account than the current hosted Murph session. Sign out here,
            reopen the latest invite link, and try again.
          </p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="inline-flex rounded border border-red-300 bg-white px-4 py-2 font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? "Signing out..." : "Sign out of Privy"}
          </button>
        </div>
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
            <button
              type="button"
              onClick={() => void handleLinkTelegram()}
              disabled={isBusy}
              className="inline-flex rounded bg-olive px-4 py-2 font-semibold text-white transition-colors hover:bg-olive/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLinkingTelegram ? "Linking Telegram..." : currentTelegram ? "Relink Telegram" : "Link Telegram"}
            </button>
            <button
              type="button"
              onClick={() => void handleSyncTelegram()}
              disabled={isBusy || !canManageTelegram || !currentTelegram}
              className="inline-flex rounded border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSyncingTelegram ? "Syncing..." : "Sync to hosted assistant"}
            </button>
            {botLink ? (
              <a
                href={botLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded border border-stone-200 bg-white px-4 py-2 font-semibold text-stone-700 transition-colors hover:bg-stone-50"
              >
                Open Telegram bot
              </a>
            ) : null}
          </div>

          <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
            Minimal setup: link Telegram here, open the bot, and press Start once. After that, direct messages to the
            bot can route into your hosted assistant.
          </div>
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
