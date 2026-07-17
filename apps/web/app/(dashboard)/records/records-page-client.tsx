"use client";

import { FileTextIcon, LockKeyholeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
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
  parseClinicalRecordConnectIntentResponse,
  parseClinicalRecordDisconnectResponse,
  type ClinicalRecordCallbackMarker,
  type ClinicalRecordConnectionContract,
  type ClinicalRecordRunStatus,
} from "@/src/lib/clinical-records/client-contracts";

const CONNECT_INTENT_PATH = "/api/clinical-records/connect-intents";

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
  const [connectPending, setConnectPending] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] =
    useState<ClinicalRecordConnectionContract | null>(null);
  const [disconnectPending, setDisconnectPending] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);
  const connectInFlightRef = useRef(false);
  const disconnectInFlightRef = useRef(false);
  const disconnectNoticeRef = useRef<HTMLDivElement>(null);
  const [refreshPending, startRefreshTransition] = useTransition();
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const connections = initialConnections.filter(
    (connection) => !disconnectedConnectionIds.includes(connection.connectionId),
  );
  const hasActiveImport = connections.some(isImportInProgress);

  useLayoutEffect(() => {
    stripClinicalRecordsCallbackFromCurrentUrl();
  }, []);

  useEffect(() => {
    function restoreAfterHistoryNavigation(event: PageTransitionEvent) {
      if (!event.persisted) {
        return;
      }
      connectInFlightRef.current = false;
      setConnectPending(false);
    }

    window.addEventListener("pageshow", restoreAfterHistoryNavigation);
    return () => window.removeEventListener("pageshow", restoreAfterHistoryNavigation);
  }, []);

  async function createConnectIntent() {
    if (!authenticated) {
      openAuthDialog();
      return;
    }
    if (connectInFlightRef.current || disconnectInFlightRef.current) {
      return;
    }

    connectInFlightRef.current = true;
    setConnectPending(true);
    setConnectError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        payload: {},
        url: CONNECT_INTENT_PATH,
      });
      const intent = parseClinicalRecordConnectIntentResponse(response);
      const fragment = new URLSearchParams({
        clinicalRecordsIntent: intent.claim,
      }).toString();
      window.location.assign(`/records/connect#${fragment}`);
    } catch (error) {
      connectInFlightRef.current = false;
      setConnectError(readRequestError(
        error,
        "A private Epic connection link could not be created right now. Try again.",
      ));
      setConnectPending(false);
    }
  }

  async function disconnectConnection() {
    const target = disconnectTarget;
    if (!target || disconnectInFlightRef.current || connectInFlightRef.current) {
      return;
    }

    disconnectInFlightRef.current = true;
    setDisconnectPending(true);
    setDisconnectError(null);

    try {
      const response = await requestHostedOnboardingJson<unknown>({
        method: "POST",
        url: `/api/clinical-records/connections/${encodeURIComponent(target.connectionId)}/disconnect`,
      });
      const disconnected = parseClinicalRecordDisconnectResponse(response);
      setDisconnectedConnectionIds((current) => [
        ...current,
        disconnected.connectionId,
      ]);
      setDisconnectTarget(null);
      setDisconnectNotice(
        `${target.displayName} was disconnected. Results already imported into your vault stay there.`,
      );
      requestAnimationFrame(() => disconnectNoticeRef.current?.focus());
    } catch (error) {
      setDisconnectError(readRequestError(
        error,
        `Could not disconnect ${target.displayName}. Try again.`,
      ));
    } finally {
      disconnectInFlightRef.current = false;
      setDisconnectPending(false);
    }
  }

  const callbackNotice = disconnectNotice
    ? null
    : describeCallback(initialCallback);

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow="Medical records"
        title="Your Epic imports"
        description="Import supported Epic laboratory results and diagnostic summaries into your private vault. Each connection runs once and does not continuously sync your chart."
      >
        <div className="mt-5">
          <Button
            aria-busy={connectPending}
            className="w-full sm:w-auto"
            disabled={connectPending || disconnectPending}
            onClick={() => void createConnectIntent()}
            size="lg"
            type="button"
          >
            {connectPending ? <Spinner /> : <PlusIcon aria-hidden="true" />}
            {connectPending ? "Preparing private link" : "Connect Epic"}
          </Button>
        </div>
      </PageHeader>

      <div className="max-w-4xl space-y-5">
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
            <AlertTitle>Epic connection disconnected</AlertTitle>
            <AlertDescription>{disconnectNotice}</AlertDescription>
          </Alert>
        ) : null}

        {connectError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not prepare Epic connection</AlertTitle>
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        ) : null}

        {!authenticated ? (
          <AuthRequiredState onSignIn={openAuthDialog} />
        ) : initialLoadError ? (
          <LoadErrorState />
        ) : connections.length === 0 ? (
          <EmptyRecordsState />
        ) : (
          <section aria-labelledby="epic-connections-title" className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="epic-connections-title" className="font-serif text-xl font-medium text-foreground">
                  Epic organizations
                </h2>
                <p className="text-sm text-muted-foreground">
                  Latest state for each one-time import.
                </p>
              </div>
              {hasActiveImport ? (
                <Button
                  aria-busy={refreshPending}
                  className="w-full sm:w-auto"
                  disabled={refreshPending || connectPending || disconnectPending}
                  onClick={() => {
                    startRefreshTransition(() => router.refresh());
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCwIcon aria-hidden="true" />
                  {refreshPending ? "Refreshing" : "Refresh status"}
                </Button>
              ) : null}
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.connectionId}
                  connection={connection}
                  disabled={connectPending || disconnectPending}
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

function ConnectionRow({
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

  return (
    <li className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-primary">
            <FileTextIcon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-medium leading-6 text-foreground text-pretty">{connection.displayName}</h3>
            <p className="text-xs text-muted-foreground">
              Connected <time dateTime={connection.connectedAt}>{formatDate(connection.connectedAt)}</time>
            </p>
          </div>
        </div>

        <div
          aria-atomic="true"
          aria-live="polite"
          className="space-y-2 pl-12"
          role="status"
        >
          <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {presentation.detail}
          </p>
          {latestRun && isCountVisible(latestRun.status) ? (
            <p className="text-xs text-muted-foreground">
              {latestRun.importedCount} imported
              {latestRun.reviewCount > 0 ? ` · ${latestRun.reviewCount} held for review` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <Button
        className="w-full lg:w-auto"
        disabled={disabled}
        onClick={onDisconnect}
        type="button"
        variant="outline"
      >
        Disconnect
      </Button>
    </li>
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
          <DialogTitle className="text-xl">Disconnect {connection?.displayName ?? "Epic"}?</DialogTitle>
          <DialogDescription className="leading-6">
            Murph will clear this organization&apos;s current authorization and stop any active import. Laboratory and diagnostic results already saved in your vault stay there. Reconnecting this organization is not available in this beta.
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
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-primary">
        <LockKeyholeIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 font-serif text-2xl font-medium text-foreground">Sign in to view medical records</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Epic connections and import status are private to your Murph account.
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
        Your Epic connections could not be loaded right now. Reload this page to try again.
      </AlertDescription>
    </Alert>
  );
}

function EmptyRecordsState() {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-primary">
        <FileTextIcon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-5 font-serif text-2xl font-medium text-foreground">No active Epic connections</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Use Connect Epic above to import supported laboratory results and diagnostic summaries from the organization whose patient portal you use. Results from past imports stay in your vault after a connection is disconnected.
      </p>
    </section>
  );
}

function describeConnection(connection: ClinicalRecordConnectionContract): {
  badgeVariant: "default" | "destructive" | "outline" | "secondary";
  detail: string;
  label: string;
} {
  if (connection.status === "needs_reauth") {
    return {
      badgeVariant: "outline",
      detail: "Epic authorization ended before the one-time import finished. Reauthorization is not available in this beta.",
      label: "Authorization ended",
    };
  }
  if (connection.status === "error") {
    return {
      badgeVariant: "destructive",
      detail: "The one-time import could not finish. Any results already saved remain in your private vault.",
      label: "Import failed",
    };
  }

  return describeRun(connection.latestRun?.status ?? null);
}

function describeRun(status: ClinicalRecordRunStatus | null): {
  badgeVariant: "default" | "destructive" | "outline" | "secondary";
  detail: string;
  label: string;
} {
  switch (status) {
    case "queued":
      return { badgeVariant: "secondary", detail: "Your one-time import is waiting to begin.", label: "Import queued" };
    case "retrieving":
      return { badgeVariant: "secondary", detail: "Murph is retrieving supported laboratory results and diagnostic summaries from Epic.", label: "Retrieving results" };
    case "importing":
      return { badgeVariant: "secondary", detail: "Murph is saving supported results into your private vault.", label: "Saving to vault" };
    case "complete":
      return { badgeVariant: "default", detail: "The one-time import of supported results finished.", label: "Import complete" };
    case "partial":
      return { badgeVariant: "outline", detail: "Some supported results were imported, while other results could not be completed or need review.", label: "Partially imported" };
    case "needs_reauth":
      return { badgeVariant: "outline", detail: "Epic authorization ended before the one-time import finished. Reauthorization is not available in this beta.", label: "Authorization ended" };
    case "failed":
      return { badgeVariant: "destructive", detail: "The one-time import could not finish. Any results already saved remain in your private vault.", label: "Import failed" };
    case "canceled":
      return { badgeVariant: "outline", detail: "The one-time import was stopped.", label: "Import stopped" };
    default:
      return { badgeVariant: "secondary", detail: "Epic is connected and Murph is preparing the one-time import.", label: "Preparing import" };
  }
}

function describeCallback(marker: ClinicalRecordCallbackMarker | null): {
  kind: "error" | "neutral" | "success";
  message: string;
  title: string;
} | null {
  switch (marker) {
    case "connected":
      return { kind: "success", message: "Epic authorization finished and the one-time import has started.", title: "Epic connected" };
    case "auth-required":
      return { kind: "error", message: "Sign in to Murph before starting a new Epic connection.", title: "Murph sign-in required" };
    case "declined":
      return { kind: "neutral", message: "Epic was not connected and no import started.", title: "Epic access not granted" };
    case "expired":
      return { kind: "error", message: "The Epic authorization session expired before it finished. Start a new connection when you are ready.", title: "Epic session expired" };
    case "failed":
      return { kind: "error", message: "Murph could not finish the Epic connection. No new import started.", title: "Epic connection failed" };
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

function isCountVisible(status: ClinicalRecordRunStatus): boolean {
  return status === "complete" || status === "partial" || status === "failed";
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

function readRequestError(error: unknown, fallback: string): string {
  return error instanceof HostedOnboardingApiError && error.message
    ? error.message
    : fallback;
}
