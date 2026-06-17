"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import type {
  HostedConsentScope,
  HostedConsentScopeStatus,
  HostedConsentStatus,
} from "@/src/lib/legal/consent";

type HostedLegalConsentCardMode = "compact" | "panel";

interface HostedLegalConsentCardProps {
  acceptedPendingLabel?: string;
  className?: string;
  initialStatus?: HostedConsentStatus | null;
  mode?: HostedLegalConsentCardMode;
  onAccepted?: (status: HostedConsentStatus) => void | Promise<void>;
  onRequirementChange?: (required: boolean) => void;
  preferredScope?: HostedConsentScope;
  source: string;
}

export function HostedLegalConsentCard(props: HostedLegalConsentCardProps) {
  return (
    <HostedLegalConsentCardState
      key={resolveHostedConsentCardStateKey(props)}
      {...props}
    />
  );
}

function HostedLegalConsentCardState({
  acceptedPendingLabel = "Continuing...",
  className,
  initialStatus = null,
  mode = "panel",
  onAccepted,
  onRequirementChange,
  preferredScope = "launch.legal",
  source,
}: HostedLegalConsentCardProps) {
  const [loadedStatus, setLoadedStatus] = useState<HostedConsentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [acceptedHandoffPending, setAcceptedHandoffPending] = useState(false);
  const [loading, setLoading] = useState(!initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [healthDataAccepted, setHealthDataAccepted] = useState(false);
  const [featureAccepted, setFeatureAccepted] = useState(false);
  const status = initialStatus ?? loadedStatus;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await requestHostedLegalConsentStatus();
      setLoadedStatus(nextStatus);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(readConsentErrorMessage(error, "Could not load Murph legal consent right now."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (initialStatus) {
      return;
    }

    let cancelled = false;
    void requestHostedLegalConsentStatus()
      .then((nextStatus) => {
        if (cancelled) {
          return;
        }

        setLoadedStatus(nextStatus);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(readConsentErrorMessage(error, "Could not load Murph legal consent right now."));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialStatus]);

  const pendingScopes = useMemo(() => {
    if (!status) return [];
    const launchPending = status.launchScopes
      .filter((s) => !s.granted)
      .map((s) => s.scope);
    if (launchPending.length > 0) return launchPending;

    const preferred = findConsentScope(status, preferredScope);
    if (preferred && !preferred.granted) return [preferredScope];

    return [];
  }, [preferredScope, status]);

  const isLaunchFlow = pendingScopes.some((s) => s.startsWith("launch."));
  const isFeatureFlow = !isLaunchFlow && pendingScopes.length > 0;

  const legalScope = status ? findConsentScope(status, "launch.legal") : null;
  const healthDataScope = status ? findConsentScope(status, "launch.health-data") : null;

  const featureScope = useMemo(() => {
    if (!isFeatureFlow || !status) return null;
    return findConsentScope(status, preferredScope);
  }, [isFeatureFlow, preferredScope, status]);
  useEffect(() => {
    if (!status) return;
    onRequirementChange?.(pendingScopes.length > 0);
  }, [pendingScopes, onRequirementChange, status]);

  const launchLegalChecked = !legalScope || legalScope.granted || legalAccepted;
  const launchHealthDataChecked =
    !healthDataScope || healthDataScope.granted || healthDataAccepted;
  const allChecked = isLaunchFlow
    ? launchLegalChecked && launchHealthDataChecked
    : isFeatureFlow
      ? featureAccepted
      : false;
  const actionPending = pending || acceptedHandoffPending;

  async function handleAccept() {
    if (actionPending || !allChecked || !status) return;

    setPending(true);
    setAcceptedHandoffPending(false);
    setErrorMessage(null);

    try {
      let latestStatus = status;
      for (const scope of pendingScopes) {
        const scopeStatus = findConsentScope(latestStatus, scope);
        if (scopeStatus && !scopeStatus.granted) {
          latestStatus = await requestHostedOnboardingJson<HostedConsentStatus>({
            method: "POST",
            payload: {
              acceptedDocumentVersions: Object.fromEntries(
                scopeStatus.documents.map((document) => [document.id, document.version]),
              ),
              scope,
              source,
            },
            url: "/api/legal/consent/accept",
          });
        }
      }
      setAcceptedHandoffPending(true);
      if (onAccepted) {
        await onAccepted(latestStatus);
      }
    } catch (error) {
      setAcceptedHandoffPending(false);
      setErrorMessage(readConsentErrorMessage(error, "Could not record Murph legal consent right now."));
    } finally {
      setPending(false);
    }
  }

  if (!initialStatus && loading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className={joinClassNames(cardClassName(mode), className)}
      >
        {mode === "compact" ? (
          <ConsentSkeleton />
        ) : (
          <div className="text-sm text-muted-foreground">
            <span>Loading...</span>
          </div>
        )}
      </div>
    );
  }

  if (!status && errorMessage) {
    return (
      <div className={joinClassNames(cardClassName(mode), className)}>
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>Unable to load Murph legal consent</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <Button type="button" onClick={loadStatus} variant="outline" size="lg">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (pendingScopes.length === 0) {
    return null;
  }

  const title = isLaunchFlow ? "Before you start" : "Connect health sources";
  const description = isLaunchFlow
    ? "Please review and agree to the following."
    : "Review and accept the health source consent for this integration.";

  const checkboxes = isLaunchFlow ? (
    <LaunchConsentCheckboxes
      legalAccepted={legalAccepted}
      healthDataAccepted={healthDataAccepted}
      onLegalChange={setLegalAccepted}
      onHealthDataChange={setHealthDataAccepted}
      legalScope={legalScope}
      healthDataScope={healthDataScope}
    />
  ) : featureScope ? (
    <div className="space-y-3">
      <DocumentLinks documents={featureScope.documents} />
      <ConsentCheckbox
        checked={featureAccepted}
        onChange={setFeatureAccepted}
        label="I agree to the above"
      />
    </div>
  ) : null;

  const continueButton = (
    <Button
      aria-busy={actionPending}
      className={mode === "compact" ? "w-full" : undefined}
      type="button"
      onClick={handleAccept}
      disabled={!allChecked || actionPending}
      size={mode === "compact" ? "xl" : "lg"}
    >
      {acceptedHandoffPending ? acceptedPendingLabel : pending ? "Saving..." : "Continue"}
    </Button>
  );

  if (mode === "compact") {
    return (
      <div className={joinClassNames("w-full space-y-8", className)}>
        {checkboxes}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to record consent</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {continueButton}
      </div>
    );
  }

  return (
    <div className={joinClassNames(cardClassName(mode), className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-olive">
          <ShieldCheckIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-1">
            <p className="font-serif text-xl font-normal tracking-tight text-foreground">{title}</p>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
          {checkboxes}
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to record consent</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {continueButton}
        </div>
      </div>
    </div>
  );
}

function LaunchConsentCheckboxes({
  legalAccepted,
  healthDataAccepted,
  onLegalChange,
  onHealthDataChange,
  legalScope,
  healthDataScope,
}: {
  healthDataAccepted: boolean;
  healthDataScope: HostedConsentScopeStatus | null;
  legalAccepted: boolean;
  legalScope: HostedConsentScopeStatus | null;
  onHealthDataChange: (checked: boolean) => void;
  onLegalChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      {legalScope && !legalScope.granted ? (
        <ConsentCheckbox
          checked={legalAccepted}
          onChange={onLegalChange}
          label={
            <>
              I agree to the{" "}
              {legalScope.documents.map((doc, i) => (
                <span key={doc.id}>
                  {i > 0 ? (i === legalScope.documents.length - 1 ? " and " : ", ") : ""}
                  <a
                    href={doc.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {doc.title.replace("Murph ", "")}
                  </a>
                </span>
              ))}
            </>
          }
        />
      ) : null}

      {healthDataScope && !healthDataScope.granted ? (
        <ConsentCheckbox
          checked={healthDataAccepted}
          onChange={onHealthDataChange}
          label={
            <>
              I agree to the{" "}
              <a
                href={healthDataScope.documents[0]?.href ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Consumer Health Data Notice
              </a>
              , which explains what health data Murph collects and why
            </>
          }
        />
      ) : null}
    </div>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  label: React.ReactNode;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 text-sm leading-relaxed text-foreground">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="size-7 shrink-0"
      />
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
    </div>
  );
}

function DocumentLinks({
  documents,
}: {
  documents: HostedConsentScopeStatus["documents"];
}) {
  return (
    <ul className="grid gap-2 text-sm sm:grid-cols-2">
      {documents.map((document) => (
        <li key={document.id}>
          <a
            className="inline-flex items-center gap-1.5 font-medium text-olive underline-offset-4 hover:underline"
            href={document.href}
            target="_blank"
            rel="noreferrer"
          >
            <span>{document.title}</span>
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}

function findConsentScope(
  status: HostedConsentStatus,
  scope: HostedConsentScope,
): HostedConsentScopeStatus | null {
  return status.scopes.find((candidate) => candidate.scope === scope) ?? null;
}

function resolveHostedConsentCardStateKey({
  initialStatus,
  preferredScope = "launch.legal",
  source,
}: HostedLegalConsentCardProps): string {
  if (!initialStatus) {
    return `loaded:${preferredScope}:${source}`;
  }

  const scopeState = initialStatus.scopes
    .map((scope) => {
      const documentState = scope.documents
        .map((document) => `${document.id}@${document.version}`)
        .join(",");
      return `${scope.scope}:${scope.granted ? "granted" : "pending"}:${documentState}`;
    })
    .join("|");

  return `initial:${preferredScope}:${source}:${initialStatus.generatedAt}:${scopeState}`;
}

async function requestHostedLegalConsentStatus(): Promise<HostedConsentStatus> {
  return requestHostedOnboardingJson<HostedConsentStatus>({
    url: "/api/legal/consent/status",
  });
}

function readConsentErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HostedOnboardingApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function cardClassName(mode: HostedLegalConsentCardMode): string {
  return mode === "compact"
    ? "w-full"
    : "rounded-2xl border border-border bg-card p-6";
}

function joinClassNames(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function ConsentSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-8">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="size-7 shrink-0 rounded-lg bg-muted" />
          <div className="flex-1 space-y-2.5 pt-0.5">
            <div className="h-4 w-full rounded-full bg-muted" />
            <div className="h-4 w-3/4 rounded-full bg-muted" />
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="size-7 shrink-0 rounded-lg bg-muted" />
          <div className="flex-1 space-y-2.5 pt-0.5">
            <div className="h-4 w-full rounded-full bg-muted" />
            <div className="h-4 w-full rounded-full bg-muted" />
            <div className="h-4 w-3/5 rounded-full bg-muted" />
          </div>
        </div>
      </div>
      <div className="h-14 w-full rounded-2xl bg-muted" />
    </div>
  );
}
