"use client";

import {
  useLinkAccount,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";

import { finalizeHostedPhoneLink } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import {
  ContactSupportAction,
  shouldShowContactSupportAction,
} from "@/src/components/support/contact-support-action";
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
import type { HostedPhoneLinkDiagnosticOperation } from "@/src/lib/hosted-onboarding/phone-link-diagnostic-contract";

import type {
  HostedPhoneLinkPayload,
  HostedPhoneLinkSyncExpectation,
} from "../hosted-onboarding/hosted-phone-auth-types";
import { SettingsStatusLine } from "./connected-account-card";
import {
  toPhoneLinkProviderDetailCode,
  type HostedPhoneLinkDiagnosticReporter,
} from "./hosted-phone-link-diagnostics";
import { toErrorMessage } from "./hosted-settings-utils";

export function HostedPhoneSettings(props: {
  autoOpen?: boolean;
  diagnosticReporter?: HostedPhoneLinkDiagnosticReporter;
  initialPhoneNumber?: string | null;
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
  const pendingSyncOperationRef = useRef<HostedPhoneLinkDiagnosticOperation | null>(null);
  const providerAttemptSequenceRef = useRef(0);
  const providerLaunchAttemptRef = useRef<number | null>(null);
  const providerPhoneBaselineRef = useRef<string | null>(null);
  const providerCompletionHandledRef = useRef(false);
  const reportDiagnostic = props.diagnosticReporter ?? (() => {});

  const shouldUpdatePhone = Boolean(privyUser?.phone?.number);
  const { linkPhone } = useLinkAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
          operation: "link",
        });
        return;
      }

      const providerAttempt = providerLaunchAttemptRef.current;
      if (providerAttempt !== null) {
        handleProviderError(providerAttempt, error, "exited_link_flow", "link");
      }
    },
    onSuccess: (params) => {
      const providerAttempt = providerLaunchAttemptRef.current;
      if (
        providerAttempt !== null
        && params.linkMethod === "sms"
        && params.linkedAccount.type === "phone"
      ) {
        void handlePrivyPhoneLinked(providerAttempt, {
          kind: "exact",
          phoneNumber: params.linkedAccount.number,
        }, "link");
      } else {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: params.linkMethod === "sms" ? "other" : "non_sms_callback",
          operation: "link",
        });
      }
    },
  });
  const { updatePhone } = useUpdateAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
          operation: "update",
        });
        return;
      }

      const providerAttempt = providerLaunchAttemptRef.current;
      if (providerAttempt !== null) {
        handleProviderError(providerAttempt, error, "exited_update_flow", "update");
      }
    },
    onSuccess: (params) => {
      const providerAttempt = providerLaunchAttemptRef.current;
      if (
        providerAttempt !== null
        && params.updateMethod === "sms"
        && params.updatedAccount.type === "phone"
      ) {
        void handlePrivyPhoneLinked(providerAttempt, {
          kind: "exact",
          phoneNumber: params.updatedAccount.number,
        }, "update");
      } else {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: params.updateMethod === "sms" ? "other" : "non_sms_callback",
          operation: "update",
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

  async function syncPrivyPhone(
    expectation: HostedPhoneLinkSyncExpectation,
    operation: HostedPhoneLinkDiagnosticOperation,
  ) {
    pendingSyncExpectationRef.current = expectation;
    pendingSyncOperationRef.current = operation;
    setIsLinking(false);
    setIsSyncing(true);
    reportDiagnostic("sync_started", { operation });

    try {
      const result = await finalizeHostedPhoneLink({
        expectation,
        onLinked: handleLinked,
      });

      if (result.status === "unchanged") {
        pendingSyncExpectationRef.current = null;
        pendingSyncOperationRef.current = null;
        reportDiagnostic("sync_unchanged", { operation });
        props.onAborted?.();
        return;
      }

      if (result.status === "synced") {
        pendingSyncExpectationRef.current = null;
        pendingSyncOperationRef.current = null;
        reportDiagnostic("sync_succeeded", { operation });
      }
    } catch (error) {
      reportDiagnostic("sync_failed", {
        detailCode: "other",
        operation,
      });
      setErrorMessage(toErrorMessage(error, "Your phone was verified, but we could not save it. Try again."));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handlePrivyPhoneLinked(
    providerAttempt: number,
    expectation: HostedPhoneLinkSyncExpectation,
    operation: HostedPhoneLinkDiagnosticOperation,
  ) {
    if (
      providerLaunchAttemptRef.current !== providerAttempt
      || providerCompletionHandledRef.current
    ) {
      return;
    }

    providerCompletionHandledRef.current = true;
    reportDiagnostic("provider_succeeded", { operation });
    accountTransferPendingRef.current = false;
    providerLaunchAttemptRef.current = null;
    await syncPrivyPhone(expectation, operation);
  }

  function handleProviderError(
    providerAttempt: number,
    error: unknown,
    exitedFlowError: string,
    operation: HostedPhoneLinkDiagnosticOperation,
  ) {
    if (providerLaunchAttemptRef.current !== providerAttempt) {
      return;
    }

    if (error === "account_transfer_required") {
      accountTransferPendingRef.current = true;
      reportDiagnostic("provider_transfer_required", {
        detailCode: "account_transfer_required",
        operation,
      });
      setErrorMessage(null);
      return;
    }

    if (error === exitedFlowError) {
      providerLaunchAttemptRef.current = null;
      setIsLinking(false);

      if (providerCompletionHandledRef.current) {
        return;
      }

      if (accountTransferPendingRef.current) {
        accountTransferPendingRef.current = false;
        pendingSyncExpectationRef.current = {
          kind: "changed-from",
          phoneNumber: providerPhoneBaselineRef.current,
        };
        pendingSyncOperationRef.current = operation;
        void syncPrivyPhone(pendingSyncExpectationRef.current, operation);
        return;
      }

      reportDiagnostic("provider_cancelled", {
        detailCode: toPhoneLinkProviderDetailCode(error),
        operation,
      });
      props.onAborted?.();
      return;
    }

    accountTransferPendingRef.current = false;
    providerLaunchAttemptRef.current = null;
    setIsLinking(false);
    reportDiagnostic("provider_failed", {
      detailCode: toPhoneLinkProviderDetailCode(error),
      operation,
    });
    setErrorMessage(toPhoneLinkErrorMessage(error));
  }

  async function handleLinkPhone() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const pendingExpectation = pendingSyncExpectationRef.current;
    if (pendingExpectation) {
      await syncPrivyPhone(
        pendingExpectation,
        pendingSyncOperationRef.current ?? (shouldUpdatePhone ? "update" : "link"),
      );
      return;
    }

    accountTransferPendingRef.current = false;
    providerCompletionHandledRef.current = false;
    const providerPhoneNumber = privyUser?.phone?.number ?? null;
    if (
      providerPhoneNumber
      && providerPhoneNumber !== (props.initialPhoneNumber ?? null)
    ) {
      const repairExpectation: HostedPhoneLinkSyncExpectation = {
        kind: "exact",
        phoneNumber: providerPhoneNumber,
      };
      pendingSyncExpectationRef.current = repairExpectation;
      pendingSyncOperationRef.current = "update";
      await syncPrivyPhone(repairExpectation, "update");
      return;
    }

    const providerAttempt = providerAttemptSequenceRef.current + 1;
    providerAttemptSequenceRef.current = providerAttempt;
    providerPhoneBaselineRef.current = providerPhoneNumber;
    providerLaunchAttemptRef.current = providerAttempt;
    setIsLinking(true);
    const operation = providerPhoneNumber ? "update" : "link";
    reportDiagnostic("provider_started", { operation });
    try {
      if (providerPhoneNumber) {
        updatePhone();
      } else {
        linkPhone();
      }
    } catch (error) {
      if (providerLaunchAttemptRef.current === providerAttempt) {
        providerLaunchAttemptRef.current = null;
        setIsLinking(false);
        reportDiagnostic("provider_failed", {
          detailCode: toPhoneLinkProviderDetailCode(error),
          operation,
        });
        setErrorMessage(toPhoneLinkErrorMessage(error));
      }
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

  const isBusy = isLinking || isSyncing;
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
        disabled={isBusy}
        isChangeFlow={shouldUpdatePhone}
        isLinking={isLinking}
        isSyncing={isSyncing}
        onClick={handleLinkPhone}
      />

      <SettingsStatusLine message={statusMessage} tone={statusTone} />
      <HostedPhoneSupportAction errorMessage={errorMessage} />
    </div>
  );
}

function HostedPhoneSupportAction({
  errorMessage,
}: {
  errorMessage: string | null;
}) {
  if (!shouldShowContactSupportAction(errorMessage)) {
    return null;
  }

  return (
    <ContactSupportAction
      body="Hi Murph support,\n\nI need help linking a phone number to my Murph account."
      className="min-h-12 w-full border-border bg-transparent text-foreground hover:bg-muted"
      subject="Help linking my phone"
    >
      Contact support
    </ContactSupportAction>
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
          <div className="grid gap-3">
            <Button
              type="button"
              size="xl"
              className="w-full"
              disabled={isLinking || isSyncing}
              onClick={onRetry}
            >
              Try again
            </Button>
            <HostedPhoneSupportAction errorMessage={errorMessage} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Privy's modal is the only visible surface while its link/update flow is
  // active. Murph appears only for launch and post-verification reconciliation.
  if (isLinking) {
    return null;
  }

  return (
    <div
      aria-labelledby="hosted-phone-hand-off-status"
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-50 grid place-items-center bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
    >
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className="flex flex-col items-center gap-4 text-sm text-muted-foreground"
      >
        <MurphPulseLoader className="h-16 w-auto" />
        <span id="hosted-phone-hand-off-status">
          {isSyncing
            ? "Saving your phone…"
            : "Preparing secure phone verification…"}
        </span>
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
