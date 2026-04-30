"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ExternalLinkIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

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
  className?: string;
  mode?: HostedLegalConsentCardMode;
  onAccepted?: (status: HostedConsentStatus) => void | Promise<void>;
  onRequirementChange?: (required: boolean) => void;
  preferredScope?: HostedConsentScope;
  source: string;
}

export function HostedLegalConsentCard({
  className,
  mode = "panel",
  onAccepted,
  onRequirementChange,
  preferredScope = "launch.legal",
  source,
}: HostedLegalConsentCardProps) {
  const [status, setStatus] = useState<HostedConsentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await requestHostedOnboardingJson<HostedConsentStatus>({
        url: "/api/legal/consent/status",
      });
      setStatus(nextStatus);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(readConsentErrorMessage(error, "Could not load Murph legal consent right now."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

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

  const [legalAccepted, setLegalAccepted] = useState(false);
  const [healthDataAccepted, setHealthDataAccepted] = useState(false);
  const legalScope = status ? findConsentScope(status, "launch.legal") : null;
  const healthDataScope = status ? findConsentScope(status, "launch.health-data") : null;

  const featureScope = useMemo(() => {
    if (!isFeatureFlow || !status) return null;
    return findConsentScope(status, preferredScope);
  }, [isFeatureFlow, preferredScope, status]);
  const [featureAccepted, setFeatureAccepted] = useState(false);

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

  async function handleAccept() {
    if (pending || !allChecked || !status) return;

    setPending(true);
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
      setStatus(latestStatus);
      setLegalAccepted(false);
      setHealthDataAccepted(false);
      setFeatureAccepted(false);
      await onAccepted?.(latestStatus);
    } catch (error) {
      setErrorMessage(readConsentErrorMessage(error, "Could not record Murph legal consent right now."));
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className={joinClassNames(cardClassName(mode), className)}
      >
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          <span>Checking Murph legal consent...</span>
        </div>
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
      aria-busy={pending}
      className={mode === "compact" ? "w-full" : undefined}
      type="button"
      onClick={handleAccept}
      disabled={!allChecked || pending}
      size={mode === "compact" ? "xl" : "lg"}
    >
      {pending ? "Saving..." : "Continue"}
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
              , which explains what health data Murph collects
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
