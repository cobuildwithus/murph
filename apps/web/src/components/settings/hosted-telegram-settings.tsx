"use client";

import { useLinkAccount, useUser } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import type { JoinInviteTelegramAccountSeed } from "@/src/components/hosted-onboarding/join-invite-page-model";
import {
  ContactSupportAction,
  shouldShowContactSupportAction,
} from "@/src/components/support/contact-support-action";
import type { HostedPrivyLinkedAccountContainer } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  resolveHostedPrivyTelegramDisplayState,
  resolveHostedTelegramSettingsDisplayState,
  syncHostedLinkedTelegram,
  toHostedTelegramLinkErrorMessage,
  type HostedTelegramSyncOverride,
  type HostedTelegramSyncResult,
} from "./hosted-telegram-settings-helpers";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedTelegramSettingsContent } from "./hosted-telegram-settings-sections";
import { toErrorMessage } from "./hosted-settings-utils";

export function ConnectTelegram(props: {
  authenticated: boolean;
  initialTelegramAccount: JoinInviteTelegramAccountSeed | null;
  onSynced?: (payload: HostedTelegramSyncResult) => Promise<void> | void;
}) {
  const { authenticated, initialTelegramAccount, onSynced } = props;
  const { refreshUser } = useUser();
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
    initialTelegramAccount,
    syncedTelegramOverride,
  });
  const currentTelegram = displayState.currentTelegram;
  const canManageTelegram = authenticated;
  const isBusy = isLinkingTelegram || (isSyncingTelegram && !isQuietSyncingTelegram);

  const { linkTelegram } = useLinkAccount({
    onError: (error, details) => {
      if (!details || details.linkMethod === "telegram") {
        setIsLinkingTelegram(false);
        setErrorMessage(toHostedTelegramLinkErrorMessage(error));
      }
    },
    onSuccess: (params) => {
      if (params.linkMethod === "telegram") {
        void handleLinkedTelegramAccount(params.user);
      }
    },
  });

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

      if (syncRequestSequenceRef.current !== syncRequestSequence) {
        return;
      }

      setSuccessMessage(options?.quietSuccess ? null : syncPresentation.successMessage);
      setErrorMessage(syncPresentation.errorMessage);

      const { syncResult } = syncPresentation;

      if (syncResult) {
        setBotLink(syncResult.botLink);
        setSyncedTelegramOverride({
          telegramUserId: syncResult.telegramUserId,
          username: syncResult.telegramUsername,
        });

        try {
          await onSynced?.(syncResult);
        } catch (error) {
          setErrorMessage(toErrorMessage(error, "Telegram is linked, but the page didn't refresh. Reload to see it."));
        }
      }
    } finally {
      if (syncRequestSequenceRef.current === syncRequestSequence) {
        setIsQuietSyncingTelegram(false);
        setIsSyncingTelegram(false);
      }
    }
  }, [onSynced]);

  async function handleLinkedTelegramAccount(linkedUser: HostedPrivyLinkedAccountContainer) {
    try {
      const refreshedUser = await refreshUser().catch(() => linkedUser);
      const refreshedTelegram =
        resolveHostedPrivyTelegramDisplayState(refreshedUser).currentTelegram
        ?? resolveHostedPrivyTelegramDisplayState(linkedUser).currentTelegram;

      await syncLinkedTelegram("link", refreshedTelegram?.telegramUserId ?? null);
    } finally {
      setIsLinkingTelegram(false);
    }
  }

  useEffect(() => {
    if (!authenticated || isLinkingTelegram || isSyncingTelegram) {
      return;
    }

    const telegramUserId = currentTelegram?.telegramUserId ?? null;

    if (!telegramUserId || autoSyncedTelegramUserIdRef.current === telegramUserId) {
      return;
    }

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
      linkTelegram();
    } catch (error) {
      setIsLinkingTelegram(false);
      setErrorMessage(toHostedTelegramLinkErrorMessage(error));
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
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertTitle>Unable to update Telegram</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          {shouldShowContactSupportAction(errorMessage) ? (
            <ContactSupportAction
              body={[
                "Hi Murph support,",
                "",
                "I need help linking Telegram to my Murph account.",
                "",
                "Context: Telegram setup or account support.",
              ].join("\n")}
              className="w-full sm:w-fit"
              subject="Murph Telegram account support"
            />
          ) : null}
        </div>
      ) : null}

      {isSyncingTelegram && !isQuietSyncingTelegram ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Finishing Telegram setup</AlertTitle>
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
          onLinkTelegram={handleLinkTelegram}
        />
      )}
    </div>
  );
}
