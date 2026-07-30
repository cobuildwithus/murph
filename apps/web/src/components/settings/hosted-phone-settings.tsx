"use client";

import {
  useLinkAccount,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";

import { finalizeHostedPhoneLink } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { Spinner } from "@/src/components/ui/spinner";

import type {
  HostedPhoneLinkPayload,
  HostedPhoneLinkSyncExpectation,
} from "../hosted-onboarding/hosted-phone-auth-types";
import { SettingsStatusLine } from "./connected-account-card";
import { toErrorMessage } from "./hosted-settings-utils";

export function HostedPhoneSettings(props: {
  autoOpen?: boolean;
  onAborted?: () => void;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
}) {
  const { user: privyUser } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const accountTransferPendingRef = useRef(false);
  const autoOpenStartedRef = useRef(false);
  const pendingSyncExpectationRef = useRef<HostedPhoneLinkSyncExpectation | null>(null);
  const providerPhoneBaselineRef = useRef<string | null>(null);
  const providerCompletionHandledRef = useRef(false);

  const shouldUpdatePhone = Boolean(privyUser?.phone?.number);

  const { linkPhone } = useLinkAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        return;
      }

      handleProviderError(error, "exited_link_flow");
    },
    onSuccess: (params) => {
      if (params.linkMethod === "sms" && params.linkedAccount.type === "phone") {
        void handlePrivyPhoneLinked({
          kind: "exact",
          phoneNumber: params.linkedAccount.number,
        });
      }
    },
  });
  const { updatePhone } = useUpdateAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        return;
      }

      handleProviderError(error, "exited_update_flow");
    },
    onSuccess: (params) => {
      if (params.updateMethod === "sms" && params.updatedAccount.type === "phone") {
        void handlePrivyPhoneLinked({
          kind: "exact",
          phoneNumber: params.updatedAccount.number,
        });
      }
    },
  });

  async function handleLinked(payload: HostedPhoneLinkPayload) {
    setErrorMessage(null);
    setSuccessMessage("Phone connected.");

    try {
      await props.onLinked?.(payload);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your number was saved, but the page didn't refresh. Reload to see it."));
    }
  }

  async function syncPrivyPhone(expectation: HostedPhoneLinkSyncExpectation) {
    pendingSyncExpectationRef.current = expectation;
    setIsLinking(false);
    setIsSyncing(true);

    try {
      const result = await finalizeHostedPhoneLink({
        expectation,
        onLinked: handleLinked,
      });

      if (result.status === "unchanged") {
        pendingSyncExpectationRef.current = null;
        props.onAborted?.();
        return;
      }

      if (result.status === "synced") {
        pendingSyncExpectationRef.current = null;
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your phone was verified, but we could not save it. Try again."));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handlePrivyPhoneLinked(expectation: HostedPhoneLinkSyncExpectation) {
    if (providerCompletionHandledRef.current) {
      return;
    }

    providerCompletionHandledRef.current = true;
    accountTransferPendingRef.current = false;
    await syncPrivyPhone(expectation);
  }

  function handleProviderError(error: unknown, exitedFlowError: string) {
    if (error === "account_transfer_required") {
      accountTransferPendingRef.current = true;
      setErrorMessage(null);
      return;
    }

    if (error === exitedFlowError) {
      setIsLinking(false);

      if (providerCompletionHandledRef.current) {
        return;
      }

      if (accountTransferPendingRef.current) {
        accountTransferPendingRef.current = false;
        void handlePrivyPhoneLinked({
          kind: "changed-from",
          phoneNumber: providerPhoneBaselineRef.current,
        });
        return;
      }

      props.onAborted?.();
      return;
    }

    accountTransferPendingRef.current = false;
    setIsLinking(false);
    setErrorMessage(toPhoneLinkErrorMessage(error));
  }

  async function handleLinkPhone() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const pendingExpectation = pendingSyncExpectationRef.current;
    if (pendingExpectation) {
      await syncPrivyPhone(pendingExpectation);
      return;
    }

    accountTransferPendingRef.current = false;
    providerCompletionHandledRef.current = false;
    setIsLinking(true);

    let preparation: Awaited<ReturnType<typeof finalizeHostedPhoneLink>>;
    try {
      preparation = await finalizeHostedPhoneLink({
        expectation: {
          kind: "prepare",
        },
        onLinked: handleLinked,
      });
    } catch (error) {
      setIsLinking(false);
      setErrorMessage(toPhoneLinkErrorMessage(error));
      return;
    }

    if (preparation.status === "synced") {
      setIsLinking(false);
      return;
    }
    if (preparation.status === "unchanged") {
      setIsLinking(false);
      props.onAborted?.();
      return;
    }

    providerPhoneBaselineRef.current = preparation.phoneNumber;

    try {
      if (preparation.phoneNumber) {
        updatePhone();
      } else {
        linkPhone();
      }
    } catch (error) {
      setIsLinking(false);
      setErrorMessage(toPhoneLinkErrorMessage(error));
    }
  }

  useEffect(() => {
    if (!props.autoOpen || autoOpenStartedRef.current) {
      return;
    }

    autoOpenStartedRef.current = true;
    void handleLinkPhone();
    // The provider hooks recreate their launch functions as state changes.
    // autoOpenStartedRef keeps this hand-off one-shot for this mounted action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoOpen]);

  const statusTone = errorMessage ? "destructive" : successMessage ? "success" : "neutral";
  const statusMessage =
    errorMessage
    ?? successMessage
    ?? (isSyncing
      ? "Saving your phone…"
      : isLinking
        ? "Opening secure phone verification…"
        : null);

  if (props.autoOpen) {
    return (
      <HostedPhonePrivyHandOffStatus
        errorMessage={errorMessage}
        isLinking={isLinking}
        isSyncing={isSyncing}
        onAborted={props.onAborted}
        onRetry={handleLinkPhone}
      />
    );
  }

  return (
    <div className="space-y-5">
      <HostedPhoneLinkAction
        disabled={isLinking || isSyncing}
        isChangeFlow={shouldUpdatePhone}
        isLinking={isLinking}
        isSyncing={isSyncing}
        onClick={handleLinkPhone}
      />

      <SettingsStatusLine message={statusMessage} tone={statusTone} />
    </div>
  );
}

function HostedPhonePrivyHandOffStatus({
  errorMessage,
  isLinking,
  isSyncing,
  onAborted,
  onRetry,
}: {
  errorMessage: string | null;
  isLinking: boolean;
  isSyncing: boolean;
  onAborted?: () => void;
  onRetry: () => void;
}) {
  if (errorMessage) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            onAborted?.();
          }
        }}
      >
        <DialogContent className="max-w-[min(24rem,calc(100vw-2rem))] gap-6 rounded-2xl border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[24rem] md:p-8">
          <DialogHeader className="gap-2 pr-10">
            <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">
              Link phone
            </DialogTitle>
            <DialogDescription className="text-base/7 text-muted-foreground">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={isLinking || isSyncing}
            onClick={onRetry}
          >
            Try again
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  // Privy's modal is the only visible surface while its link/update flow is
  // active. Murph appears only for the brief launch and post-verification sync.
  if (isLinking) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/10 supports-backdrop-filter:backdrop-blur-xs">
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className="flex flex-col items-center gap-4 text-sm text-muted-foreground"
      >
        <MurphPulseLoader className="h-16 w-auto" />
        <span>{isSyncing ? "Saving your phone…" : "Opening secure window…"}</span>
      </div>
    </div>
  );
}

export function HostedPhoneLinkAction(props: {
  disabled?: boolean;
  isChangeFlow: boolean;
  isLinking: boolean;
  isSyncing: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="xl"
      className="w-full disabled:bg-primary disabled:text-primary-foreground disabled:opacity-100"
      aria-busy={props.isLinking || props.isSyncing}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.isLinking || props.isSyncing ? <Spinner aria-hidden="true" /> : null}
      {props.isSyncing
        ? "Saving…"
        : props.isLinking
          ? "Opening…"
          : props.isChangeFlow
            ? "Verify a new phone"
            : "Verify phone"}
    </Button>
  );
}

function toPhoneLinkErrorMessage(error: unknown): string {
  if (error === "linked_to_another_user") {
    return "That phone number belongs to another account. Sign in to that account or contact support.";
  }

  return toErrorMessage(error, "We could not link that phone number.");
}
