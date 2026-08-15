"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type Ref } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { publishBrowserVaultSessionInvalidation } from "@/src/lib/browser-vault/session-invalidation";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";

const HEALTH_DATA_SCOPE = "launch.health-data" as const;

export type HealthDataConsentPresentation =
  | "active"
  | "not-enabled"
  | "paused"
  | "unavailable";

export function HostedHealthDataConsentSettings({
  authenticated,
  initialStatus,
}: {
  authenticated: boolean;
  initialStatus: HostedConsentStatus | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const presentation = resolveHealthDataConsentPresentation(status);
  const handleResumePendingChange = useCallback((nextPending: boolean) => {
    setResumePending(nextPending);
  }, []);

  if (!authenticated) {
    return null;
  }

  async function handleWithdraw() {
    if (pending) {
      return;
    }

    setPending(true);
    setErrorMessage(null);
    try {
      const nextStatus = await requestHostedOnboardingJson<HostedConsentStatus>({
        method: "POST",
        payload: {
          scope: HEALTH_DATA_SCOPE,
          source: "settings-health-data",
        },
        url: "/api/legal/consent/revoke",
      });
      setStatus(nextStatus);
      setWithdrawOpen(false);
      publishBrowserVaultSessionInvalidation();
      window.setTimeout(reloadCurrentHostedAuthDocument, 100);
    } catch (error) {
      setErrorMessage(readWithdrawalError(error));
    } finally {
      setPending(false);
    }
  }

  function handleAccepted(nextStatus: HostedConsentStatus) {
    setStatus(nextStatus);
    setResumeOpen(false);
    setErrorMessage(null);
    window.setTimeout(reloadCurrentHostedAuthDocument, 100);
  }

  async function handleStatusRetry() {
    if (statusPending) {
      return;
    }

    setStatusPending(true);
    setErrorMessage(null);
    try {
      setStatus(await requestHostedOnboardingJson<HostedConsentStatus>({
        url: "/api/legal/consent/status",
      }));
    } catch (error) {
      setErrorMessage(readStatusError(error));
    } finally {
      setStatusPending(false);
    }
  }

  return (
    <>
      <HostedHealthDataConsentControl
        errorMessage={errorMessage}
        onAction={() => {
          setErrorMessage(null);
          if (presentation === "unavailable") {
            void handleStatusRetry();
          } else if (presentation === "active") {
            setWithdrawOpen(true);
          } else {
            setResumeOpen(true);
          }
        }}
        pending={pending}
        presentation={presentation}
        statusPending={statusPending}
      />

      <HostedHealthDataWithdrawalDialog
        errorMessage={errorMessage}
        onConfirm={() => void handleWithdraw()}
        onOpenChange={setWithdrawOpen}
        open={withdrawOpen}
        pending={pending}
      />

      <Dialog
        open={resumeOpen}
        onOpenChange={(open) => {
          if (!resumePending) {
            setResumeOpen(open);
          }
        }}
      >
        <DialogContent
          aria-busy={resumePending}
          className="max-h-[calc(100dvh-2rem)] max-w-xl gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton={!resumePending}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Use Murph again</DialogTitle>
            <DialogDescription>
              Review the current consent documents to restore health data processing.
            </DialogDescription>
          </DialogHeader>
          <HostedHealthDataResumeConsent
            onAccepted={handleAccepted}
            onActionPendingChange={handleResumePendingChange}
            status={status}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function HostedHealthDataWithdrawalDialog({
  errorMessage = null,
  onConfirm,
  onOpenChange,
  open,
  pending,
}: {
  errorMessage?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
}) {
  const cancelWithdrawalRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent
        aria-busy={pending}
        aria-describedby="health-data-withdrawal-description"
        aria-labelledby="health-data-withdrawal-title"
        className="max-w-lg gap-5 p-6 sm:p-8"
        initialFocus={cancelWithdrawalRef}
        showCloseButton={!pending}
      >
        <HostedHealthDataWithdrawalConfirmation
          cancelRef={cancelWithdrawalRef}
          errorMessage={errorMessage}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
}

export function HostedHealthDataConsentControl({
  errorMessage,
  onAction,
  pending,
  presentation,
  statusPending,
}: {
  errorMessage: string | null;
  onAction: () => void;
  pending: boolean;
  presentation: HealthDataConsentPresentation;
  statusPending: boolean;
}) {
  const active = presentation === "active";
  const paused = presentation === "paused";
  const unavailable = presentation === "unavailable";

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-border pb-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      {active ? (
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-[18px] shrink-0 self-start text-muted-foreground"
          strokeWidth={1.6}
        />
      ) : (
        <ShieldOff
          aria-hidden="true"
          className="mt-0.5 size-[18px] shrink-0 self-start text-muted-foreground"
          strokeWidth={1.6}
        />
      )}
      <div className="min-w-0">
        <div className="font-serif text-base tracking-tight text-foreground">
          Health data use
        </div>
        <p
          aria-live="polite"
          className={`mt-0.5 text-xs leading-5 ${
            unavailable && errorMessage
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {active ? (
            <Link
              className="inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline"
              href="/connect"
            >
              Manage sources
            </Link>
          ) : paused
              ? "Processing paused"
              : presentation === "not-enabled"
                ? "Not enabled"
                : statusPending
                  ? "Checking status..."
                  : errorMessage ?? "Status unavailable"}
        </p>
        {paused ? (
          <div className="mt-2">
            <Link
              className="relative inline-flex min-h-10 items-center self-start text-sm font-medium text-primary underline-offset-4 hover:underline before:absolute before:-inset-x-2 before:content-['']"
              href="/connect"
            >
              Review source disconnections
            </Link>
          </div>
        ) : null}
      </div>
      <Button
        className="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end"
        disabled={pending}
        onClick={onAction}
        type="button"
        variant={active ? "destructive" : "default"}
      >
        {active
          ? "Withdraw consent"
          : paused
            ? "Use Murph again"
            : unavailable
              ? statusPending ? "Checking..." : "Retry status"
              : "Review"}
      </Button>
    </div>
  );
}

export function HostedHealthDataWithdrawalConfirmation({
  cancelRef,
  errorMessage = null,
  onCancel,
  onConfirm,
  pending,
}: {
  cancelRef?: Ref<HTMLButtonElement>;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <>
      <DialogHeader className="max-w-prose pr-10">
        <DialogTitle
          className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground"
          id="health-data-withdrawal-title"
        >
          Withdraw health data consent?
        </DialogTitle>
        <DialogDescription
          className="text-sm leading-6 text-muted-foreground"
          id="health-data-withdrawal-description"
        >
          Murph will pause health data processing and try to disconnect your
          health sources. Your account, existing data, and subscription stay
          unchanged.
        </DialogDescription>
      </DialogHeader>
      {errorMessage ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={pending}
          onClick={onConfirm}
          size="lg"
          type="button"
          variant="secondary"
        >
          {pending ? "Withdrawing..." : "Withdraw consent"}
        </Button>
        <Button
          className="w-full"
          disabled={pending}
          onClick={onCancel}
          ref={cancelRef}
          size="default"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </>
  );
}

export function HostedHealthDataResumeConsent({
  onAccepted,
  onActionPendingChange,
  status,
}: {
  onAccepted: (status: HostedConsentStatus) => void;
  onActionPendingChange?: (pending: boolean) => void;
  status: HostedConsentStatus | null;
}) {
  return status ? (
    <HostedLegalConsentCard
      initialStatus={status}
      mode="compact"
      onAccepted={onAccepted}
      onActionPendingChange={onActionPendingChange}
      preferredScope={HEALTH_DATA_SCOPE}
      source="settings-health-data-resume"
    />
  ) : null;
}

export function resolveHealthDataConsentPresentation(
  status: HostedConsentStatus | null,
): HealthDataConsentPresentation {
  if (!status) {
    return "unavailable";
  }

  const grant = status.scopes.find((scope) => scope.scope === HEALTH_DATA_SCOPE)?.grant;
  if (grant?.status === "revoked") {
    return "paused";
  }
  if (grant?.status === "granted") {
    return "active";
  }
  return "not-enabled";
}

function readWithdrawalError(error: unknown): string {
  if (error instanceof HostedOnboardingApiError && error.message) {
    return error.message;
  }
  return "Murph could not withdraw health data consent right now.";
}

function readStatusError(error: unknown): string {
  if (error instanceof HostedOnboardingApiError && error.message) {
    return error.message;
  }
  return "Status is still unavailable. Try again.";
}
