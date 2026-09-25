"use client";

import {
  ChevronDownIcon,
  LockKeyholeIcon,
  PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
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
    <div className="flex w-full min-w-0 max-w-3xl flex-col gap-8 sm:gap-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Medical records"
          description={connections.length === 0 ? "Bring records from your patient portal into Murph." : undefined}
        />
        {authenticated ? (
          <Link
            aria-label="Import records"
            title="Import records"
            className={buttonVariants({ size: connections.length > 0 ? "icon-lg" : "lg", variant: connections.length > 0 ? "ghost" : "default" })}
            href="/records/connect?launch=clinical-records"
          >
            <PlusIcon aria-hidden="true" />
            {connections.length === 0 ? "Import records" : null}
          </Link>
        ) : null}
      </header>

      <div className="flex flex-col gap-6">
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
          <section aria-labelledby="patient-portals-title">
            <h2 id="patient-portals-title" className="sr-only">Your providers</h2>
            <ul className="divide-y divide-border border-y border-border">
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

      {authenticated ? <RecordsPrivacyControls /> : null}
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

export function RecordsPrivacyControls() {
  return (
    <footer className="text-sm text-muted-foreground">
      <Link href="/settings#data-privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">Data &amp; privacy</Link>
    </footer>
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
    <li className="py-7">
      <article className="relative">
        <h3 className="pr-24 font-serif text-2xl font-medium leading-tight tracking-tight text-foreground text-pretty">
          {connection.displayName}
        </h3>
        <div aria-atomic="true" aria-live="polite" className="mt-2 text-sm leading-6 text-muted-foreground" role="status">
          <p>
            {latestRun && !importInProgress ? <>{latestRun.importedCount.toLocaleString()} {latestRun.importedCount === 1 ? "record" : "records"} added. </> : null}
            {importInProgress ? <Spinner aria-hidden="true" role="presentation" className="mr-2 inline size-3.5" /> : null}
            <span className={presentation.badgeVariant === "destructive" ? "text-destructive" : presentation.badgeVariant === "default" ? "sr-only" : undefined}>{presentation.label}</span>
            {importInProgress ? <span className="sr-only">. Loading.</span> : null}
          </p>
          {importInProgress ? <p>{presentation.detail}</p> : null}
        </div>

        {latestRun && (latestRun.labResultCount ?? 0) > 0 ? (
          <Link href="/biomarkers" className={buttonVariants({ size: "lg", className: "mt-5" })}>View lab results</Link>
        ) : <ImportAgainLink connection={connection} primary />}

        <ConnectionDetails connection={connection} disabled={disabled} onDisconnect={onDisconnect} />
      </article>
    </li>
  );
}

function ConnectionDetails({ connection, disabled, onDisconnect }: {
  connection: ClinicalRecordConnectionContract;
  disabled: boolean;
  onDisconnect: () => void;
}) {
  const latestRun = connection.latestRun;
  const importInProgress = isImportInProgress(connection);
  const skippedExistingCount = latestRun?.skippedExistingCount ?? 0;
  return (
    <details className="group text-sm">
      <summary className="absolute -top-2 right-0 flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Manage
        <ChevronDownIcon aria-hidden="true" className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-6 flex max-w-xl flex-col gap-3 border-t border-border pt-5 leading-6 text-muted-foreground">
        {!importInProgress ? <p>{describeConnection(connection).detail}</p> : null}
        {latestRun && !importInProgress ? (
          <>
            {skippedExistingCount > 0 ? <p>{skippedExistingCount.toLocaleString()} already in Murph.</p> : null}
            {latestRun.reviewCount > 0 ? <p>{latestRun.reviewCount.toLocaleString()} {latestRun.reviewCount === 1 ? "item" : "items"} saved for reference. These are kept in your vault but aren’t shown as results.</p> : null}
          </>
        ) : null}
        <p>Connected <time dateTime={connection.connectedAt}>{formatDate(connection.connectedAt)}</time>.</p>
        {connection.status !== "disconnected" ? <p>
          {connection.nextSyncAt ? <>Daily updates on. Next check around <time dateTime={connection.nextSyncAt}>{formatDate(connection.nextSyncAt)}</time>.</> : connection.status === "needs_reauth" ? "Daily updates stopped. Reconnect to continue." : "One-time import."}
          {connection.lastCheckedAt ? <> Last checked <time dateTime={connection.lastCheckedAt}>{formatDate(connection.lastCheckedAt)}</time>.</> : null}
        </p> : null}
        {(latestRun?.labResultCount ?? 0) > 0 ? <ImportAgainLink connection={connection} /> : null}
        {connection.importsRemaining === 0 ? <p>This source has reached its import limit. Saved records remain available.</p> : null}
        <p>Disconnect stops future imports. Records already saved in Murph stay there.</p>
        <Link href="/privacy" className="w-fit underline underline-offset-4">How Murph uses your data</Link>
        {connection.status !== "disconnected" ? (
          <Button className="w-fit" disabled={disabled} onClick={onDisconnect} size="sm" type="button" variant="outline">
            Disconnect
          </Button>
        ) : null}
      </div>
    </details>
  );
}

function ImportAgainLink({ connection, primary = false }: {
  connection: ClinicalRecordConnectionContract;
  primary?: boolean;
}) {
  if (isImportInProgress(connection) || !connection.canImport) return null;
  return (
    <Link
      href="/records/connect?launch=clinical-records"
      className={buttonVariants({ size: "lg", variant: primary ? "default" : "link", className: primary ? "mt-5" : "w-fit" })}
    >
      {connection.status === "disconnected" || connection.status === "needs_reauth" ? "Reconnect" : "Import again"}
    </Link>
  );
}

export function DisconnectDialog({
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
            size="xl"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            size="xl"
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
      detail: "The import stopped. Any records already saved are still available.",
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
        ? { badgeVariant: "default", detail: "Your records are saved and ready for conversations with Murph.", label: "Imported" }
        : { badgeVariant: "outline", detail: (run?.skippedExistingCount ?? 0) > 0 ? "These records were already saved." : "No new results were available to add.", label: "Nothing added" };
    case "partial":
      return importedCount > 0
        ? { badgeVariant: "outline", detail: "Your saved records are ready. Some records couldn’t be imported.", label: "Import incomplete" }
        : { badgeVariant: "outline", detail: "The import stopped before any new results were added.", label: "Could not finish" };
    case "needs_reauth":
      return { badgeVariant: "outline", detail: "Portal access ended before the import finished. Saved records remain in your vault.", label: "Portal access ended" };
    case "failed":
      return { badgeVariant: "destructive", detail: "The import stopped. Any records already saved are still available.", label: "Could not add records" };
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
