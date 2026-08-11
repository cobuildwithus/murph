"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CheckIcon, ExternalLinkIcon, MailIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import { Skeleton } from "@/src/components/ui/skeleton";
import { buildContactSupportMailto } from "@/src/components/support/contact-support-action";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import type {
  HostedConsentScope,
  HostedConsentScopeStatus,
  HostedConsentStatus,
} from "@/src/lib/legal/consent";
import { cn } from "@/src/lib/utils";

type HostedLegalConsentCardMode = "compact" | "panel";
type HostedLaunchConsentVariant = "combined" | "health-data" | "legal";

const CONSENT_RETRY_SUPPORT_THRESHOLD = 3;

export interface HostedLegalConsentAcceptanceInput {
  acceptedDocumentVersions: Record<string, string>;
  currentStatus: HostedConsentStatus;
  scope: HostedConsentScope;
  source: string;
}

export type HostedLegalConsentAcceptScope = (
  input: HostedLegalConsentAcceptanceInput,
) => Promise<HostedConsentStatus>;

interface HostedLegalConsentCardProps {
  acceptedPendingLabel?: string;
  acceptScope?: HostedLegalConsentAcceptScope;
  className?: string;
  declinePending?: boolean;
  initialStatus?: HostedConsentStatus | null;
  launchDescription?: string;
  launchTitle?: string;
  mode?: HostedLegalConsentCardMode;
  onAccepted?: (status: HostedConsentStatus) => void | Promise<void>;
  onActionPendingChange?: (pending: boolean) => void;
  onDecline?: () => void;
  onRequirementChange?: (required: boolean) => void;
  preferredScope?: HostedConsentScope;
  source: string;
}

interface HostedLaunchConsentPromptProps {
  acceptedPendingLabel?: string;
  className?: string;
  declinePending?: boolean;
  description?: string;
  documents: HostedConsentScopeStatus["documents"];
  errorMessage?: string | null;
  failedAttempts?: number;
  handoffPending?: boolean;
  mode?: HostedLegalConsentCardMode;
  onContinue: () => void;
  onDecline?: () => void;
  pending?: boolean;
  title?: string;
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
  acceptScope = requestHostedConsentAcceptance,
  className,
  declinePending = false,
  initialStatus = null,
  launchDescription,
  launchTitle,
  mode = "panel",
  onAccepted,
  onActionPendingChange,
  onDecline,
  onRequirementChange,
  preferredScope = "launch.legal",
  source,
}: HostedLegalConsentCardProps) {
  const [loadedStatus, setLoadedStatus] = useState<HostedConsentStatus | null>(null);
  const [statusOverride, setStatusOverride] = useState<HostedConsentStatus | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<HostedConsentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [acceptedHandoffPending, setAcceptedHandoffPending] = useState(false);
  const [loading, setLoading] = useState(!initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [featureAccepted, setFeatureAccepted] = useState(false);
  const status = statusOverride ?? loadedStatus ?? initialStatus;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await requestHostedLegalConsentStatus();
      setStatusOverride(null);
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

        setStatusOverride(null);
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
    onActionPendingChange?.(actionPending);
  }, [actionPending, onActionPendingChange]);

  useEffect(() => {
    if (!status) return;
    onRequirementChange?.(pendingScopes.length > 0);
  }, [pendingScopes, onRequirementChange, status]);

  async function handleAccept() {
    if (actionPending || !canSubmit || !status) return;

    setPending(true);
    setAcceptedHandoffPending(false);
    setErrorMessage(null);

    let latestStatus = handoffStatus ?? status;
    try {
      if (!handoffStatus) {
        for (const scope of pendingScopes) {
          const scopeStatus = findConsentScope(latestStatus, scope);
          if (scopeStatus && !scopeStatus.granted) {
            latestStatus = await acceptScope({
              acceptedDocumentVersions: Object.fromEntries(
                scopeStatus.documents.map((document) => [document.id, document.version]),
              ),
              currentStatus: latestStatus,
              scope,
              source,
            });
          }
        }
        setHandoffStatus(latestStatus);
      }

      setAcceptedHandoffPending(true);
      if (onAccepted) {
        await onAccepted(latestStatus);
      }
    } catch (error) {
      const hasRemainingScope = pendingScopes.some(
        (scope) => !findConsentScope(latestStatus, scope)?.granted,
      );
      if (hasRemainingScope && latestStatus !== status) {
        setStatusOverride(latestStatus);
      }
      setAcceptedHandoffPending(false);
      setFailedAttempts((attempts) => attempts + 1);
      setErrorMessage(
        readConsentErrorMessage(error, "Could not record Murph legal consent right now."),
      );
    } finally {
      setPending(false);
    }
  }

  if (!initialStatus && loading) {
    const declineAction = onDecline ? (
      <ConsentDeclineButton
        busy={declinePending}
        disabled={declinePending}
        onDecline={onDecline}
      />
    ) : null;

    return (
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className={cn(cardClassName(mode), className)}
      >
        <ConsentSkeleton secondaryAction={declineAction} />
      </div>
    );
  }

  if (!status && errorMessage) {
    return (
      <div className={cn(cardClassName(mode), className)}>
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>Unable to load Murph legal consent</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <div
            className={cn({
              "grid grid-cols-[7rem_minmax(0,1fr)] gap-3": onDecline,
            })}
          >
            {onDecline ? (
              <ConsentDeclineButton
                busy={declinePending}
                disabled={declinePending}
                onDecline={onDecline}
              />
            ) : null}
            <Button
              disabled={declinePending}
              onClick={loadStatus}
              size="lg"
              type="button"
            >
              Try again
            </Button>
          </div>
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
        declinePending={declinePending}
        description={launchDescription}
        documents={launchDocuments}
        errorMessage={errorMessage}
        failedAttempts={failedAttempts}
        handoffPending={acceptedHandoffPending}
        mode={mode}
        onContinue={handleAccept}
        onDecline={onDecline}
        pending={pending}
        title={launchTitle}
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
    return <div className={cn("w-full", className)}>{content}</div>;
  }

  return (
    <div className={cn(cardClassName(mode), className)}>
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
  declinePending = false,
  description,
  documents,
  errorMessage = null,
  failedAttempts = 0,
  handoffPending = false,
  mode = "compact",
  onContinue,
  onDecline,
  pending = false,
  title,
  variant = "combined",
}: HostedLaunchConsentPromptProps) {
  const variantCopy = resolveLaunchConsentCopy(variant);
  const copy = {
    actionLabel: variantCopy.actionLabel,
    assurances: variantCopy.assurances,
    description: description ?? variantCopy.description,
    title: title ?? variantCopy.title,
  };
  const accepting = pending || handoffPending;
  const actionPending = accepting || declinePending;
  const introduction = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <p className="font-serif text-2xl font-semibold leading-[1.15] tracking-tight text-foreground">
          {copy.title}
        </p>
        <p className="max-w-[40rem] text-[15px] leading-6 text-pretty text-muted-foreground">
          {copy.description}
        </p>
      </div>
      {copy.assurances.length > 0 ? (
        <ul className="flex flex-col gap-2 rounded-xl bg-muted/50 px-3.5 py-3 text-[13px] leading-5 text-foreground/85">
          {copy.assurances.map((assurance) => (
            <li className="flex items-start gap-2.5" key={assurance}>
              <CheckIcon className="mt-[3px] size-3.5 shrink-0 text-olive" aria-hidden />
              <span>{assurance}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <LaunchDocumentLinks documents={documents} />
    </div>
  );
  const supportExhausted = failedAttempts >= CONSENT_RETRY_SUPPORT_THRESHOLD;
  const error = errorMessage ? (
    <Alert
      className="rounded-lg border-destructive/25 bg-destructive/[0.07] px-3.5 py-2.5 before:hidden"
      variant="destructive"
    >
      <AlertTitle className="sr-only">Unable to record consent</AlertTitle>
      <AlertDescription className="text-[13px] leading-5">
        {errorMessage}
        {supportExhausted ? " Our team can finish this for you." : null}
      </AlertDescription>
    </Alert>
  ) : null;
  const consentLabel = handoffPending
    ? acceptedPendingLabel
    : pending
      ? "Saving..."
      : supportExhausted
        ? "Try again later"
        : copy.actionLabel;
  const primaryButton = (
    <Button
      aria-busy={accepting}
      className={cn(
        "min-w-0 flex-1 sm:max-w-[13rem]",
        supportExhausted && "text-muted-foreground",
      )}
      disabled={actionPending}
      onClick={onContinue}
      size="lg"
      type="button"
      variant={supportExhausted ? "outline" : "default"}
    >
      {consentLabel}
    </Button>
  );
  const actions = (
    <div className="flex flex-col gap-3">
      {supportExhausted ? (
        <a
          className={cn(
            buttonVariants({ size: "lg" }),
            "w-full",
          )}
          href={buildContactSupportMailto({
            subject: "Murph could not record my consent",
          })}
        >
          <MailIcon aria-hidden />
          Contact support
        </a>
      ) : null}
      <div
        className={cn(
          "flex items-center gap-3",
          onDecline ? "justify-between" : "justify-end",
        )}
      >
        {onDecline ? (
          <ConsentDeclineButton
            busy={declinePending}
            disabled={actionPending}
            onDecline={onDecline}
          />
        ) : null}
        {primaryButton}
      </div>
    </div>
  );

  if (mode === "compact") {
    return (
      <div className={cn("flex w-full flex-col gap-5", className)}>
        {introduction}
        {error}
        {actions}
      </div>
    );
  }

  return (
    <div className={cn(cardClassName(mode), className)}>
      <div className="flex flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          {introduction}
          {error}
        </div>
        {actions}
      </div>
    </div>
  );
}

function requestHostedConsentAcceptance(
  input: HostedLegalConsentAcceptanceInput,
): Promise<HostedConsentStatus> {
  return requestHostedOnboardingJson<HostedConsentStatus>({
    method: "POST",
    payload: {
      acceptedDocumentVersions: input.acceptedDocumentVersions,
      scope: input.scope,
      source: input.source,
    },
    url: "/api/legal/consent/accept",
  });
}

function ConsentDeclineButton({
  busy,
  disabled,
  onDecline,
}: {
  busy: boolean;
  disabled: boolean;
  onDecline: () => void;
}) {
  return (
    <Button
      aria-busy={busy}
      className="px-3 text-muted-foreground hover:text-foreground"
      disabled={disabled}
      onClick={onDecline}
      size="lg"
      type="button"
      variant="ghost"
    >
      {busy ? "Declining..." : "Decline"}
    </Button>
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
    <div className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 size-5 shrink-0"
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
    <nav
      aria-label="Consent documents"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs leading-5 text-muted-foreground"
    >
      {documents.map((document) => (
        <a
          className="underline decoration-transparent underline-offset-4 transition-colors hover:text-foreground hover:decoration-border"
          href={document.href}
          key={document.id}
          rel="noreferrer"
          target="_blank"
        >
          {shortDocumentTitle(document.title)}
        </a>
      ))}
    </nav>
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

const LAUNCH_CONSENT_ASSURANCES = [
  "Not sold or used to train general-purpose AI models. Withdraw anytime in Settings.",
];

function resolveLaunchConsentCopy(variant: HostedLaunchConsentVariant): {
  actionLabel: string;
  assurances: string[];
  description: string;
  title: string;
} {
  if (variant === "legal") {
    return {
      actionLabel: "Agree",
      assurances: [],
      description: "Review the updated terms and disclosures that govern your use of Murph.",
      title: "Review Murph’s terms",
    };
  }

  if (variant === "health-data") {
    return {
      actionLabel: "Consent",
      assurances: LAUNCH_CONSENT_ASSURANCES,
      description:
        "Murph uses health data you share to personalize answers and insights. AI providers process relevant data on Murph’s behalf.",
      title: "Use your health data",
    };
  }

  return {
    actionLabel: "Consent",
    assurances: LAUNCH_CONSENT_ASSURANCES,
    description:
      "Murph uses health data you share to personalize answers and insights. AI providers process relevant data on Murph’s behalf. You’ll also agree to Murph’s Terms.",
    title: "Use your health data",
  };
}

function shortDocumentTitle(title: string): string {
  switch (title) {
    case "Murph Terms of Service":
      return "Terms";
    case "Murph Privacy Policy":
      return "Privacy";
    case "Murph Consumer Health Data Notice":
      return "Health data";
    case "Murph Health AI Safety Disclosure":
      return "AI safety";
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
    : "rounded-xl border border-border bg-card p-5 sm:p-6";
}

export function ConsentSkeleton({
  secondaryAction = null,
}: {
  secondaryAction?: React.ReactNode;
} = {}) {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3.5">
        <Skeleton className="h-2.5 w-28 rounded-full" />
        <Skeleton className="h-6 w-64 max-w-full rounded-full" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-4/5 rounded-full" />
        </div>
        <div className="flex gap-2.5">
          <Skeleton className="h-3 w-12 rounded-full" />
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </div>
      <div
        className={cn({
          "grid grid-cols-[7rem_minmax(0,1fr)] gap-3": secondaryAction,
        })}
      >
        {secondaryAction}
        <Skeleton className="h-11 rounded-2xl" />
      </div>
    </div>
  );
}
