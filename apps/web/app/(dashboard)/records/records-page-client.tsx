"use client";

import {
  FileTextIcon,
  LockKeyholeIcon,
  PlusIcon,
  UnplugIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { PageHeader } from "@/src/components/ui/page-header";
import { Spinner } from "@/src/components/ui/spinner";
import {
  parseClinicalRecordDisconnectResponse,
  type ClinicalRecordCallbackMarker,
  type ClinicalRecordConnectionContract,
} from "@/src/lib/clinical-records/client-contracts";

const ACTIVE_IMPORT_REFRESH_INTERVAL_MS = 15_000;

export function RecordsPageClient({
  authenticated,
  initialCallback,
  initialConnections,
  initialLoadError,
}: {
  authenticated: boolean;
  initialCallback: ClinicalRecordCallbackMarker | null;
  initialConnections: readonly ClinicalRecordConnectionContract[];
  initialLoadError: boolean;
}) {
  const [disconnectedConnectionIds, setDisconnectedConnectionIds] = useState<readonly string[]>([]);
  const [disconnectTarget, setDisconnectTarget] =
    useState<ClinicalRecordConnectionContract | null>(null);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);
  const disconnectInFlightRef = useRef(false);
  const disconnectNoticeRef = useRef<HTMLDivElement>(null);
  const operationGenerationRef = useRef(0);
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const connections = initialConnections.map((connection) => disconnectedConnectionIds.includes(connection.connectionId)
    ? { ...connection, status: "disconnected" as const }
    : connection);
  const hasActiveImport = connections.some(isImportInProgress);

  useLayoutEffect(() => {
    stripClinicalRecordsCallbackFromCurrentUrl();
  }, []);

  useEffect(() => {
    function restoreAfterHistoryNavigation(event: PageTransitionEvent) {
      if (!event.persisted) {
        return;
      }
      operationGenerationRef.current += 1;
      disconnectInFlightRef.current = false;
      setDisconnectPending(false);
    }

    window.addEventListener("pageshow", restoreAfterHistoryNavigation);
    return () => window.removeEventListener("pageshow", restoreAfterHistoryNavigation);
  }, []);

  useEffect(() => {
    if (!hasActiveImport) {
      return;
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") {
        return;
      }
      router.refresh();
    }

    const timer = setInterval(refreshWhenVisible, ACTIVE_IMPORT_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasActiveImport, router]);

  async function disconnectConnection() {
    const target = disconnectTarget;
    if (!target || disconnectInFlightRef.current) {
      return;
    }

    disconnectInFlightRef.current = true;
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    setDisconnectPending(true);
    setDisconnectError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        url: `/api/clinical-records/connections/${encodeURIComponent(target.connectionId)}/disconnect`,
      });
      const disconnected = parseClinicalRecordDisconnectResponse(response);
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      setDisconnectedConnectionIds((current) => [
        ...current,
        disconnected.connectionId,
      ]);
      setDisconnectTarget(null);
      setDisconnectNotice(
        `${target.displayName} was disconnected. Results already copied into Murph stay there.`,
      );
      requestAnimationFrame(() => disconnectNoticeRef.current?.focus());
    } catch {
      if (operationGenerationRef.current !== operationGeneration) {
        return;
      }
      setDisconnectError(`Could not disconnect ${target.displayName}. Try again.`);
    } finally {
      if (operationGenerationRef.current === operationGeneration) {
        disconnectInFlightRef.current = false;
        setDisconnectPending(false);
      }
    }
  }

  const callbackNotice = disconnectNotice
    ? null
    : describeCallback(initialCallback);

  return (
    <div className="flex w-full min-w-0 flex-col gap-10">
      <PageHeader
        eyebrow="Private vault"
        title="Medical records"
        description="Import records from your patient portal for your private vault and conversations with Murph."
      >
        {authenticated ? (
          <Link className={buttonVariants({ size: "lg", className: "mt-5 w-full sm:w-auto" })} href="/records/connect?launch=clinical-records">
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            Import records
          </Link>
        ) : null}
      </PageHeader>

      <div className="max-w-5xl space-y-6">
        {callbackNotice ? (
          <Alert
            className={callbackNotice.kind === "neutral"
              ? "border-border bg-card text-card-foreground before:bg-border"
              : undefined}
            variant={callbackNotice.kind === "error" ? "destructive" : "default"}
          >
            <AlertTitle>{callbackNotice.title}</AlertTitle>
            <AlertDescription>{callbackNotice.message}</AlertDescription>
          </Alert>
        ) : null}

        {disconnectNotice ? (
          <Alert
            ref={disconnectNoticeRef}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            tabIndex={-1}
          >
            <AlertTitle>Patient portal disconnected</AlertTitle>
            <AlertDescription>{disconnectNotice}</AlertDescription>
          </Alert>
        ) : null}

        {!authenticated ? (
          <AuthRequiredState onSignIn={openAuthDialog} />
        ) : initialLoadError ? (
          <LoadErrorState />
        ) : connections.length === 0 ? (
          <EmptyRecordsState />
        ) : (
          <section aria-labelledby="patient-portals-title" className="space-y-4">
            <h2 id="patient-portals-title" className="font-serif text-2xl font-medium tracking-tight text-foreground">Your sources</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.connectionId}
                  connection={connection}
                  disabled={disconnectPending}
                  onDisconnect={() => {
                    setDisconnectError(null);
                    setDisconnectTarget(connection);
                  }}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <DisconnectDialog
        connection={disconnectTarget}
        errorMessage={disconnectError}
        pending={disconnectPending}
        onConfirm={() => void disconnectConnection()}
        onOpenChange={(open) => {
          if (!open && !disconnectPending) {
            setDisconnectError(null);
            setDisconnectTarget(null);
          }
        }}
      />
    </div>
  );
}

export function ConnectionRow({
  connection,
  disabled,
  onDisconnect,
}: {
  connection: ClinicalRecordConnectionContract;
  disabled: boolean;
  onDisconnect: () => void;
}) {
  const presentation = describeConnection(connection);
  const latestRun = connection.latestRun;
  const importInProgress = isImportInProgress(connection);

  return (
    <li className="p-5 sm:p-7">
      <article>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileTextIcon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="font-serif text-xl font-medium leading-6 tracking-tight text-foreground text-pretty">
                {connection.displayName}
              </h3>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Connected <time dateTime={connection.connectedAt}>{formatDate(connection.connectedAt)}</time>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-12 sm:pl-0">
            <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
            {importInProgress ? (
              <Spinner aria-hidden="true" role="presentation" className="size-3.5 text-muted-foreground" />
            ) : null}
          </div>
        </div>

        <div
          aria-atomic="true"
          aria-live="polite"
          className="mt-5 space-y-5 sm:pl-12"
          role="status"
        >
          <span className="sr-only">
            {presentation.label}. {importInProgress ? "Loading." : ""}
          </span>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {presentation.detail}
          </p>
          {latestRun && !importInProgress ? (
            <ImportCounts
              importedCount={latestRun.importedCount}
              reviewCount={latestRun.reviewCount}
              skippedExistingCount={latestRun.skippedExistingCount ?? 0}
            />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 sm:ml-12">
          {latestRun && (latestRun.labResultCount ?? 0) > 0 ? (
            <Link href="/biomarkers" className={buttonVariants({ size: "sm", variant: "outline" })}>View lab results</Link>
          ) : null}
          {!importInProgress && connection.canImport ? (
            <Link href="/records/connect?launch=clinical-records" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {connection.status === "disconnected" || connection.status === "needs_reauth" ? "Reconnect" : "Import again"}
            </Link>
          ) : null}
          {connection.importsRemaining === 0 ? <p className="text-sm text-muted-foreground">This source has reached its import limit. Saved records remain available.</p> : null}
          {connection.status !== "disconnected" ? (
          <Button
            className="text-muted-foreground hover:text-destructive"
            disabled={disabled}
            onClick={onDisconnect}
            size="sm"
            type="button"
            variant="ghost"
          >
            <UnplugIcon aria-hidden="true" />
            Disconnect
          </Button>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function ImportCounts({ importedCount, reviewCount, skippedExistingCount }: { importedCount: number; reviewCount: number; skippedExistingCount: number }) {
  return (
    <p className="text-sm text-foreground">
      {importedCount} {importedCount === 1 ? "record" : "records"} added.
      {skippedExistingCount > 0 ? ` ${skippedExistingCount} already saved.` : ""}
      {reviewCount > 0 ? ` ${reviewCount} retained as source evidence, without adding usable results.` : ""}
    </p>
  );
}

function DisconnectDialog({
  connection,
  errorMessage,
  onConfirm,
  onOpenChange,
  pending,
}: {
  connection: ClinicalRecordConnectionContract | null;
  errorMessage: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
}) {
  return (
    <Dialog open={Boolean(connection)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl">Disconnect {connection?.displayName ?? "this patient portal"}?</DialogTitle>
          <DialogDescription className="leading-6">
            This stops any import in progress and removes portal access. Records already saved in your vault stay there.
          </DialogDescription>
        </DialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-sm leading-6 text-destructive">{errorMessage}</p>
        ) : null}
        <DialogFooter className="-mx-6 -mb-6 px-6 pb-6 md:-mx-7 md:-mb-7 md:px-7 md:pb-7">
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {pending ? <Spinner /> : null}
            {pending ? "Disconnecting" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthRequiredState({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <LockKeyholeIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 font-serif text-2xl font-medium text-foreground">Sign in to view medical records</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Your patient portals and copying progress are private to your Murph account.
      </p>
      <Button className="mt-6 w-full sm:w-auto" onClick={onSignIn} size="lg" type="button">
        Log in or sign up
      </Button>
    </section>
  );
}

function LoadErrorState() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Medical records unavailable</AlertTitle>
      <AlertDescription>
        Your patient portal connections could not be loaded right now. Reload this page to try again.
      </AlertDescription>
    </Alert>
  );
}

function EmptyRecordsState() {
  return <p className="text-sm leading-6 text-muted-foreground">No records imported yet. Choose a hospital or clinic to get started.</p>;
}

function describeConnection(connection: ClinicalRecordConnectionContract): {
  badgeVariant: "default" | "destructive" | "outline" | "secondary";
  detail: string;
  label: string;
} {
  if (connection.status === "disconnected") {
    return { badgeVariant: "outline", detail: "Portal access removed. Saved records remain in your vault.", label: "Disconnected" };
  }
  if (connection.status === "needs_reauth") {
    return {
      badgeVariant: "outline",
      detail: "Portal access ended before the import finished. Saved records remain in your vault.",
      label: "Portal access ended",
    };
  }
  if (connection.status === "error") {
    return {
      badgeVariant: "destructive",
      detail: "Murph could not finish copying records. Anything already saved remains in your private vault.",
      label: "Could not add records",
    };
  }

  return describeRun(connection.latestRun);
}

function describeRun(run: ClinicalRecordConnectionContract["latestRun"]): {
  badgeVariant: "default" | "destructive" | "outline" | "secondary";
  detail: string;
  label: string;
} {
  const importedCount = run?.importedCount ?? 0;
  const status = run?.status ?? null;

  switch (status) {
    case "queued":
      return { badgeVariant: "secondary", detail: "Murph is waiting to copy records from your patient portal.", label: "Waiting to start" };
    case "retrieving":
      return { badgeVariant: "secondary", detail: "Getting records from your patient portal. You can leave this page.", label: "Getting records" };
    case "importing":
      return { badgeVariant: "secondary", detail: "Murph is saving the records into your private vault.", label: "Saving records" };
    case "complete":
      return importedCount > 0
        ? { badgeVariant: "default", detail: "Your records are saved and ready for conversations with Murph.", label: "Copy complete" }
        : { badgeVariant: "outline", detail: (run?.skippedExistingCount ?? 0) > 0 ? "These records were already saved." : "No usable results were available to add.", label: "Nothing added" };
    case "partial":
      return importedCount > 0
        ? { badgeVariant: "outline", detail: "Some records were saved. Part of this import could not be completed.", label: "Partly complete" }
        : { badgeVariant: "outline", detail: "The import could not finish and no usable results were added.", label: "Could not finish" };
    case "needs_reauth":
      return { badgeVariant: "outline", detail: "Portal access ended before the import finished. Saved records remain in your vault.", label: "Portal access ended" };
    case "failed":
      return { badgeVariant: "destructive", detail: "Murph could not finish copying records. Anything already saved remains in your private vault.", label: "Could not add records" };
    case "canceled":
      return { badgeVariant: "outline", detail: "Murph stopped copying records.", label: "Stopped" };
    default:
      return { badgeVariant: "secondary", detail: "Your patient portal is connected and Murph is getting ready to copy records.", label: "Getting ready" };
  }
}

function describeCallback(marker: ClinicalRecordCallbackMarker | null): {
  kind: "error" | "neutral";
  message: string;
  title: string;
} | null {
  switch (marker) {
    case "connected":
      return null;
    case "auth-required":
      return { kind: "error", message: "Sign in to Murph before connecting medical records.", title: "Murph sign-in required" };
    case "declined":
      return { kind: "neutral", message: "You canceled this authorization. Earlier saved records are unchanged.", title: "Connection canceled" };
    case "expired":
      return { kind: "error", message: "The patient portal connection took too long and closed before it finished. Start a new connection when you are ready.", title: "Connection expired" };
    case "failed":
      return { kind: "error", message: "This return link could not complete the connection. Check the saved import status below.", title: "Connection failed" };
    default:
      return null;
  }
}

function stripClinicalRecordsCallbackFromCurrentUrl() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("clinicalRecords")) {
      return;
    }
    url.searchParams.delete("clinicalRecords");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // The callback notice still renders if an unusual browser URL cannot be normalized.
  }
}

function isImportInProgress(connection: ClinicalRecordConnectionContract): boolean {
  if (connection.status !== "active") {
    return false;
  }

  const status = connection.latestRun?.status;
  return status === undefined
    || status === "queued"
    || status === "retrieving"
    || status === "importing";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}
