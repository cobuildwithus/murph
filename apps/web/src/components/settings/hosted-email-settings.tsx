"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePrivy, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyVerifiedEmailAccount,
  isHostedPrivyEmailAccountVerified,
  resolveHostedPrivyLinkedAccounts,
  type HostedPrivyEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedPrivyProvider } from "../hosted-onboarding/privy-provider";

interface HostedEmailSettingsProps {
  expectedPrivyUserId: string;
  privyAppId: string;
}

interface HostedEmailSyncResult {
  emailAddress: string;
  runTriggered: boolean;
  verifiedAt: string;
}

export function HostedEmailSettings({ privyAppId, ...props }: HostedEmailSettingsProps) {
  return (
    <HostedPrivyProvider appId={privyAppId}>
      <HostedEmailSettingsInner {...props} />
    </HostedPrivyProvider>
  );
}

function HostedEmailSettingsInner({ expectedPrivyUserId }: Omit<HostedEmailSettingsProps, "privyAppId">) {
  const { authenticated, logout, ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const { sendCode, state, verifyCode } = useUpdateEmail();
  const [code, setCode] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingEmailRoute, setIsSyncingEmailRoute] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verifiedEmailOverride, setVerifiedEmailOverride] = useState<HostedPrivyEmailAccount | null>(null);

  const linkedAccounts = resolveHostedPrivyLinkedAccounts(user);
  const currentEmail = extractHostedPrivyEmailAccount(linkedAccounts);
  const effectiveCurrentEmail = verifiedEmailOverride ?? currentEmail;
  const normalizedCurrentEmail = normalizeComparableEmail(effectiveCurrentEmail?.address ?? null);
  const canManageEmail = ready && authenticated && user?.id === expectedPrivyUserId;
  const isLoadingAuthenticatedUser = ready && authenticated && !user;
  const isAwaitingCode = state.status === "awaiting-code-input";
  const isSendingCode = state.status === "sending-code";
  const isSubmittingCode = state.status === "submitting-code";
  const isBusy = isSendingCode || isSubmittingCode || isSyncingEmailRoute;

  useEffect(() => {
    if (!emailAddress && effectiveCurrentEmail?.address) {
      setEmailAddress(effectiveCurrentEmail.address);
    }
  }, [effectiveCurrentEmail?.address, emailAddress]);

  useEffect(() => {
    if (isAwaitingCode || isSubmittingCode) {
      setDialogOpen(true);
    }
  }, [isAwaitingCode, isSubmittingCode]);

  async function requestCodeForEmail(nextEmailAddress: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!ready) {
      setErrorMessage("We are still loading your Privy session. Try again in a moment.");
      return;
    }

    if (!authenticated) {
      setErrorMessage("Sign in with your existing hosted account before you try to link an email address.");
      return;
    }

    if (!user) {
      setErrorMessage("We are still loading your account details. Try again in a moment.");
      return;
    }

    if (user.id !== expectedPrivyUserId) {
      setErrorMessage("This Privy session belongs to a different account than the current hosted session.");
      return;
    }

    if (!isValidEmailAddress(nextEmailAddress)) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (
      normalizeComparableEmail(nextEmailAddress) === normalizedCurrentEmail
      && isHostedPrivyEmailAccountVerified(effectiveCurrentEmail)
    ) {
      setErrorMessage("That email address is already linked to this account.");
      return;
    }

    try {
      await sendCode({ newEmailAddress: nextEmailAddress });
      setPendingEmailAddress(nextEmailAddress);
      setDialogOpen(true);
      setCode("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code to that email address."));
    }
  }

  async function handleSendCode() {
    const nextEmailAddress = normalizeEmailAddress(emailAddress);

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleResendCode() {
    const nextEmailAddress = normalizeEmailAddress(emailAddress) ?? pendingEmailAddress;

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleVerifyCode() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedCode = code.trim();

    if (!normalizedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    let verifiedEmailAddress: string | null = null;

    try {
      const result = await verifyCode({ code: normalizedCode });
      const nextUser = result?.user ?? user;
      const nextEmail = extractHostedPrivyVerifiedEmailAccount(
        resolveHostedPrivyLinkedAccounts(nextUser),
      );

      verifiedEmailAddress = nextEmail?.address ?? pendingEmailAddress ?? normalizeEmailAddress(emailAddress);

      setCode("");
      setDialogOpen(false);
      setPendingEmailAddress(null);
      setEmailAddress(verifiedEmailAddress ?? emailAddress);

      if (verifiedEmailAddress) {
        setVerifiedEmailOverride({
          address: verifiedEmailAddress,
          verifiedAt: nextEmail?.verifiedAt ?? Math.trunc(Date.now() / 1000),
        });
      }

      await refreshUser().catch(() => null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
      return;
    }

    if (!verifiedEmailAddress) {
      setSuccessMessage("Email verified.");
      return;
    }

    setIsSyncingEmailRoute(true);

    try {
      const syncResult = await syncHostedEmailConnectionWithRetry(verifiedEmailAddress);
      setSuccessMessage(
        syncResult.runTriggered
          ? `Email verified and connected: ${syncResult.emailAddress}`
          : `Email verified and saved: ${syncResult.emailAddress}. Your hosted assistant will finish syncing it on the next hosted run.`,
      );
    } catch (error) {
      setSuccessMessage(`Email verified: ${verifiedEmailAddress}`);
      setErrorMessage(toHostedEmailSyncErrorMessage(error));
    } finally {
      setIsSyncingEmailRoute(false);
    }
  }

  async function handleLogout() {
    setErrorMessage(null);
    setLoggingOut(true);

    try {
      await logout();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign out of the current Privy session."));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="space-y-5">
      {successMessage ? (
        <div className="rounded border border-green-200 bg-green-50 p-4 text-sm leading-snug text-green-700">
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {isSyncingEmailRoute ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          Finishing the hosted email connection and updating your assistant.
        </div>
      ) : null}

      {!ready || isLoadingAuthenticatedUser ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          Checking your Privy session before we show email settings.
        </div>
      ) : !authenticated ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
          Open your latest Murph invite or sign-in flow in this browser first. We need the matching Privy session
          before we can verify an email on your hosted account.
        </div>
      ) : !canManageEmail ? (
        <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
          <p>
            This browser is signed in to a different Privy account than the active hosted session. Sign out here, then
            reopen the correct Murph invite before linking an email address.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className={secondaryButtonClasses}
          >
            {loggingOut ? "Signing out..." : "Sign out of Privy"}
          </button>
        </div>
      ) : (
        <>
          <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
            <strong className="text-stone-900">
              {!effectiveCurrentEmail
                ? "No email linked yet"
                : isHostedPrivyEmailAccountVerified(effectiveCurrentEmail)
                  ? "Current verified email"
                  : "Current email"}
            </strong>
            <p className="mt-1">
              {effectiveCurrentEmail?.address
                ?? "Add an email address and we will verify it with a one-time code before saving it."}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-stone-900" htmlFor="settings-email-address">
                Email address
              </label>
              <input
                id="settings-email-address"
                autoComplete="email"
                inputMode="email"
                placeholder="user@example.com"
                type="email"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.currentTarget.value)}
                className={inputClasses}
              />
              <p className="text-sm text-stone-500">
                We&apos;ll send a one-time code through Privy, then you&apos;ll confirm it in the verification dialog.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSendCode}
              disabled={isBusy}
              className={primaryButtonClasses}
            >
              {isSyncingEmailRoute
                ? "Syncing..."
                : isSendingCode
                  ? "Sending code..."
                  : effectiveCurrentEmail
                    ? "Send new code"
                    : "Send code"}
            </button>
          </div>

          {pendingEmailAddress ? (
            <div className="flex flex-wrap items-center gap-3 rounded border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-600">
              <span>
                We sent a verification code to <strong className="text-stone-900">{pendingEmailAddress}</strong>.
              </span>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                disabled={isBusy}
                className={secondaryButtonClasses}
              >
                Enter code
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isBusy}
                className={secondaryButtonClasses}
              >
                {isSendingCode ? "Sending code..." : "Resend code"}
              </button>
            </div>
          ) : null}
        </>
      )}

      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isSubmittingCode) {
            setDialogOpen(nextOpen);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-stone-900/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-2xl focus:outline-none md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Dialog.Title className="text-xl font-bold tracking-tight text-stone-900">
                  Enter your verification code
                </Dialog.Title>
                <Dialog.Description className="text-sm leading-relaxed text-stone-500">
                  {pendingEmailAddress
                    ? `We emailed a one-time code to ${pendingEmailAddress}. Enter it here to finish updating your account.`
                    : "Enter the one-time code Privy emailed you to finish updating your account."}
                </Dialog.Description>
              </div>

              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close verification dialog"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSubmittingCode}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-6 space-y-3">
              <label className="text-sm font-semibold text-stone-900" htmlFor="settings-email-code">
                Verification code
              </label>
              <input
                id="settings-email-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.currentTarget.value)}
                className={inputClasses}
              />
              <p className="text-sm text-stone-500">
                Codes typically expire quickly, so use the newest email if you request another one.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleVerifyCode}
                disabled={isBusy}
                className={primaryButtonClasses}
              >
                {isSubmittingCode ? "Verifying..." : "Verify email"}
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isBusy}
                className={secondaryButtonClasses}
              >
                {isSendingCode ? "Sending code..." : "Resend code"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeComparableEmail(value: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

async function syncHostedEmailConnectionWithRetry(
  expectedEmailAddress: string,
): Promise<HostedEmailSyncResult> {
  const retryDelaysMs = [0, 250, 500, 1_000];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) {
      await sleep(retryDelaysMs[attempt]);
    }

    try {
      return await syncHostedEmailConnection(expectedEmailAddress);
    } catch (error) {
      lastError = error;

      if (!(error instanceof HostedEmailSyncError) || error.code !== "PRIVY_EMAIL_NOT_READY") {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new HostedEmailSyncError(
        null,
        "We verified your email, but the hosted assistant could not confirm it yet. Refresh and try again.",
      );
}

async function syncHostedEmailConnection(expectedEmailAddress: string): Promise<HostedEmailSyncResult> {
  const response = await fetch("/api/settings/email/sync", {
    body: JSON.stringify({
      expectedEmailAddress,
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const payload = await readOptionalJsonObject(response);

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;

    throw new HostedEmailSyncError(
      typeof errorPayload?.code === "string" ? errorPayload.code : null,
      typeof errorPayload?.message === "string"
        ? errorPayload.message
        : "We could not sync your verified email to the hosted assistant yet.",
    );
  }

  if (
    !isRecord(payload)
    || payload.ok !== true
    || typeof payload.emailAddress !== "string"
    || typeof payload.verifiedAt !== "string"
  ) {
    throw new HostedEmailSyncError(
      null,
      "We verified your email, but the hosted assistant returned an unexpected sync response.",
    );
  }

  return {
    emailAddress: payload.emailAddress,
    runTriggered: payload.runTriggered !== false,
    verifiedAt: payload.verifiedAt,
  };
}

async function readOptionalJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function toHostedEmailSyncErrorMessage(error: unknown): string {
  if (error instanceof HostedEmailSyncError) {
    return error.message;
  }

  return toErrorMessage(
    error,
    "We verified your email, but we could not sync it to the hosted assistant yet. Refresh and try again.",
  );
}

class HostedEmailSyncError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = "HostedEmailSyncError";
    this.code = code;
  }
}

const inputClasses =
  "w-full rounded border border-stone-200 bg-white px-4 py-3 text-stone-900 placeholder:text-stone-400 focus:border-olive-light focus:outline-none focus:ring-2 focus:ring-olive-light/20";

const primaryButtonClasses =
  "inline-flex items-center justify-center rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50";
