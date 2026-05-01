"use client";

import { useMemo, useState } from "react";
import { ArrowRightIcon, DownloadIcon, Trash2Icon, Undo2Icon } from "lucide-react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  HOSTED_DATA_EXPORT_CONFIRMATION_TEXT,
} from "@/src/lib/hosted-privacy/account-data-shared";

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
      provider: string;
      status: string;
      warningCode: string | null;
    }>;
    retentionNotes: readonly string[];
  };
}

type DeletionDialogStep = "review" | "confirm";
type CloudflareCleanupSummary = HostedAccountDeleteResponse["result"]["cloudflare"];
type ProviderRevocationSummary = HostedAccountDeleteResponse["result"]["providerRevocations"][number];

const DATA_EXPORT_ENDPOINT = "/api/settings/data-export";
const DEFAULT_EXPORT_FILENAME = "murph-data-export.json";
const DATA_EXPORT_CONFIRMATION_HELP_ID = "hosted-data-export-phrase-help";
const ACCOUNT_DELETION_CONFIRMATION_HELP_ID = "hosted-account-delete-phrase-help";

export function HostedDataPrivacySettings(props: { authenticated: boolean }) {
  const [exportPending, setExportPending] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportConfirmationText, setExportConfirmationText] = useState("");
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

  const exportPhraseMatches = exportConfirmationText === HOSTED_DATA_EXPORT_CONFIRMATION_TEXT;
  const exportReady = acknowledgedSensitiveDownload && exportPhraseMatches && !exportPending;
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
      const response = await fetch(DATA_EXPORT_ENDPOINT, {
        body: JSON.stringify({
          acknowledgedSensitiveDownload,
          confirmationText: exportConfirmationText,
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readDataExportErrorMessage(response));
      }

      const blob = await response.blob();
      triggerDataExportDownload(
        blob,
        readDataExportFilename(response.headers.get("content-disposition")),
      );

      closeExportDialog();
      setSuccess("Your data export downloaded. Keep the file somewhere private and secure.");
    } catch (requestError) {
      setExportDialogError(requestError instanceof Error
        ? requestError.message
        : "Could not export your data right now.");
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
    setExportConfirmationText("");
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
    setExportConfirmationText("");
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
        label="Export data"
        value="Download your Murph data"
        meta="Exports account, messaging, wearable, usage, and redacted diagnostic records. Tokens, lookup keys, nonces, and invite codes are not included."
        action={
          <Button disabled={exportPending || deletePending || deletionSummary !== null} onClick={openExportDialog} type="button" variant="outline">
            <DownloadIcon data-icon="inline-start" />
            {deletionSummary ? "Export unavailable" : exportPending ? "Exporting..." : "Export data"}
          </Button>
        }
      />

      <ConnectedAccountCard
        className="border-destructive/30 bg-destructive/5"
        label="Delete data"
        value="Delete your Murph account data"
        meta="Deletes live Murph-hosted data, revokes wearable providers where possible, and triggers Cloudflare runner/R2 cleanup when configured. Requires two confirmations."
        action={
          <Button disabled={deletePending || deletionSummary !== null} onClick={openDialog} type="button" variant="destructive">
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
                      {formatProviderName(revocation.provider)}: {formatProviderRevocationResult(revocation)}
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
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!exportPending}
        >
          <DialogHeader>
            <DialogTitle>Confirm data export</DialogTitle>
            <DialogDescription>
              This download can contain decrypted account details and account metadata. Murph will omit mailbox payload
              bodies, tokens, lookup keys, nonces, invite codes, and API key environment names.
            </DialogDescription>
          </DialogHeader>
          {exportDialogError ? (
            <Alert variant="destructive">
              <AlertTitle>Export request failed</AlertTitle>
              <AlertDescription>{exportDialogError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-4">
            <label className="flex gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <input
                checked={acknowledgedSensitiveDownload}
                className="mt-0.5 size-4 shrink-0 accent-current"
                type="checkbox"
                onChange={(event) => setAcknowledgedSensitiveDownload(event.target.checked)}
              />
              <span>I understand this export may contain sensitive account, message, wearable, and usage data.</span>
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hosted-data-export-phrase">Confirmation phrase</Label>
              <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {HOSTED_DATA_EXPORT_CONFIRMATION_TEXT}
              </code>
              <Input
                autoComplete="off"
                id="hosted-data-export-phrase"
                inputMode="text"
                value={exportConfirmationText}
                onChange={(event) => setExportConfirmationText(event.target.value)}
                aria-invalid={exportConfirmationText.length > 0 && !exportPhraseMatches}
                aria-describedby={DATA_EXPORT_CONFIRMATION_HELP_ID}
                placeholder={HOSTED_DATA_EXPORT_CONFIRMATION_TEXT}
              />
              <p
                className={exportConfirmationText.length > 0 && !exportPhraseMatches
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"}
                id={DATA_EXPORT_CONFIRMATION_HELP_ID}
              >
                Type {HOSTED_DATA_EXPORT_CONFIRMATION_TEXT} exactly, with no extra spaces.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeExportDialog} disabled={exportPending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleExportConfirmed()} disabled={!exportReady}>
              <DownloadIcon data-icon="inline-start" />
              {exportPending ? "Preparing..." : "Download JSON"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent
          aria-busy={deletePending}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!deletePending}
        >
          {dialogStep === "review" ? (
            <>
              <DialogHeader>
                <DialogTitle>Review deletion first</DialogTitle>
                <DialogDescription>
                  This is the first confirmation. Murph will delete live account rows, mailbox payloads,
                  device tokens/audits, runtime logs, and workspace state. Provider and backup retention may still apply.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">High-value pieces included in this deletion</p>
                <p className="mt-1">
                  Prisma records, hosted mailbox/payloads, wearable connections/tokens/audit rows,
                  runtime logs, Linq/Telegram/email routing, and best-effort Cloudflare runner/R2 cleanup.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog} disabled={deletePending}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={() => {
                  setDialogError(null);
                  setDialogStep("confirm");
                }} disabled={deletePending}>
                  <ArrowRightIcon data-icon="inline-start" />
                  I understand, continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Second confirmation required</DialogTitle>
                <DialogDescription>
                  Type the exact phrase and check both boxes before deleting your live Murph data.
                </DialogDescription>
              </DialogHeader>
              {dialogError ? (
                <Alert variant="destructive">
                  <AlertTitle>Deletion request failed</AlertTitle>
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="hosted-account-delete-phrase">Confirmation phrase</Label>
                  <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                    {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                  </code>
                  <Input
                    autoComplete="off"
                    id="hosted-account-delete-phrase"
                    inputMode="text"
                    value={confirmationPhrase}
                    onChange={(event) => setConfirmationPhrase(event.target.value)}
                    aria-invalid={confirmationPhrase.length > 0 && !phraseMatches}
                    aria-describedby={ACCOUNT_DELETION_CONFIRMATION_HELP_ID}
                    placeholder={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                  />
                  <p
                    className={confirmationPhrase.length > 0 && !phraseMatches
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"}
                    id={ACCOUNT_DELETION_CONFIRMATION_HELP_ID}
                  >
                    Type {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE} exactly, with no extra spaces.
                  </p>
                </div>
                <label className="flex gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <input
                    checked={acknowledgedIrreversibleDeletion}
                    className="mt-0.5 size-4 shrink-0 accent-current"
                    type="checkbox"
                    onChange={(event) => setAcknowledgedIrreversibleDeletion(event.target.checked)}
                  />
                  <span>I understand live Murph data deletion is irreversible.</span>
                </label>
                <label className="flex gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <input
                    checked={acknowledgedProviderAndBackupLimits}
                    className="mt-0.5 size-4 shrink-0 accent-current"
                    type="checkbox"
                    onChange={(event) => setAcknowledgedProviderAndBackupLimits(event.target.checked)}
                  />
                  <span>I understand provider-side records, Stripe/Privy records, and backups may follow separate retention rules.</span>
                </label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {
                  setDialogError(null);
                  setDialogStep("review");
                }} disabled={deletePending}>
                  <Undo2Icon data-icon="inline-start" />
                  Back
                </Button>
                <Button type="button" variant="destructive" onClick={() => void handleDeleteConfirmed()} disabled={!deleteReady}>
                  <Trash2Icon data-icon="inline-start" />
                  {deletePending ? "Deleting..." : "Delete my Murph data"}
                </Button>
              </DialogFooter>
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

async function readDataExportErrorMessage(response: Response): Promise<string> {
  const fallback = "Could not prepare your data export right now.";
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return fallback;
  }

  try {
    const payload: unknown = JSON.parse(text);
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function readDataExportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) {
    return DEFAULT_EXPORT_FILENAME;
  }

  const encodedMatch = /filename\*=UTF-8''([^;]+)/iu.exec(contentDisposition);
  if (encodedMatch?.[1]) {
    try {
      return sanitizeDownloadFilename(decodeURIComponent(encodedMatch[1]));
    } catch {
      return DEFAULT_EXPORT_FILENAME;
    }
  }

  const quotedMatch = /filename="([^"]+)"/iu.exec(contentDisposition);
  if (quotedMatch?.[1]) {
    return sanitizeDownloadFilename(quotedMatch[1]);
  }

  const bareMatch = /filename=([^;]+)/iu.exec(contentDisposition);
  return bareMatch?.[1]
    ? sanitizeDownloadFilename(bareMatch[1])
    : DEFAULT_EXPORT_FILENAME;
}

function triggerDataExportDownload(blob: Blob, filename: string): void {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function sanitizeDownloadFilename(value: string): string {
  const sanitized = value.trim().replace(/[\\/]/gu, "-");
  return sanitized || DEFAULT_EXPORT_FILENAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function formatProviderName(value: string): string {
  return value.toUpperCase();
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
