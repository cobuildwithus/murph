"use client";

import { useMemo, useState } from "react";
import { DownloadIcon, Trash2Icon } from "lucide-react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  loadBrowserVaultReplica,
  normalizeBrowserVaultError,
} from "@/src/lib/browser-vault/loader";
import { HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "@/src/lib/hosted-privacy/account-data-shared";

import { ConnectedAccountCard } from "./connected-account-card";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

interface HostedAccountDeleteResponse {
  ok: true;
  result: {
    cloudflare: {
      alarmCleared: boolean | null;
      configured: boolean;
      deleted: boolean;
      errorCode: string | null;
      r2DeletedObjectCount: number | null;
      r2SkippedUserScopedPrefixes: boolean | null;
      r2Supported: boolean | null;
      r2UserScopedSkipReason: string | null;
      runnerStateDeleted: boolean | null;
    };
    deletedAt: string;
    deletedCounts: Record<string, number>;
    providerRevocations: Array<{
      connectionId: string;
      errorCode: string | null;
      providerLabel: string;
      status: string;
      warningCode: string | null;
    }>;
    retentionNotes: readonly string[];
  };
}

type DeletionDialogStep = "review" | "confirm";
type CloudflareCleanupSummary = HostedAccountDeleteResponse["result"]["cloudflare"];
type ProviderRevocationSummary = HostedAccountDeleteResponse["result"]["providerRevocations"][number];

const DEFAULT_VAULT_EXPORT_FILENAME = "murph-vault-export.json";
const VAULT_EXPORT_MIME_TYPE = "application/json; charset=utf-8";

export function HostedDataPrivacySettings(props: { authenticated: boolean }) {
  const [exportPending, setExportPending] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [acknowledgedSensitiveDownload, setAcknowledgedSensitiveDownload] = useState(false);
  const [exportDialogError, setExportDialogError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<DeletionDialogStep>("review");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [acknowledgedIrreversibleDeletion, setAcknowledgedIrreversibleDeletion] = useState(false);
  const [acknowledgedProviderAndBackupLimits, setAcknowledgedProviderAndBackupLimits] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletionSummary, setDeletionSummary] = useState<HostedAccountDeleteResponse["result"] | null>(null);

  const exportReady = acknowledgedSensitiveDownload && !exportPending;
  const phraseMatches = confirmationPhrase === HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
  const deleteReady = dialogStep === "confirm"
    && phraseMatches
    && acknowledgedIrreversibleDeletion
    && acknowledgedProviderAndBackupLimits
    && !deletePending;
  const deletedStoreCount = useMemo(
    () => deletionSummary
      ? Object.values(deletionSummary.deletedCounts).reduce((total, count) => total + count, 0)
      : 0,
    [deletionSummary],
  );

  async function handleExportConfirmed() {
    if (!exportReady) {
      return;
    }

    setExportPending(true);
    setExportDialogError(null);
    setSuccess(null);

    try {
      const result = await loadBrowserVaultReplica({
        emptyOnUnauthorized: false,
        endpoint: "/api/settings/vault-export/session",
        knownReplicaRef: null,
      });

      if (result.state !== "ready") {
        throw new Error("Your vault is not ready to export yet.");
      }

      const blob = new Blob([JSON.stringify(result.client.replica, null, 2)], {
        type: VAULT_EXPORT_MIME_TYPE,
      });
      triggerJsonDownload(
        blob,
        buildVaultExportFilename(result.client.replica.generatedAt),
      );

      closeExportDialog();
      setSuccess("Your vault export downloaded. Keep the file somewhere private and secure.");
    } catch (requestError) {
      setExportDialogError(formatVaultExportError(requestError));
    } finally {
      setExportPending(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteReady) {
      return;
    }

    setDeletePending(true);
    setDialogError(null);
    setSuccess(null);

    try {
      const response = await requestHostedOnboardingJson<HostedAccountDeleteResponse>({
        method: "POST",
        payload: {
          acknowledgedIrreversibleDeletion: true,
          acknowledgedProviderAndBackupLimits: true,
          confirmationPhrase,
          secondConfirmationAccepted: dialogStep === "confirm",
        },
        url: "/api/settings/privacy/delete",
      });
      setDeletionSummary(response.result);
      setSuccess("Your live Murph account data deletion completed. Provider, vendor, and backup retention limits are shown below.");
      closeDialog();
    } catch (requestError) {
      setDialogError(requestError instanceof HostedOnboardingApiError
        ? requestError.message
        : "Could not delete your data right now.");
    } finally {
      setDeletePending(false);
    }
  }

  function openExportDialog() {
    setAcknowledgedSensitiveDownload(false);
    setExportDialogError(null);
    setSuccess(null);
    setExportDialogOpen(true);
  }

  function closeExportDialog() {
    if (exportPending) {
      return;
    }

    setExportDialogOpen(false);
    setAcknowledgedSensitiveDownload(false);
    setExportDialogError(null);
  }

  function openDialog() {
    setDialogStep("review");
    setConfirmationPhrase("");
    setAcknowledgedIrreversibleDeletion(false);
    setAcknowledgedProviderAndBackupLimits(false);
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (deletePending) {
      return;
    }

    setDialogOpen(false);
    setDialogStep("review");
    setConfirmationPhrase("");
    setAcknowledgedIrreversibleDeletion(false);
    setAcknowledgedProviderAndBackupLimits(false);
    setDialogError(null);
  }

  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to export or delete your Murph data."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Alert role="status" aria-live="polite">
          <AlertTitle>Data privacy workflow updated</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <ConnectedAccountCard
        label="Export vault"
        value="Download your browser vault"
        meta="Private records, metrics, timelines, search rows, and summaries as JSON."
        action={
          <Button disabled={exportPending || deletePending || deletionSummary !== null} onClick={openExportDialog} size="lg" type="button" variant="outline">
            <DownloadIcon data-icon="inline-start" />
            {deletionSummary ? "Export unavailable" : exportPending ? "Exporting..." : "Export vault"}
          </Button>
        }
      />

      <ConnectedAccountCard
        className="border-destructive/30 bg-destructive/5"
        label="Delete data"
        value="Delete your Murph account data"
        meta="Permanently deletes your Murph data. Requires two confirmations."
        action={
          <Button disabled={deletePending || deletionSummary !== null} onClick={openDialog} size="lg" type="button" variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            {deletionSummary ? "Deleted" : "Delete data"}
          </Button>
        }
      />

      {deletionSummary ? (
        <Alert role="status" aria-live="polite">
          <AlertTitle>Deletion summary</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>Deleted {deletedStoreCount} live database rows at {formatDeletionTimestamp(deletionSummary.deletedAt)}.</p>
            <p>
              Cloudflare cleanup: {formatCloudflareCleanupResult(deletionSummary.cloudflare)}.
            </p>
            {deletionSummary.providerRevocations.length > 0 ? (
              <>
                <p>Provider revocation results:</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {deletionSummary.providerRevocations.map((revocation) => (
                    <li key={revocation.connectionId}>
                      {revocation.providerLabel}: {formatProviderRevocationResult(revocation)}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {deletionSummary.retentionNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={exportDialogOpen} onOpenChange={(open) => (open ? setExportDialogOpen(true) : closeExportDialog())}>
        <DialogContent
          aria-busy={exportPending}
          className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton={!exportPending}
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              Export your vault
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              Downloads your account, messaging, wearable, and usage records as JSON.
            </DialogDescription>
          </DialogHeader>
          {exportDialogError ? (
            <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {exportDialogError}
            </p>
          ) : null}
          <div className="flex items-start gap-4 text-sm leading-relaxed text-foreground">
            <Checkbox
              id="hosted-data-export-acknowledge"
              checked={acknowledgedSensitiveDownload}
              onCheckedChange={setAcknowledgedSensitiveDownload}
              className="size-7 shrink-0"
            />
            <label htmlFor="hosted-data-export-acknowledge" className="cursor-pointer">
              This export may contain sensitive health data and private notes.
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button" size="xl" onClick={() => void handleExportConfirmed()} disabled={!exportReady} className="w-full">
              <DownloadIcon data-icon="inline-start" />
              {exportPending ? "Preparing..." : "Download vault JSON"}
            </Button>
            <Button type="button" size="xl" variant="ghost" onClick={closeExportDialog} disabled={exportPending} className="w-full">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent
          aria-busy={deletePending}
          className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton={!deletePending}
        >
          {dialogStep === "review" ? (
            <>
              <DialogHeader className="pr-10">
                <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
                  Delete your data
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-muted-foreground">
                  This permanently deletes your Murph account data, wearable connections, and message history. Provider and backup retention may still apply.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Button type="button" size="xl" variant="destructive" onClick={() => {
                  setDialogError(null);
                  setDialogStep("confirm");
                }} disabled={deletePending} className="w-full">
                  I understand, continue
                </Button>
                <Button type="button" size="xl" variant="ghost" onClick={closeDialog} disabled={deletePending} className="w-full">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="pr-10">
                <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
                  Confirm deletion
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-muted-foreground">
                  Type the phrase and check both boxes to proceed.
                </DialogDescription>
              </DialogHeader>
              {dialogError ? (
                <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                  {dialogError}
                </p>
              ) : null}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="hosted-account-delete-phrase">Type <span className="font-mono">{HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}</span> to confirm</Label>
                  <Input
                    autoComplete="off"
                    className="h-12 text-base"
                    id="hosted-account-delete-phrase"
                    inputMode="text"
                    value={confirmationPhrase}
                    onChange={(event) => setConfirmationPhrase(event.target.value)}
                    aria-invalid={confirmationPhrase.length > 0 && !phraseMatches}
                    placeholder={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                  />
                </div>
                <div className="flex items-start gap-4 text-sm leading-relaxed text-foreground">
                  <Checkbox
                    id="hosted-data-delete-irreversible"
                    checked={acknowledgedIrreversibleDeletion}
                    onCheckedChange={setAcknowledgedIrreversibleDeletion}
                    className="size-7 shrink-0"
                  />
                  <label htmlFor="hosted-data-delete-irreversible" className="cursor-pointer">
                    This deletion is irreversible.
                  </label>
                </div>
                <div className="flex items-start gap-4 text-sm leading-relaxed text-foreground">
                  <Checkbox
                    id="hosted-data-delete-retention"
                    checked={acknowledgedProviderAndBackupLimits}
                    onCheckedChange={setAcknowledgedProviderAndBackupLimits}
                    className="size-7 shrink-0"
                  />
                  <label htmlFor="hosted-data-delete-retention" className="cursor-pointer">
                    Provider records (Stripe, Privy) and backups follow separate retention.
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" size="xl" variant="destructive" onClick={() => void handleDeleteConfirmed()} disabled={!deleteReady} className="w-full">
                  {deletePending ? "Deleting..." : "Delete my data"}
                </Button>
                <Button type="button" size="xl" variant="ghost" onClick={() => {
                  setDialogError(null);
                  setDialogStep("review");
                }} disabled={deletePending} className="w-full">
                  Back
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDeletionTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildVaultExportFilename(generatedAt: string): string {
  const safeTimestamp = sanitizeFilenameSegment(generatedAt);
  return safeTimestamp
    ? `murph-vault-export-${safeTimestamp}.json`
    : DEFAULT_VAULT_EXPORT_FILENAME;
}

function formatVaultExportError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not export your vault right now.";
  }

  if (error.message === "Your vault is not ready to export yet.") {
    return error.message;
  }

  if (/HTTP 401/u.test(error.message)) {
    return "Your session expired. Refresh and try again.";
  }

  if (/HTTP 403/u.test(error.message) && /consent/iu.test(error.message)) {
    return "Accept the current Murph legal consent before exporting your vault.";
  }

  if (/HTTP 403/u.test(error.message)) {
    return "Your session is not allowed to export your vault right now.";
  }

  const normalizedMessage = normalizeBrowserVaultError(error);
  return normalizedMessage === "Your dashboard data is not available right now."
    ? "Your vault export is not available right now. Try again after your dashboard finishes syncing."
    : normalizedMessage;
}

function triggerJsonDownload(blob: Blob, filename: string): void {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function sanitizeFilenameSegment(value: string): string {
  return value.trim().replace(/[^0-9A-Za-z-]/gu, "-").replace(/-+/gu, "-");
}

function formatCloudflareCleanupResult(result: CloudflareCleanupSummary): string {
  if (!result.configured) {
    return "not configured in this environment";
  }

  if (result.errorCode) {
    return `attempted with ${result.errorCode}`;
  }

  const r2Count = result.r2DeletedObjectCount ?? 0;
  if (result.deleted) {
    return `completed (${r2Count} R2 object${r2Count === 1 ? "" : "s"} deleted)`;
  }

  const details = [
    result.runnerStateDeleted === false ? "runner state not found or not deleted" : null,
    result.alarmCleared === false ? "runner alarm not cleared" : null,
    result.r2Supported === false ? "R2 listing/deletion unsupported" : null,
    result.r2SkippedUserScopedPrefixes ? `user-scoped R2 prefixes skipped${result.r2UserScopedSkipReason ? ` (${result.r2UserScopedSkipReason})` : ""}` : null,
  ].filter((detail): detail is string => detail !== null);

  return details.length > 0
    ? `partially completed (${details.join("; ")})`
    : "attempted; detailed cleanup status was unavailable";
}

function formatProviderRevocationResult(result: ProviderRevocationSummary): string {
  const detail = result.errorCode ?? result.warningCode;
  const suffix = detail ? ` (${detail})` : "";

  switch (result.status) {
    case "revoked":
      return `revoked${suffix}`;
    case "not_needed":
      return `no revocation hook required${suffix}`;
    case "warning":
      return `needs follow-up${suffix}`;
    case "failed":
      return `failed${suffix}`;
    case "skipped_not_configured":
      return `skipped because provider control is not configured${suffix}`;
    default:
      return `${result.status}${suffix}`;
  }
}
