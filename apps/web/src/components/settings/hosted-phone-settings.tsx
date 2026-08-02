"use client";

import {
  useLinkAccount,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { PhoneIcon } from "lucide-react";
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
  type HostedPhoneLinkDiagnosticReporterFactory,
} from "./hosted-phone-link-diagnostics";
import { toErrorMessage } from "./hosted-settings-utils";

export function HostedPhoneSettings(props: {
  autoOpen?: boolean;
  diagnosticReporterFactory?: HostedPhoneLinkDiagnosticReporterFactory;
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
  const providerDiagnosticRef = useRef<HostedPhoneLinkDiagnosticReporter | null>(null);
  const providerPhoneBaselineRef = useRef<string | null>(null);
  const providerCompletionHandledRef = useRef(false);

  const shouldUpdatePhone = Boolean(privyUser?.phone?.number);
  const { linkPhone } = useLinkAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        providerDiagnosticRef.current?.("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
        return;
      }

      const providerAttempt = providerLaunchAttemptRef.current;
      if (providerAttempt !== null) {
        handleProviderError(providerAttempt, error, "exited_link_flow");
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
        });
      } else {
        providerDiagnosticRef.current?.("provider_callback_ignored", {
          detailCode: params.linkMethod === "sms" ? "other" : "non_sms_callback",
        });
      }
    },
  });
  const { updatePhone } = useUpdateAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        providerDiagnosticRef.current?.("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
        return;
      }

      const providerAttempt = providerLaunchAttemptRef.current;
      if (providerAttempt !== null) {
        handleProviderError(providerAttempt, error, "exited_update_flow");
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
        });
      } else {
        providerDiagnosticRef.current?.("provider_callback_ignored", {
          detailCode: params.updateMethod === "sms" ? "other" : "non_sms_callback",
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
    reportDiagnostic: HostedPhoneLinkDiagnosticReporter,
  ) {
    pendingSyncExpectationRef.current = expectation;
    pendingSyncOperationRef.current = operation;
    setIsLinking(false);
    setIsSyncing(true);
    reportDiagnostic("sync_started");

    try {
      const result = await finalizeHostedPhoneLink({
        expectation,
        onLinked: handleLinked,
      });

      if (result.status === "unchanged") {
        pendingSyncExpectationRef.current = null;
        pendingSyncOperationRef.current = null;
        reportDiagnostic("sync_unchanged");
        props.onAborted?.();
        return;
      }

      if (result.status === "synced") {
        pendingSyncExpectationRef.current = null;
        pendingSyncOperationRef.current = null;
        reportDiagnostic("sync_succeeded");
      }
    } catch (error) {
      reportDiagnostic("sync_failed", {
        detailCode: "other",
      });
      setErrorMessage(toErrorMessage(error, "Your phone was verified, but we could not save it. Try again."));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handlePrivyPhoneLinked(
    providerAttempt: number,
    expectation: HostedPhoneLinkSyncExpectation,
  ) {
    if (
      providerLaunchAttemptRef.current !== providerAttempt
      || providerCompletionHandledRef.current
    ) {
      return;
    }

    const reportDiagnostic = providerDiagnosticRef.current;
    if (!reportDiagnostic) {
      return;
    }

    providerCompletionHandledRef.current = true;
    reportDiagnostic("provider_succeeded");
    accountTransferPendingRef.current = false;
    providerLaunchAttemptRef.current = null;
    providerDiagnosticRef.current = null;
    await syncPrivyPhone(
      expectation,
      pendingSyncOperationRef.current ?? (providerPhoneBaselineRef.current ? "update" : "link"),
      reportDiagnostic,
    );
  }

  function handleProviderError(
    providerAttempt: number,
    error: unknown,
    exitedFlowError: string,
  ) {
    if (providerLaunchAttemptRef.current !== providerAttempt) {
      return;
    }

    const reportDiagnostic = providerDiagnosticRef.current;
    if (!reportDiagnostic) {
      return;
    }

    if (error === "account_transfer_required") {
      accountTransferPendingRef.current = true;
      reportDiagnostic("provider_transfer_required", {
        detailCode: "account_transfer_required",
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
        const operation = providerPhoneBaselineRef.current ? "update" : "link";
        pendingSyncExpectationRef.current = {
          kind: "changed-from",
          phoneNumber: providerPhoneBaselineRef.current,
        };
        pendingSyncOperationRef.current = operation;
        providerDiagnosticRef.current = null;
        void syncPrivyPhone(
          pendingSyncExpectationRef.current,
          operation,
          reportDiagnostic,
        );
        return;
      }

      reportDiagnostic("provider_cancelled", {
        detailCode: toPhoneLinkProviderDetailCode(error),
      });
      providerDiagnosticRef.current = null;
      props.onAborted?.();
      return;
    }

    accountTransferPendingRef.current = false;
    providerLaunchAttemptRef.current = null;
    providerDiagnosticRef.current = null;
    setIsLinking(false);
    reportDiagnostic("provider_failed", {
      detailCode: toPhoneLinkProviderDetailCode(error),
    });
    setErrorMessage(toPhoneLinkErrorMessage(error));
  }

  function createDiagnosticReporter(
    operation: HostedPhoneLinkDiagnosticOperation,
  ): HostedPhoneLinkDiagnosticReporter {
    return props.diagnosticReporterFactory?.(operation) ?? (() => {});
  }

  async function handleLinkPhone() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const pendingExpectation = pendingSyncExpectationRef.current;
    if (pendingExpectation) {
      const operation =
        pendingSyncOperationRef.current ?? (shouldUpdatePhone ? "update" : "link");
      await syncPrivyPhone(
        pendingExpectation,
        operation,
        createDiagnosticReporter(operation),
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
      await syncPrivyPhone(
        repairExpectation,
        "update",
        createDiagnosticReporter("update"),
      );
      return;
    }

    const providerAttempt = providerAttemptSequenceRef.current + 1;
    providerAttemptSequenceRef.current = providerAttempt;
    providerPhoneBaselineRef.current = providerPhoneNumber;
    providerLaunchAttemptRef.current = providerAttempt;
    setIsLinking(true);
    const operation = providerPhoneNumber ? "update" : "link";
    const reportDiagnostic = createDiagnosticReporter(operation);
    providerDiagnosticRef.current = reportDiagnostic;
    pendingSyncOperationRef.current = operation;
    reportDiagnostic("provider_started");
    try {
      if (providerPhoneNumber) {
        updatePhone();
      } else {
        linkPhone();
      }
    } catch (error) {
      if (providerLaunchAttemptRef.current === providerAttempt) {
        providerLaunchAttemptRef.current = null;
        providerDiagnosticRef.current = null;
        setIsLinking(false);
        reportDiagnostic("provider_failed", {
          detailCode: toPhoneLinkProviderDetailCode(error),
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
    <HostedPhoneLinkCardPresentation
      disabled={isBusy}
      errorMessage={errorMessage}
      isChangeFlow={shouldUpdatePhone}
      isLinking={isLinking}
      isSyncing={isSyncing}
      statusMessage={statusMessage}
      statusTone={statusTone}
      onClick={handleLinkPhone}
    />
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

/**
 * The join and Settings surfaces both render this composed card. It is
 * exported as a presentation so the design catalog can show the real
 * spacing without a provider session behind it.
 */
export function HostedPhoneLinkCardPresentation(props: {
  disabled?: boolean;
  errorMessage: string | null;
  isChangeFlow: boolean;
  isLinking: boolean;
  isSyncing: boolean;
  statusMessage: string | null;
  statusTone: "neutral" | "success" | "destructive";
  onClick: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* The status line reserves its height to keep the button from moving
          when a message appears, so it stays tight to the action it reports
          on rather than reading as a gap below the card's primary CTA. */}
      <div className="space-y-2">
        <HostedPhoneLinkAction
          disabled={props.disabled}
          isChangeFlow={props.isChangeFlow}
          isLinking={props.isLinking}
          isSyncing={props.isSyncing}
          onClick={props.onClick}
        />

        <SettingsStatusLine
          message={props.statusMessage}
          tone={props.statusTone}
        />
      </div>

      <HostedPhoneSupportAction errorMessage={props.errorMessage} />
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
      {props.isLinking || props.isSyncing
        ? <Spinner aria-hidden="true" />
        : <PhoneIcon aria-hidden="true" className="size-4" />}
      {props.isSyncing
        ? "Saving…"
        : props.isLinking
          ? "Opening…"
          : props.isChangeFlow
            ? "Change phone"
            : "Add phone"}
    </Button>
  );
}

function toPhoneLinkErrorMessage(error: unknown): string {
  if (error === "linked_to_another_user") {
    return "That phone number belongs to another account. Sign in to that account or contact support.";
  }

  return toErrorMessage(error, "We could not link that phone number.");
}
