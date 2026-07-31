"use client";

import { useRef, useState, type Ref } from "react";
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelWithdrawalRef = useRef<HTMLButtonElement>(null);
  const presentation = resolveHealthDataConsentPresentation(status);

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

  const paused = presentation === "paused";
  const active = presentation === "active";
  const unavailable = presentation === "unavailable";

  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 border-b border-border pb-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        {active ? (
          <ShieldCheck
            aria-hidden="true"
            className="size-[18px] shrink-0 text-muted-foreground"
            strokeWidth={1.6}
          />
        ) : (
          <ShieldOff
            aria-hidden="true"
            className="size-[18px] shrink-0 text-muted-foreground"
            strokeWidth={1.6}
          />
        )}
        <div className="min-w-0">
          <div className="font-serif text-base tracking-tight text-foreground">
            Health data use
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {active
              ? "Used to personalize Murph"
              : paused
                ? "Processing paused"
                : presentation === "not-enabled"
                  ? "Not enabled"
                  : "Status unavailable"}
          </p>
        </div>
        <Button
          className={
            active
              ? "col-start-2 justify-self-end sm:col-start-auto"
              : "col-span-2 w-full sm:col-span-1 sm:w-auto"
          }
          disabled={unavailable || pending}
          onClick={() => {
            setErrorMessage(null);
            if (active) {
              setWithdrawOpen(true);
            } else {
              setResumeOpen(true);
            }
          }}
          size="default"
          type="button"
          variant={active ? "ghost" : "default"}
        >
          {active ? "Withdraw consent" : paused ? "Use Murph again" : "Review"}
        </Button>
      </div>

      <Dialog
        open={withdrawOpen}
        onOpenChange={(open) => {
          if (!pending) {
            setWithdrawOpen(open);
          }
        }}
      >
        <DialogContent
          aria-busy={pending}
          aria-describedby="health-data-withdrawal-description"
          aria-labelledby="health-data-withdrawal-title"
          className="max-w-md gap-6 p-6 md:p-7"
          initialFocus={cancelWithdrawalRef}
          showCloseButton={!pending}
        >
          <HostedHealthDataWithdrawalConfirmation
            cancelRef={cancelWithdrawalRef}
            errorMessage={errorMessage}
            onCancel={() => setWithdrawOpen(false)}
            onConfirm={() => void handleWithdraw()}
            pending={pending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-xl gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Use Murph again</DialogTitle>
            <DialogDescription>
              Review the current consent documents to restore health data processing.
            </DialogDescription>
          </DialogHeader>
          <HostedHealthDataResumeConsent
            onAccepted={handleAccepted}
            status={status}
          />
        </DialogContent>
      </Dialog>
    </>
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
      <DialogHeader className="pr-10">
        <h2
          className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground"
          id="health-data-withdrawal-title"
        >
          Withdraw health data consent?
        </h2>
        <p
          className="text-sm leading-6 text-muted-foreground"
          id="health-data-withdrawal-description"
        >
          Murph will pause health data processing and disconnect your health
          sources. Your account, existing data, and subscription will not be
          deleted.
        </p>
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
          size="xl"
          type="button"
          variant="destructive"
        >
          {pending ? "Withdrawing..." : "Withdraw consent"}
        </Button>
        <Button
          className="w-full"
          disabled={pending}
          onClick={onCancel}
          ref={cancelRef}
          size="xl"
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
  status,
}: {
  onAccepted: (status: HostedConsentStatus) => void;
  status: HostedConsentStatus | null;
}) {
  return status ? (
    <HostedLegalConsentCard
      initialStatus={status}
      mode="compact"
      onAccepted={onAccepted}
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
