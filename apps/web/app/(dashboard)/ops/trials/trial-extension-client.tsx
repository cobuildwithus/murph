"use client";

import { CalendarPlusIcon, SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import type {
  HostedPulseTrialExtensionPreviewProof,
  HostedPulseTrialExtensionResult,
} from "@/src/lib/hosted-ops/pulse-trial-extension";

type PendingAction = "apply" | "preview" | null;
const PREVIEW_STALE_ERROR_CODE =
  "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE";

export function TrialExtensionClient() {
  const [memberId, setMemberId] = useState("");
  const [result, setResult] = useState<HostedPulseTrialExtensionResult | null>(
    null,
  );
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const memberIdRef = useRef(memberId);
  const normalizedMemberId = memberId.trim();

  async function previewExtension(): Promise<void> {
    if (!normalizedMemberId) {
      return;
    }
    setPending("preview");
    setError(null);
    try {
      const preview = await requestTrialExtension({
        memberId: normalizedMemberId,
        mode: "preview",
        previewProof: null,
      });
      if (memberIdRef.current.trim() === normalizedMemberId) {
        setResult(preview);
      }
    } catch (requestError) {
      setError(readRequestErrorMessage(requestError));
    } finally {
      setPending(null);
    }
  }

  async function applyExtension(): Promise<void> {
    if (!result?.eligible || !result.previewProof) {
      return;
    }
    setPending("apply");
    setError(null);
    try {
      setResult(await requestTrialExtension({
        memberId: result.memberId,
        mode: "apply",
        previewProof: result.previewProof,
      }));
    } catch (requestError) {
      if (isPreviewStaleRequestError(requestError)) {
        setResult(null);
        setError(readRequestErrorMessage(requestError));
      } else {
        setError(
          "The trial extension could not be confirmed. Retry Apply with the same Preview.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="max-w-3xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Ops notebook
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Trials
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Enter one member ID, check the current Stripe trial, then add seven
            days. Lapsed paused trials restart from Preview time. Active trials
            extend from their current end. Paid billing is never changed.
          </p>
        </div>
      </header>

      <section
        aria-busy={pending !== null}
        aria-labelledby="member-trial-extension-title"
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-chart-5">
            7 more days
          </span>
          <h2
            className="font-serif text-xl font-semibold tracking-tight text-foreground"
            id="member-trial-extension-title"
          >
            Extend one member
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Preview is required before Apply so you can verify the exact member
            and trial window.
          </p>
        </div>

        <form
          className="mt-5 flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void previewExtension();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="trial-extension-member-id">Member ID</Label>
            <Input
              autoComplete="off"
              disabled={pending !== null}
              id="trial-extension-member-id"
              onChange={(event) => {
                memberIdRef.current = event.target.value;
                setMemberId(event.target.value);
                setResult(null);
                setError(null);
              }}
              placeholder="hbm_..."
              spellCheck={false}
              value={memberId}
            />
          </div>
          <Button
            disabled={!normalizedMemberId || pending !== null}
            onClick={() => void previewExtension()}
            type="button"
            variant="outline"
          >
            <SearchIcon data-icon="inline-start" />
            {pending === "preview" ? "Previewing..." : "Preview"}
          </Button>
        </form>

        {error ? (
          <Alert className="mt-5 max-w-3xl" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <p aria-live="polite" className="sr-only">
          {readAnnouncedStatus({ error, pending, result })}
        </p>

        <div className="mt-6 overflow-hidden rounded-lg border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>Stripe</TableHead>
                <TableHead>Current end</TableHead>
                <TableHead>New end</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result ? (
                <TableRow>
                  <TableCell className="font-mono text-xs">
                    {result.memberId}
                  </TableCell>
                  <TableCell>
                    <BillingStateBadge
                      phase={result.localBillingPhase}
                      status={result.localBillingStatus}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {result.providerStatus ?? "Not checked"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatTrialDate(result.currentTrialEndsAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatTrialDate(result.targetTrialEndsAt)}
                  </TableCell>
                  <TableCell className="min-w-64">
                    <div className="flex flex-col gap-1">
                      <Badge variant={result.eligible ? "secondary" : "outline"}>
                        {readResultLabel(result)}
                      </Badge>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {result.message}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {result.outcome === "preview" && result.eligible &&
                        result.previewProof ? (
                      <Button
                        disabled={pending !== null}
                        onClick={() => void applyExtension()}
                        size="sm"
                        type="button"
                      >
                        <CalendarPlusIcon data-icon="inline-start" />
                        {pending === "apply" ? "Applying..." : "Apply +7 days"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {result.outcome === "preview" ? "No action" : "Done"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ) : pending === "preview" ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-sm text-muted-foreground"
                    colSpan={7}
                  >
                    Checking member trial...
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-sm text-muted-foreground"
                    colSpan={7}
                  >
                    Enter a member ID to preview the trial.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function readAnnouncedStatus(input: {
  error: string | null;
  pending: PendingAction;
  result: HostedPulseTrialExtensionResult | null;
}): string {
  if (input.pending === "preview") {
    return "Checking member trial.";
  }
  if (input.pending === "apply") {
    return "Applying seven-day trial extension.";
  }
  if (input.error) {
    return "";
  }
  if (!input.result) {
    return "";
  }
  return input.result.outcome === "preview"
    ? `Preview complete. ${input.result.message}`
    : input.result.message;
}

function BillingStateBadge(input: {
  phase: string | null;
  status: string | null;
}) {
  const label = [input.status, input.phase].filter(Boolean).join(" · ");
  return <Badge variant="outline">{label || "Not found"}</Badge>;
}

function readResultLabel(result: HostedPulseTrialExtensionResult): string {
  if (result.outcome === "extended") {
    return "Extended";
  }
  if (result.outcome === "reconciled") {
    return "Reconciled";
  }
  return result.eligible ? "Ready" : "No change";
}

function formatTrialDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "Not set";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function requestTrialExtension(input: {
  memberId: string;
  mode: "apply" | "preview";
  previewProof: HostedPulseTrialExtensionPreviewProof | null;
}): Promise<HostedPulseTrialExtensionResult> {
  const response = await fetch("/api/ops/pulse-trial-extension", {
    body: JSON.stringify({
      memberId: input.memberId,
      mode: input.mode,
      ...(input.previewProof ? { previewProof: input.previewProof } : {}),
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TrialExtensionRequestError(
      "Trial extension returned an unreadable response.",
      null,
    );
  }
  if (!response.ok) {
    throw new TrialExtensionRequestError(
      readResponseErrorMessage(payload),
      readResponseErrorCode(payload),
    );
  }
  if (!isHostedPulseTrialExtensionResult(payload)) {
    throw new TrialExtensionRequestError(
      "Trial extension returned an invalid response.",
      null,
    );
  }
  return payload;
}

class TrialExtensionRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
    this.name = "TrialExtensionRequestError";
  }
}

function readResponseErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = Reflect.get(payload, "error");
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function isPreviewStaleRequestError(error: unknown): boolean {
  return error instanceof TrialExtensionRequestError &&
    error.code === PREVIEW_STALE_ERROR_CODE;
}

function isHostedPulseTrialExtensionResult(
  value: unknown,
): value is HostedPulseTrialExtensionResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof Reflect.get(value, "memberId") === "string" &&
      typeof Reflect.get(value, "eligible") === "boolean" &&
      typeof Reflect.get(value, "message") === "string" &&
      typeof Reflect.get(value, "outcome") === "string",
  );
}

function readResponseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Trial extension failed. Try again.";
  }
  const error = Reflect.get(payload, "error");
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  const message = Reflect.get(payload, "message");
  return typeof message === "string" && message.trim()
    ? message
    : "Trial extension failed. Try again.";
}

function readRequestErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Trial extension failed. Try again.";
}
