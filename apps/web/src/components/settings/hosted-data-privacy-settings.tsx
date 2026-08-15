"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { HostedPrivyLogout } from "@/src/components/hosted-onboarding/hosted-privy-logout";
import { useSensitiveActionAuthorization } from "@/src/components/sensitive-actions/use-sensitive-action-authorization";
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
  loadBrowserVaultExport,
  normalizeBrowserVaultExportError,
} from "@/src/lib/browser-vault/export";
import {
  publishBrowserVaultSessionEnding,
  publishBrowserVaultSessionInvalidation,
} from "@/src/lib/browser-vault/session-invalidation";
import { reloadCurrentHostedAuthDocument } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  type HostedAccountExitReasonCode,
} from "@/src/lib/hosted-privacy/account-data-shared";

import { AccountExitReasonStep } from "./account-exit-reason-step";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

interface HostedAccountVendorDeletionSummary {
  errorCode: string | null;
  status: string;
}

interface HostedAccountDeleteResponse {
  ok: true;
  result: {
    cleanupPending?: boolean;
    cloudflare: {
      configured: boolean;
      deleted: boolean;
    };
    deletedAt: string;
    vendorAccounts: {
      privyUser: HostedAccountVendorDeletionSummary;
      stripeCustomer: HostedAccountVendorDeletionSummary;
      stripeSubscription: HostedAccountVendorDeletionSummary;
    };
  };
}

const DEFAULT_VAULT_EXPORT_FILENAME = "murph-vault-export.json";
const POST_DELETE_REDIRECT_DELAY_MS = 2_500;
const POST_DELETE_REDIRECT_FALLBACK_MS = 8_000;

export function HostedDataPrivacySettings(props: {
  authenticated: boolean;
  authorizationEnabled?: boolean;
}) {
  if (props.authorizationEnabled === false) {
    return <HostedDataPrivacyUnavailable authenticated={props.authenticated} />;
  }

  return (
    <HostedDataPrivacySettingsAuthorized
      authenticated={props.authenticated}
    />
  );
}

function HostedDataPrivacySettingsAuthorized(props: {
  authenticated: boolean;
}) {
  const { authorize } = useSensitiveActionAuthorization();
  const [exportPending, setExportPending] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [acknowledgedSensitiveDownload, setAcknowledgedSensitiveDownload] = useState(false);
  const [exportDialogError, setExportDialogError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<"reason" | "confirm">("reason");
  const [exitReason, setExitReason] = useState<HostedAccountExitReasonCode | null>(null);
  const [exitNote, setExitNote] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deviceReconnectRequired, setDeviceReconnectRequired] = useState(false);
  const [providerAccessRemovalRequired, setProviderAccessRemovalRequired] = useState(false);
  const [providerAccessRemovalConfirmed, setProviderAccessRemovalConfirmed] = useState(false);
  const [providerAccessRemovalConfirmationToken, setProviderAccessRemovalConfirmationToken] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [privyLogoutDone, setPrivyLogoutDone] = useState(false);
  const deletedAlertRef = useRef<HTMLDivElement | null>(null);

  const exportReady = acknowledgedSensitiveDownload && !exportPending;
  const phraseMatches = confirmationPhrase === HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE;
  const deleteReady = phraseMatches
    && (
      !providerAccessRemovalRequired
      || (
        providerAccessRemovalConfirmed
        && providerAccessRemovalConfirmationToken !== null
      )
    )
    && !deletePending;

  useEffect(() => {
    if (!deleted) {
      return;
    }

    // Anchor focus so keyboard and screen-reader users land on the
    // confirmation after the dialog unmounts, and keep a hard redirect
    // fallback in case the best-effort Privy client logout never settles.
    deletedAlertRef.current?.focus();
    const fallbackTimer = window.setTimeout(() => {
      window.location.assign("/");
    }, POST_DELETE_REDIRECT_FALLBACK_MS);
    return () => window.clearTimeout(fallbackTimer);
  }, [deleted]);

  useEffect(() => {
    if (!deleted || !privyLogoutDone) {
      return;
    }

    const redirectTimer = window.setTimeout(() => {
      window.location.assign("/");
    }, POST_DELETE_REDIRECT_DELAY_MS);
    return () => window.clearTimeout(redirectTimer);
  }, [deleted, privyLogoutDone]);

  async function handleExportConfirmed() {
    if (!exportReady) {
      return;
    }

    setExportPending(true);
    setExportDialogError(null);
    setExportSuccess(null);

    try {
      const authorization = await authorize("vault.export");
      const result = await loadBrowserVaultExport({
        authorization,
      });
      triggerJsonDownload(
        result.blob,
        buildVaultExportFilename(result.generatedAt),
      );

      closeExportDialog();
      setExportSuccess(formatVaultExportSuccess(result));
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
    setDeviceReconnectRequired(false);
    let sessionEndingDispatched = false;
    let receivedReplacementHeaders = false;

    try {
      const authorization = await authorize("account.delete");
      publishBrowserVaultSessionEnding();
      sessionEndingDispatched = true;
      const response = await requestHostedOnboardingJson<HostedAccountDeleteResponse>({
        method: "POST",
        onSuccessfulResponseError: reloadCurrentHostedAuthDocument,
        onSuccessfulResponseHeaders: () => {
          receivedReplacementHeaders = true;
          publishBrowserVaultSessionInvalidation();
        },
        payload: {
          authorization,
          confirmationPhrase,
          ...(exitReason ? { exitNote, exitReason } : {}),
          ...(providerAccessRemovalConfirmed && providerAccessRemovalConfirmationToken
            ? { providerAccessRemovalConfirmationToken }
            : {}),
        },
        url: "/api/settings/privacy/delete",
      });
      setCleanupPending(hasIncompleteHostedAccountDeletionCleanup(response.result));
      setDeleted(true);
      setDialogOpen(false);
      setConfirmationPhrase("");
    } catch (requestError) {
      const providerRecoveryRequired =
        requestError instanceof HostedOnboardingApiError
        && requestError.code
          === "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_RECOVERY_REQUIRED";
      const deviceTokenRefreshRecoveryRequired =
        requestError instanceof HostedOnboardingApiError
        && requestError.code
          === "ACCOUNT_DELETION_DEVICE_TOKEN_REFRESH_RECOVERY_REQUIRED";
      const connectedAppCompletionRecoveryRequired =
        requestError instanceof HostedOnboardingApiError
        && (
          requestError.code === "ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG"
          || requestError.code === "ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS"
        );
      if (sessionEndingDispatched && !receivedReplacementHeaders) {
        publishBrowserVaultSessionInvalidation();
        if (
          !providerRecoveryRequired
          && !deviceTokenRefreshRecoveryRequired
          && !connectedAppCompletionRecoveryRequired
        ) {
          reloadCurrentHostedAuthDocument();
        }
      }
      if (providerRecoveryRequired) {
        const nextConfirmationToken =
          typeof requestError.details?.providerAccessRemovalConfirmationToken === "string"
            ? requestError.details.providerAccessRemovalConfirmationToken
            : null;
        setProviderAccessRemovalRequired(true);
        setProviderAccessRemovalConfirmed(false);
        setProviderAccessRemovalConfirmationToken(nextConfirmationToken);
      }
      if (deviceTokenRefreshRecoveryRequired) {
        setDeviceReconnectRequired(true);
      }
      setDialogError(requestError instanceof HostedOnboardingApiError
        ? requestError.message
        : "Could not delete your account right now.");
    } finally {
      setDeletePending(false);
    }
  }

  function openExportDialog() {
    setAcknowledgedSensitiveDownload(false);
    setExportDialogError(null);
    setExportSuccess(null);
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
    setConfirmationPhrase("");
    setDialogError(null);
    setDeviceReconnectRequired(false);
    setDialogStep("reason");
    setExitReason(null);
    setExitNote("");
    setProviderAccessRemovalRequired(false);
    setProviderAccessRemovalConfirmed(false);
    setProviderAccessRemovalConfirmationToken(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (deletePending) {
      return;
    }

    setDialogOpen(false);
    setConfirmationPhrase("");
    setDialogError(null);
    setDeviceReconnectRequired(false);
    setDialogStep("reason");
    setExitReason(null);
    setExitNote("");
    setProviderAccessRemovalRequired(false);
    setProviderAccessRemovalConfirmed(false);
    setProviderAccessRemovalConfirmationToken(null);
  }

  function skipExitReason() {
    setExitReason(null);
    setExitNote("");
    setDialogStep("confirm");
  }

  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to export your data or delete your account."
      />
    );
  }

  if (deleted) {
    return (
      <>
        <HostedAccountDeletionStatus
          cleanupPending={cleanupPending}
          ref={deletedAlertRef}
        />
        <HostedPrivyLogout onDone={() => setPrivyLogoutDone(true)} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {exportSuccess ? (
        <HostedDataExportSuccess message={exportSuccess} />
      ) : null}

      <div className="divide-y divide-[rgba(196,168,130,0.25)]">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pb-4">
          <Download className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <span className="font-serif text-base tracking-tight text-foreground">
            Export data
          </span>
          <Button disabled={exportPending || deletePending} onClick={openExportDialog} size="default" type="button" variant="ghost">
            {exportPending ? "Exporting..." : "Export"}
          </Button>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pt-4">
          <Trash2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <span className="font-serif text-base tracking-tight text-foreground">
            Delete account
          </span>
          <Button disabled={deletePending} onClick={openDialog} size="default" type="button" variant="destructive">
            Delete
          </Button>
        </div>
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={(open) => (open ? setExportDialogOpen(true) : closeExportDialog())}>
        <DialogContent
          aria-busy={exportPending}
          aria-describedby="hosted-data-export-description"
          aria-labelledby="hosted-data-export-title"
          className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton={!exportPending}
        >
          <HostedDataExportDialogContent
            acknowledgedSensitiveDownload={acknowledgedSensitiveDownload}
            errorMessage={exportDialogError}
            onAcknowledgedChange={setAcknowledgedSensitiveDownload}
            onCancel={closeExportDialog}
            onConfirm={() => void handleExportConfirmed()}
            pending={exportPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent
          aria-busy={deletePending}
          className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto p-6 md:p-7"
          showCloseButton={!deletePending}
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {dialogStep === "reason" ? "Before you go" : "Delete account"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {dialogStep === "reason"
                ? "Could you let us know why you're leaving? This is optional and it won't hold up your deletion."
                : "Deletes your account, data, subscription, and login permanently. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          {dialogError ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-5 text-destructive [overflow-wrap:anywhere]"
            >
              <p>{dialogError}</p>
              {deviceReconnectRequired ? (
                <Link
                  className="self-start font-medium underline underline-offset-4"
                  href="/connect"
                >
                  Manage wearables
                </Link>
              ) : null}
            </div>
          ) : null}
          {dialogStep === "reason" ? (
            <AccountExitReasonStep
              note={exitNote}
              reason={exitReason}
              onContinue={() => setDialogStep("confirm")}
              onNoteChange={setExitNote}
              onReasonChange={setExitReason}
              onSkip={skipExitReason}
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label
                  className="block leading-5"
                  htmlFor="hosted-account-delete-phrase"
                >
                  Type{" "}
                  <span className="font-mono text-xs tracking-wide">
                    {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                  </span>{" "}
                  to confirm
                </Label>
                <Input
                  autoComplete="off"
                  className="h-12 font-mono text-sm tracking-wide md:text-sm"
                  disabled={deletePending}
                  id="hosted-account-delete-phrase"
                  inputMode="text"
                  value={confirmationPhrase}
                  onChange={(event) => setConfirmationPhrase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleDeleteConfirmed();
                    }
                  }}
                  aria-invalid={confirmationPhrase.length > 0 && !phraseMatches}
                  placeholder={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                />
              </div>
              {providerAccessRemovalRequired ? (
                <HostedAccountProviderAccessRemovalConfirmation
                  checked={providerAccessRemovalConfirmed}
                  disabled={deletePending}
                  onCheckedChange={setProviderAccessRemovalConfirmed}
                />
              ) : null}
              <div className="flex flex-col gap-2">
                <Button type="button" size="xl" variant="destructive" onClick={() => void handleDeleteConfirmed()} disabled={!deleteReady} className="w-full">
                  {deletePending ? "Deleting..." : "Delete account"}
                </Button>
                <Button type="button" size="xl" variant="ghost" onClick={closeDialog} disabled={deletePending} className="w-full">
                  Cancel
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function HostedAccountProviderAccessRemovalConfirmation({
  checked,
  disabled = false,
  id = "hosted-account-provider-access-removed",
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  id?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-1">
      <Checkbox
        checked={checked}
        className="mt-0.5 size-5 shrink-0"
        disabled={disabled}
        id={id}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label className="block text-sm/5 font-normal" htmlFor={id}>
        I removed Murph access from every provider above.
      </Label>
    </div>
  );
}

export function HostedDataExportSuccess({ message }: { message: string }) {
  return (
    <Alert aria-live="polite" role="status">
      <AlertTitle>Export ready</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function HostedDataExportDialogContent({
  acknowledgedSensitiveDownload,
  errorMessage,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
  pending,
}: {
  acknowledgedSensitiveDownload: boolean;
  errorMessage: string | null;
  onAcknowledgedChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col items-stretch gap-6">
      <div className="space-y-2 pr-10">
        <h2
          className="font-serif text-2xl/7 font-semibold tracking-normal text-balance text-foreground"
          id="hosted-data-export-title"
        >
          Export your data
        </h2>
        <p
          className="text-sm leading-6 text-muted-foreground"
          id="hosted-data-export-description"
        >
          Downloads the latest dashboard data Murph has retained. Recent changes
          that have not finished processing may not be included.
        </p>
      </div>
      {errorMessage ? (
        <p
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      <div className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
        <Checkbox
          checked={acknowledgedSensitiveDownload}
          className="size-7 shrink-0"
          id="hosted-data-export-acknowledge"
          onCheckedChange={onAcknowledgedChange}
        />
        <label
          className="cursor-pointer pt-0.5 text-pretty"
          htmlFor="hosted-data-export-acknowledge"
        >
          This export may contain sensitive health data and private notes.
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={!acknowledgedSensitiveDownload || pending}
          onClick={onConfirm}
          size="xl"
          type="button"
        >
          <Download data-icon="inline-start" />
          {pending ? "Preparing..." : "Download my data"}
        </Button>
        <Button
          className="w-full"
          disabled={pending}
          onClick={onCancel}
          size="xl"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function HostedDataPrivacyUnavailable(props: { authenticated: boolean }) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={false}
        signedOutDescription="Sign in to export your data or delete your account."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert role="status">
        <AlertTitle>Secure approval unavailable</AlertTitle>
        <AlertDescription>
          Data export and account deletion are temporarily unavailable.
        </AlertDescription>
      </Alert>
      <div className="divide-y divide-[rgba(196,168,130,0.25)]">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pb-4">
          <Download className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <span className="font-serif text-base tracking-tight text-muted-foreground">Export data</span>
          <Button disabled size="default" type="button" variant="ghost">Export</Button>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pt-4">
          <Trash2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <span className="font-serif text-base tracking-tight text-muted-foreground">Delete account</span>
          <Button disabled size="default" type="button" variant="destructive">Delete</Button>
        </div>
      </div>
    </div>
  );
}

export const HostedAccountDeletionStatus = forwardRef<HTMLDivElement, {
  cleanupPending: boolean;
}>(function HostedAccountDeletionStatus(props, ref) {
  return (
    <Alert
      ref={ref}
      role="status"
      aria-live="polite"
      tabIndex={-1}
    >
      <AlertTitle>Account deleted</AlertTitle>
      <AlertDescription>
        {props.cleanupPending
          ? "Your account was deleted. We're finishing some cleanup on our side, no action needed. Redirecting to the home page."
          : "Your account and live Murph data have been deleted. Redirecting to the home page."}
      </AlertDescription>
    </Alert>
  );
});

export function hasIncompleteHostedAccountDeletionCleanup(
  result: HostedAccountDeleteResponse["result"],
): boolean {
  if (typeof result.cleanupPending === "boolean") {
    return result.cleanupPending;
  }

  const vendorStatuses = [
    result.vendorAccounts.privyUser.status,
    result.vendorAccounts.stripeCustomer.status,
    result.vendorAccounts.stripeSubscription.status,
  ];
  return vendorStatuses.some((status) => status === "failed" || status === "skipped_not_configured")
    || !result.cloudflare.deleted;
}

export function formatVaultExportSuccess(result: {
  deviceSyncImportPending: boolean;
  freshness: "fresh" | "stale";
  refreshPending: boolean;
}): string {
  return result.freshness !== "fresh"
    || result.refreshPending
    || result.deviceSyncImportPending
    ? "Your latest retained data downloaded. Recent changes Murph had not finished processing may be absent. Keep the file somewhere private and secure."
    : "Your data export downloaded. Keep the file somewhere private and secure.";
}

function buildVaultExportFilename(generatedAt: string): string {
  const safeTimestamp = sanitizeFilenameSegment(generatedAt);
  return safeTimestamp
    ? `murph-vault-export-${safeTimestamp}.json`
    : DEFAULT_VAULT_EXPORT_FILENAME;
}

function formatVaultExportError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Couldn't export your data right now.";
  }

  if (error.message === "Your data isn't ready to export yet.") {
    return error.message;
  }

  if (/BROWSER_VAULT_SESSION_NOT_FRESH/u.test(error.message)) {
    return "Your data is still being prepared. Try the export again in a moment.";
  }

  if (/retained dashboard export/iu.test(error.message)) {
    return error.message;
  }

  if (/HTTP 401/u.test(error.message)) {
    return "You've been signed out. Refresh the page and sign in again.";
  }

  if (/HTTP 403/u.test(error.message) && /consent/iu.test(error.message)) {
    return "Accept the latest Murph terms first, then try the export again.";
  }

  if (/HTTP 403/u.test(error.message)) {
    return "You don't have permission to export this data right now.";
  }

  const normalizedMessage = normalizeBrowserVaultExportError(error);
  return normalizedMessage === "Your dashboard data is not available right now."
    ? "Murph could not retrieve your retained export right now. Try again later."
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
