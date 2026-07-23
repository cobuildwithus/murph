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
type HostedLaunchConsentVariant = "combined" | "health-data" | "legal";

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

interface HostedLaunchConsentPromptProps {
  acceptedPendingLabel?: string;
  className?: string;
  documents: HostedConsentScopeStatus["documents"];
  errorMessage?: string | null;
  handoffPending?: boolean;
  mode?: HostedLegalConsentCardMode;
  onContinue: () => void;
  pending?: boolean;
  variant?: HostedLaunchConsentVariant;
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
  const [featureAccepted, setFeatureAccepted] = useState(false);
  const status = initialStatus ?? loadedStatus;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await requestHostedLegalConsentStatus();
      setLoadedStatus(nextStatus);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        readConsentErrorMessage(error, "Could not load Murph legal consent right now."),
      );
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

        setErrorMessage(
          readConsentErrorMessage(error, "Could not load Murph legal consent right now."),
        );
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
      .filter((scope) => !scope.granted)
      .map((scope) => scope.scope);
    if (launchPending.length > 0) return launchPending;

    const preferred = findConsentScope(status, preferredScope);
    if (preferred && !preferred.granted) return [preferredScope];

    return [];
  }, [preferredScope, status]);

  const isLaunchFlow = pendingScopes.some((scope) => scope.startsWith("launch."));
  const isFeatureFlow = !isLaunchFlow && pendingScopes.length > 0;
  const featureScope = useMemo(() => {
    if (!isFeatureFlow || !status) return null;
    return findConsentScope(status, preferredScope);
  }, [isFeatureFlow, preferredScope, status]);
  const launchDocuments = useMemo(
    () => (status ? collectScopeDocuments(status, pendingScopes) : []),
    [pendingScopes, status],
  );
  const actionPending = pending || acceptedHandoffPending;
  const canSubmit = isLaunchFlow || (isFeatureFlow && featureAccepted);

  useEffect(() => {
    if (!status) return;
    onRequirementChange?.(pendingScopes.length > 0);
  }, [pendingScopes, onRequirementChange, status]);

  async function handleAccept() {
    if (actionPending || !canSubmit || !status) return;

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
      setErrorMessage(
        readConsentErrorMessage(error, "Could not record Murph legal consent right now."),
      );
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
        <ConsentSkeleton />
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

  if (isLaunchFlow) {
    return (
      <HostedLaunchConsentPrompt
        acceptedPendingLabel={acceptedPendingLabel}
        className={className}
        documents={launchDocuments}
        errorMessage={errorMessage}
        handoffPending={acceptedHandoffPending}
        mode={mode}
        onContinue={handleAccept}
        pending={pending}
        variant={resolveLaunchConsentVariant(pendingScopes)}
      />
    );
  }

  if (!featureScope) {
    return null;
  }

  const continueButton = (
    <Button
      aria-busy={actionPending}
      className={mode === "compact" ? "w-full" : undefined}
      type="button"
      onClick={handleAccept}
      disabled={!canSubmit || actionPending}
      size={mode === "compact" ? "xl" : "lg"}
    >
      {acceptedHandoffPending
        ? acceptedPendingLabel
        : pending
          ? "Saving..."
          : "Continue"}
    </Button>
  );

  const content = (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="font-serif text-xl font-normal tracking-tight text-foreground">
          Connect health sources
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review and accept the health source consent for this integration.
        </p>
      </div>
      <div className="space-y-3">
        <DocumentLinks documents={featureScope.documents} />
        <ConsentCheckbox
          checked={featureAccepted}
          onChange={setFeatureAccepted}
          label="I agree to the above"
        />
      </div>
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to record consent</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {continueButton}
    </div>
  );

  if (mode === "compact") {
    return <div className={joinClassNames("w-full", className)}>{content}</div>;
  }

  return (
    <div className={joinClassNames(cardClassName(mode), className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-olive">
          <ShieldCheckIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    </div>
  );
}

export function HostedLaunchConsentPrompt({
  acceptedPendingLabel = "Continuing...",
  className,
  documents,
  errorMessage = null,
  handoffPending = false,
  mode = "compact",
  onContinue,
  pending = false,
  variant = "combined",
}: HostedLaunchConsentPromptProps) {
  const copy = resolveLaunchConsentCopy(variant);
  const actionPending = pending || handoffPending;
  const content = (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="font-serif text-xl font-normal tracking-tight text-foreground">
            {copy.title}
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <LaunchDocumentLinks documents={documents} />
      </div>
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to record consent</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        aria-busy={actionPending}
        className={mode === "compact" ? "w-full" : undefined}
        disabled={actionPending}
        onClick={onContinue}
        size={mode === "compact" ? "xl" : "lg"}
        type="button"
      >
        {handoffPending
          ? acceptedPendingLabel
          : pending
            ? "Saving..."
            : copy.actionLabel}
      </Button>
    </div>
  );

  if (mode === "compact") {
    return <div className={joinClassNames("w-full", className)}>{content}</div>;
  }

  return (
    <div className={joinClassNames(cardClassName(mode), className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-olive">
          <ShieldCheckIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
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

function LaunchDocumentLinks({
  documents,
}: {
  documents: HostedConsentScopeStatus["documents"];
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-relaxed text-muted-foreground">
      {documents.map((document) => (
        <a
          className="font-medium text-foreground underline-offset-4 hover:underline"
          href={document.href}
          key={document.id}
          rel="noreferrer"
          target="_blank"
        >
          {shortDocumentTitle(document.title)}
        </a>
      ))}
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

function collectScopeDocuments(
  status: HostedConsentStatus,
  scopes: HostedConsentScope[],
): HostedConsentScopeStatus["documents"] {
  const documents = new Map<string, HostedConsentScopeStatus["documents"][number]>();

  for (const scope of scopes) {
    const scopeStatus = findConsentScope(status, scope);
    for (const document of scopeStatus?.documents ?? []) {
      documents.set(document.id, document);
    }
  }

  return [...documents.values()];
}

function resolveLaunchConsentVariant(
  scopes: HostedConsentScope[],
): HostedLaunchConsentVariant {
  const legalPending = scopes.includes("launch.legal");
  const healthDataPending = scopes.includes("launch.health-data");

  if (legalPending && healthDataPending) return "combined";
  if (healthDataPending) return "health-data";
  return "legal";
}

function resolveLaunchConsentCopy(variant: HostedLaunchConsentVariant): {
  actionLabel: string;
  description: string;
  title: string;
} {
  if (variant === "legal") {
    return {
      actionLabel: "Agree & continue",
      description: "We updated the terms and disclosures that govern your use of Murph.",
      title: "Review Murph’s terms",
    };
  }

  return {
    actionLabel: variant === "combined" ? "Agree, consent & continue" : "Consent & continue",
    description:
      "Murph uses health data you add or connect to personalize your experience, including through contracted AI providers. We don’t sell it, use it for ads, or train general-purpose AI models with it.",
    title: "Use your health data with Murph",
  };
}

function shortDocumentTitle(title: string): string {
  switch (title) {
    case "Murph Terms of Service":
      return "Terms";
    case "Murph Privacy Policy":
      return "Privacy";
    case "Murph Consumer Health Data Notice":
      return "Health Data Notice";
    case "Murph Health AI Safety Disclosure":
      return "AI Safety";
    default:
      return title.replace(/^Murph\s+/u, "");
  }
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

export function ConsentSkeleton() {
  return (
    <div className="w-full animate-pulse space-y-6">
      <div className="space-y-3">
        <div className="h-5 w-56 rounded-full bg-muted" />
        <div className="space-y-2.5">
          <div className="h-4 w-full rounded-full bg-muted" />
          <div className="h-4 w-4/5 rounded-full bg-muted" />
        </div>
        <div className="flex gap-3">
          <div className="h-3.5 w-14 rounded-full bg-muted" />
          <div className="h-3.5 w-14 rounded-full bg-muted" />
          <div className="h-3.5 w-24 rounded-full bg-muted" />
        </div>
      </div>
      <div className="h-14 w-full rounded-2xl bg-muted" />
    </div>
  );
}
