"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import type { HostedOpsOnboardingActivationResult } from "@/src/lib/hosted-ops/onboarding-activation";

export function OnboardingActivationClient() {
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<HostedOpsOnboardingActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function activate(formData: FormData): Promise<void> {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(await requestJson<HostedOpsOnboardingActivationResult>(
        "/api/ops/onboarding-activation",
        {
          body: JSON.stringify({
            inviteCodeOrUrl: readFormDataString(formData, "inviteCodeOrUrl"),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ));
    } catch (activationError) {
      setError(describeClientError(activationError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
              Ops notebook
            </span>
            <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight text-foreground md:text-4xl">
              Onboarding activation
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Activate a verified hosted signup that stopped before billing by starting the no-card Pulse Trial path.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryChip label="Route" value="ops only" />
            <SummaryChip label="Billing" value="Pulse Trial" />
            <SummaryChip label="Link" value="not returned" />
          </div>
        </div>
      </header>

      <section
        aria-busy={pending}
        aria-labelledby="onboarding-activation-title"
        className="rounded-xl border border-border/70 bg-card/90 p-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
              Checkout repair
            </span>
            <h2
              className="mt-1 font-serif text-xl font-semibold text-foreground"
              id="onboarding-activation-title"
            >
              Activate existing signup
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Uses an invite code or join URL to locate the member, then delegates to the standard no-card trial enrollment and activation flow.
            </p>
          </div>
          {result ? (
            <Badge variant={resolveStatusBadgeVariant(result.status)}>
              <CheckCircle2Icon data-icon="inline-start" />
              {formatActivationStatus(result.status)}
            </Badge>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void activate(new FormData(event.currentTarget));
          }}
        >
          <Field label="Invite code or join URL" htmlFor="onboarding-activation-invite">
            <Input
              autoComplete="off"
              id="onboarding-activation-invite"
              name="inviteCodeOrUrl"
              placeholder="https://www.withmurph.ai/join/..."
              required
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {pending ? "Activating hosted signup." : ""}
            </div>
            <Button disabled={pending} type="submit">
              {pending ? (
                <RefreshCwIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {pending ? "Activating..." : "Activate trial"}
            </Button>
          </div>
        </form>

        {error ? (
          <Alert className="mt-4" variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription className="min-w-0 break-words">{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? <ActivationResultPanel result={result} /> : null}
      </section>
    </div>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        htmlFor={htmlFor}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function ActivationResultPanel({
  result,
}: {
  result: HostedOpsOnboardingActivationResult;
}) {
  return (
    <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricTile label="Status" value={formatActivationStatus(result.status)} />
        <MetricTile
          label="Before"
          value={result.member.billingStatusBefore}
        />
        <MetricTile
          label="Invite"
          value={result.invite.enrollmentInviteRefreshed ? "Refreshed" : "Reused"}
        />
      </div>
      <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
        <ResultValue
          label="Source invite"
          value={result.invite.sourceExpired ? "Expired" : "Active"}
        />
        <ResultValue
          label="Source channel"
          value={result.invite.sourceChannel}
        />
        <ResultValue
          label="Source expires"
          value={formatDateTime(result.invite.sourceExpiresAt)}
        />
        <ResultValue
          label="Enrollment expires"
          value={formatDateTime(result.invite.enrollmentInviteExpiresAt)}
        />
        <ResultValue
          label="Redirect"
          value={result.redirectPath}
        />
        <ResultValue
          label="Generated"
          value={formatDateTime(result.generatedAt)}
        />
      </div>
      {result.member.suspended ? (
        <Alert variant="destructive">
          <KeyRoundIcon data-icon="inline-start" />
          <AlertDescription>
            The source member was suspended before activation.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function MetricTile(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/90 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-2 break-words font-serif text-2xl font-semibold leading-none text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function ResultValue(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em]">
        {input.label}
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-foreground">
        {input.value}
      </div>
    </div>
  );
}

function SummaryChip(input: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </div>
      <div className="mt-1 font-mono text-[11px] font-medium text-foreground">
        {input.value}
      </div>
    </div>
  );
}

async function requestJson<TResponse>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readJsonErrorMessage(payload) ?? `Request failed with status ${response.status}.`);
  }

  return payload as TResponse;
}

function readJsonErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }
  return typeof error.message === "string" ? error.message : null;
}

function describeClientError(error: unknown): string {
  return error instanceof Error ? error.message : "Hosted onboarding activation request failed.";
}

function readFormDataString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatActivationStatus(status: HostedOpsOnboardingActivationResult["status"]): string {
  if (status === "already_active") {
    return "Already active";
  }
  if (status === "already_enrolled") {
    return "Already enrolled";
  }
  return "Enrolled";
}

function resolveStatusBadgeVariant(
  status: HostedOpsOnboardingActivationResult["status"],
): "default" | "outline" | "secondary" {
  if (status === "already_active") {
    return "outline";
  }
  if (status === "already_enrolled") {
    return "secondary";
  }
  return "secondary";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
