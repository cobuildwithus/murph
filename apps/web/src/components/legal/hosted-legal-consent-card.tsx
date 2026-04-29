"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
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
  preferredScope = "launch.required",
  source,
}: HostedLegalConsentCardProps) {
  const [status, setStatus] = useState<HostedConsentStatus | null>(null);
  const [accepted, setAccepted] = useState(false);
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

  const activeScope = useMemo(() => {
    if (!status) return null;
    const launchScope = findConsentScope(status, "launch.required");
    if (!launchScope?.granted) return launchScope ?? null;

    const preferred = findConsentScope(status, preferredScope);
    if (preferred && !preferred.granted) return preferred;

    return null;
  }, [preferredScope, status]);

  useEffect(() => {
    if (!status) return;
    onRequirementChange?.(Boolean(activeScope));
  }, [activeScope, onRequirementChange, status]);

  async function handleAccept() {
    if (!activeScope || pending || !accepted) return;

    setPending(true);
    setErrorMessage(null);

    try {
      const nextStatus = await requestHostedOnboardingJson<HostedConsentStatus>({
        method: "POST",
        payload: {
          acceptedDocumentVersions: Object.fromEntries(
            activeScope.documents.map((document) => [document.id, document.version]),
          ),
          scope: activeScope.scope,
          source,
        },
        url: "/api/legal/consent/accept",
      });
      setStatus(nextStatus);
      setAccepted(false);
      await onAccepted?.(nextStatus);
    } catch (error) {
      setErrorMessage(readConsentErrorMessage(error, "Could not record Murph legal consent right now."));
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <div className={joinClassNames(cardClassName(mode), className)}>
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

  if (!activeScope) {
    return null;
  }

  return (
    <div className={joinClassNames(cardClassName(mode), className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-olive">
          <ShieldCheckIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className="font-serif text-xl font-normal tracking-tight text-foreground">
              {activeScope.scope === "launch.required"
                ? "Review Murph legal consent"
                : "Connect health sources"}
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {activeScope.scope === "launch.required"
                ? "Before hosted Murph can process health data, accept the current Terms, Privacy Policy, Consumer Health Data Notice, and Health AI Safety Disclosure."
                : "Before Murph can connect a wearable, accept the connected health source consent for this optional integration."}
            </p>
          </div>

          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {activeScope.documents.map((document) => (
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

          <label className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.currentTarget.checked)}
              className="mt-1 size-4 rounded border-border text-olive"
            />
            <span>I have read and accept the current Murph legal documents for this consent.</span>
          </label>

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to record consent</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="button" onClick={handleAccept} disabled={!accepted || pending} size="lg">
            {pending ? "Recording..." : "Accept and continue"}
          </Button>
        </div>
      </div>
    </div>
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
    ? "rounded-xl border border-[#c4a882]/35 bg-[#fefdf8] p-4"
    : "rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-6 shadow-[0_1px_2px_rgba(45,52,54,0.04)]";
}

function joinClassNames(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
