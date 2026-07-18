"use client";

import {
  DatabaseIcon,
  FileTextIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlusIcon,
  RefreshCwIcon,
  UnplugIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
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
    } catch {
      connectInFlightRef.current = false;
      setConnectError("Murph could not get the records connection ready. Try again.");
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
        `${target.displayName} was disconnected. Results already copied into Murph stay there.`,
      );
      requestAnimationFrame(() => disconnectNoticeRef.current?.focus());
    } catch {
      setDisconnectError(`Could not disconnect ${target.displayName}. Try again.`);
    } finally {
      disconnectInFlightRef.current = false;
      setDisconnectPending(false);
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
        description="Bring lab results and report summaries into Murph, so they can inform future conversations without becoming another portal to manage."
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
            {connectPending ? "Getting things ready" : "Connect records"}
          </Button>
        </div>
      </PageHeader>

      <RecordsBoundaryBand />

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

        {connectError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not start records connection</AlertTitle>
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
          <section aria-labelledby="patient-portals-title" className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                  Copy status
                </p>
                <h2 id="patient-portals-title" className="font-serif text-2xl font-medium tracking-tight text-foreground">
                  Patient portals
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {hasActiveImport
                    ? "This page updates on its own while Murph is copying records."
                    : "Check the latest copy status for each patient portal."}
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
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
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

function RecordsBoundaryBand() {
  const facts = [
    {
      description: "Lab results and report summaries available through your portal.",
      icon: DatabaseIcon,
      label: "What comes in",
    },
    {
      description: "Your patient portal password stays on the portal's website.",
      icon: KeyRoundIcon,
      label: "What stays out",
    },
    {
      description: "Murph copies records once. It does not keep checking your chart.",
      icon: RefreshCwIcon,
      label: "How it runs",
    },
  ] as const;

  return (
    <section
      aria-label="How copying records works"
      className="grid max-w-5xl divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {facts.map(({ description, icon: Icon, label }) => (
        <div
          key={label}
          className="flex gap-3 py-4 sm:px-6 sm:py-5 sm:first:pl-0 sm:last:pr-0"
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-foreground">
              {label}
            </p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
      ))}
    </section>
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
          {importInProgress ? (
            <ImportProgress status={latestRun?.status ?? null} />
          ) : null}
          {latestRun && isCountVisible(latestRun.status) ? (
            <ImportCounts
              importedCount={latestRun.importedCount}
              reviewCount={latestRun.reviewCount}
            />
          ) : null}
        </div>

        <div className="mt-5 flex justify-end border-t border-border pt-3 sm:ml-12">
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
        </div>
      </article>
    </li>
  );
}

function ImportProgress({ status }: { status: ClinicalRecordRunStatus | null }) {
  const currentStep = status === "importing" ? 2 : status === "retrieving" ? 1 : 0;
  const steps = ["Connected", "Copying", "Saving"] as const;

  return (
    <div aria-label="Records copy progress">
      <div aria-hidden="true" className="grid grid-cols-3 gap-1.5">
        {steps.map((step, index) => (
          <span
            key={step}
            className={index <= currentStep ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-muted"}
          />
        ))}
      </div>
      <ol className="mt-2 grid grid-cols-3 gap-2">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === currentStep ? "step" : undefined}
            className={index <= currentStep
              ? "font-mono text-[10px] uppercase tracking-[0.1em] text-foreground"
              : "font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"}
          >
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ImportCounts({
  importedCount,
  reviewCount,
}: {
  importedCount: number;
  reviewCount: number;
}) {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-border pt-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
          Added
        </p>
        <p className="mt-1 font-serif text-2xl font-semibold leading-none text-foreground tabular-nums">
          {importedCount}
        </p>
      </div>
      {reviewCount > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
            Held for review
          </p>
          <p className="mt-1 font-serif text-2xl font-semibold leading-none text-foreground tabular-nums">
            {reviewCount}
          </p>
        </div>
      ) : null}
    </div>
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
            Murph will stop using this patient portal and end any records copy still running. Lab results and report summaries already saved in your vault stay there. Connecting this portal again is not available in this beta.
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
  return (
    <section className="grid gap-5 border-y border-border py-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-6 sm:py-10">
      <FileTextIcon aria-hidden="true" className="size-8 text-primary" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
          No patient portals connected
        </p>
        <h2 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground">
          Your records can meet you here
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Connect a supported patient portal. Murph copies available lab results and report summaries once, and anything already saved stays in your vault after you disconnect.
        </p>
      </div>
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
      detail: "Access from your patient portal ended before Murph finished copying records. Connecting it again is not available in this beta.",
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
      return { badgeVariant: "secondary", detail: "Murph is getting lab results and report summaries from your patient portal.", label: "Getting records" };
    case "importing":
      return { badgeVariant: "secondary", detail: "Murph is saving the records into your private vault.", label: "Saving records" };
    case "complete":
      return importedCount > 0
        ? { badgeVariant: "default", detail: "Murph finished this copy. The totals below show how many lab results and report summaries were added and whether anything needs review.", label: "Copy complete" }
        : { badgeVariant: "outline", detail: "Murph finished this copy, but nothing was added. The totals below show whether anything needs review.", label: "Nothing added" };
    case "partial":
      return importedCount > 0
        ? { badgeVariant: "outline", detail: "Murph added some lab results or report summaries, but part of the copy could not finish. The totals below show whether anything needs review.", label: "Partly complete" }
        : { badgeVariant: "outline", detail: "Part of the copy could not finish, and nothing was added. The totals below show whether anything needs review.", label: "Could not finish" };
    case "needs_reauth":
      return { badgeVariant: "outline", detail: "Access from your patient portal ended before Murph finished copying records. Connecting it again is not available in this beta.", label: "Portal access ended" };
    case "failed":
      return { badgeVariant: "destructive", detail: "Murph could not finish copying records. Anything already saved remains in your private vault.", label: "Could not add records" };
    case "canceled":
      return { badgeVariant: "outline", detail: "Murph stopped copying records.", label: "Stopped" };
    default:
      return { badgeVariant: "secondary", detail: "Your patient portal is connected and Murph is getting ready to copy records.", label: "Getting ready" };
  }
}

function describeCallback(marker: ClinicalRecordCallbackMarker | null): {
  kind: "error" | "neutral" | "success";
  message: string;
  title: string;
} | null {
  switch (marker) {
    case "connected":
      return { kind: "success", message: "Your patient portal is connected and Murph has started copying records.", title: "Records connected" };
    case "auth-required":
      return { kind: "error", message: "Sign in to Murph before connecting medical records.", title: "Murph sign-in required" };
    case "declined":
      return { kind: "neutral", message: "The patient portal was not connected and no records were copied.", title: "Connection canceled" };
    case "expired":
      return { kind: "error", message: "The patient portal connection took too long and closed before it finished. Start a new connection when you are ready.", title: "Connection expired" };
    case "failed":
      return { kind: "error", message: "Murph could not finish connecting your patient portal. No records were copied.", title: "Connection failed" };
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
