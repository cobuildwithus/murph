"use client";

import {
  useCreateWallet,
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";

import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";
import {
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneAndWalletReady,
  HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS,
  readHostedPrivyClientSessionState,
  resolveHostedPrivyClientSessionIssue,
  shouldAutoContinueHostedPrivyClientSession,
  type HostedPrivyClientPendingAction,
  type HostedPrivyClientSessionIssue,
} from "@/src/lib/hosted-onboarding/privy-client";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";
import { HostedPrivyProvider } from "./privy-provider";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  mode: "invite" | "public";
  onClearHostedSession?: () => Promise<void> | void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  phoneHint?: string | null;
  privyAppId: string;
}

const HOSTED_PHONE_COUNTRY_OPTIONS = [
  { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
  { code: "CA", dialCode: "+1", label: "Canada", placeholder: "(416) 555-0123" },
  { code: "GB", dialCode: "+44", label: "United Kingdom", placeholder: "07700 900123" },
  { code: "AU", dialCode: "+61", label: "Australia", placeholder: "0400 111 222" },
  { code: "NZ", dialCode: "+64", label: "New Zealand", placeholder: "021 123 4567" },
] as const;

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";

export function HostedPhoneAuth({ privyAppId, ...props }: HostedPhoneAuthProps) {
  return (
    <HostedPrivyProvider appId={privyAppId}>
      <HostedPhoneAuthInner {...props} />
    </HostedPrivyProvider>
  );
}

function HostedPhoneAuthInner({
  inviteCode,
  mode,
  onClearHostedSession,
  onCompleted,
  phoneHint,
}: Omit<HostedPhoneAuthProps, "privyAppId">) {
  const { authenticated, logout, ready } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { loginWithCode, sendCode } = useLoginWithSms();
  const { refreshUser, user } = useUser();
  const [authenticatedSessionIssue, setAuthenticatedSessionIssue] = useState<HostedPrivyClientSessionIssue | null>(null);
  const [checkingAuthenticatedSession, setCheckingAuthenticatedSession] = useState(false);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<HostedPrivyClientPendingAction>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const autoContinueTriggered = useRef(false);

  const selectedPhoneCountry = useMemo(
    () =>
      HOSTED_PHONE_COUNTRY_OPTIONS.find((option) => option.code === phoneCountryCode)
      ?? HOSTED_PHONE_COUNTRY_OPTIONS[0],
    [phoneCountryCode],
  );
  const normalizedPhoneNumber = useMemo(
    () => normalizePhoneNumberForCountry(phoneNumber, selectedPhoneCountry.dialCode),
    [phoneNumber, selectedPhoneCountry.dialCode],
  );

  useEffect(() => {
    let cancelled = false;

    async function inspectAuthenticatedSession() {
      if (!authenticated || !ready) {
        setAuthenticatedSessionIssue(null);
        setCheckingAuthenticatedSession(false);
        return;
      }

      setCheckingAuthenticatedSession(true);

      const sessionState = await readHostedPrivyClientSessionState({ refreshUser, user });
      if (!cancelled) {
        setAuthenticatedSessionIssue(resolveHostedPrivyClientSessionIssue(sessionState));
      }
      if (!cancelled) {
        setCheckingAuthenticatedSession(false);
      }
    }

    void inspectAuthenticatedSession();

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready]);

  useEffect(() => {
    if (
      !shouldAutoContinueHostedPrivyClientSession({
        authenticated,
        autoContinueTriggered: autoContinueTriggered.current,
        checkingAuthenticatedSession,
        issue: authenticatedSessionIssue,
        pendingAction,
      })
    ) {
      autoContinueTriggered.current = false;
      return;
    }

    autoContinueTriggered.current = true;
    void handleContinueAuthenticated();
  }, [authenticated, authenticatedSessionIssue, checkingAuthenticatedSession, pendingAction]);

  const authenticatedSessionDescription = useMemo(() => {
    if (checkingAuthenticatedSession) {
      return "Checking the current Privy session for a verified phone number and setup status.";
    }

    if (pendingAction === "continue") {
      return "Finishing setup with your current verified phone number now.";
    }

    return (
      describeHostedPrivyClientSessionIssue(authenticatedSessionIssue)
      ?? "You're already verified. Finishing setup with your current phone number now, or sign out and use a different number."
    );
  }, [authenticatedSessionIssue, checkingAuthenticatedSession, pendingAction]);

  async function handleSendCode() {
    setErrorMessage(null);

    if (!normalizedPhoneNumber) {
      setErrorMessage(`Enter a valid phone number for ${selectedPhoneCountry.label}.`);
      return;
    }

    setPendingAction("send-code");

    try {
      await sendCode({ phoneNumber: normalizedPhoneNumber });
      setStep("code");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleVerifyCode() {
    setErrorMessage(null);

    if (!code.trim()) {
      setErrorMessage("Enter the verification code we texted you.");
      return;
    }

    setPendingAction("verify-code");

    try {
      await loginWithCode({ code: code.trim() });
      await finalizeHostedPrivyVerification({
        createWallet,
        inviteCode,
        onCompleted,
        refreshUser,
        user,
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleContinueAuthenticated() {
    setErrorMessage(null);
    setPendingAction("continue");

    try {
      await finalizeHostedPrivyVerification({
        createWallet,
        inviteCode,
        onCompleted,
        refreshUser,
        user,
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not continue with your Privy session."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogout() {
    setErrorMessage(null);
    setPendingAction("logout");

    try {
      await logout();
      await onClearHostedSession?.();
      setCode("");
      setPhoneCountryCode(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
      setPhoneNumber("");
      setStep("phone");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign you out cleanly."));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {authenticated ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          <strong className="text-stone-900">Verified Privy session found.</strong>
          <p className="mt-1">{authenticatedSessionDescription}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-stone-900" htmlFor={`hosted-phone-${mode}`}>
            {mode === "invite" ? "Phone number that received this invite" : "Your phone number"}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor={`hosted-phone-country-${mode}`}>
              Country or region
            </label>
            <select
              id={`hosted-phone-country-${mode}`}
              value={phoneCountryCode}
              onChange={(event) => setPhoneCountryCode(event.currentTarget.value)}
              className="rounded border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-900 focus:border-olive-light focus:outline-none focus:ring-2 focus:ring-olive-light/20 sm:w-56"
            >
              {HOSTED_PHONE_COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {`${option.label} (${option.dialCode})`}
                </option>
              ))}
            </select>
            <input
              id={`hosted-phone-${mode}`}
              autoComplete="tel-national"
              inputMode="tel"
              placeholder={selectedPhoneCountry.placeholder}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.currentTarget.value)}
              className={`${inputClasses} sm:flex-1`}
            />
          </div>
          <p className="text-sm text-stone-500">
            {`Defaulting to ${selectedPhoneCountry.label}. Type the local number and we’ll add ${selectedPhoneCountry.dialCode} automatically.`}
          </p>
          {mode === "invite" ? (
            <p className="text-sm text-stone-500">
              {`Use the same number we texted${phoneHint ? ` (${phoneHint})` : ""}.`}
            </p>
          ) : null}
        </div>
      )}

      {!authenticated && step === "code" ? (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-stone-900" htmlFor={`hosted-code-${mode}`}>
            Verification code
          </label>
          <input
            id={`hosted-code-${mode}`}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            className={inputClasses}
          />
          <p className="text-sm text-stone-500">Enter the code we just texted you.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {authenticated ? (
          <>
            <button
              type="button"
              onClick={handleLogout}
              disabled={pendingAction !== null}
              className="rounded border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
            </button>
          </>
        ) : step === "phone" ? (
          <button
            type="button"
            onClick={handleSendCode}
            disabled={!ready || pendingAction !== null}
            className="rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={!ready || pendingAction !== null}
            className="rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === "verify-code"
                ? "Finishing setup..."
                : mode === "invite"
                  ? "Verify phone and continue"
                  : "Verify phone and create account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCode("");
                setStep("phone");
              }}
              disabled={pendingAction !== null}
              className="rounded border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change number
            </button>
          </>
        )}
      </div>

    </div>
  );
}

async function finalizeHostedPrivyVerification(input: {
  createWallet: () => Promise<unknown>;
  inviteCode?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}) {
  await ensureHostedPrivyPhoneAndWalletReady(input);
  const payload = await requestHostedPrivyCompletionWithRetry(input.inviteCode);

  if (input.onCompleted) {
    await input.onCompleted(payload);
    return;
  }

  if (payload.stage === "checkout") {
    const checkout = await requestHostedOnboardingJson<{ alreadyActive: boolean; url: string | null }>({
      payload: {
        inviteCode: payload.inviteCode,
      },
      url: "/api/hosted-onboarding/billing/checkout",
    });

    if (!checkout.alreadyActive && checkout.url) {
      window.location.assign(checkout.url);
      return;
    }
  }

  window.location.assign(payload.joinUrl);
}

async function requestHostedPrivyCompletionWithRetry(
  inviteCode?: string | null,
): Promise<HostedPrivyCompletionPayload> {
  let lastError: unknown = null;

  for (const delayMs of HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
        payload: inviteCode ? { inviteCode } : {},
        url: "/api/hosted-onboarding/privy/complete",
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableHostedPrivyCompletionError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("We could not verify your Privy session.");
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRetryableHostedPrivyCompletionError(error: unknown): boolean {
  return (
    error instanceof HostedOnboardingApiError &&
    error.retryable &&
    (error.code === "PRIVY_PHONE_NOT_READY" || error.code === "PRIVY_WALLET_NOT_READY")
  );
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

const inputClasses =
  "w-full rounded border border-stone-200 bg-white px-4 py-3 text-stone-900 placeholder:text-stone-400 focus:border-olive-light focus:outline-none focus:ring-2 focus:ring-olive-light/20";
