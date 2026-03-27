"use client";

import {
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useState } from "react";

import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  type HostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccountState,
} from "@/src/lib/hosted-onboarding/privy-shared";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { HostedPrivyProvider } from "./privy-provider";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  mode: "invite" | "public";
  onClearHostedSession?: () => Promise<void> | void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  phoneHint?: string | null;
  privyAppId: string;
}

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
  const { loginWithCode, sendCode } = useLoginWithSms();
  const { refreshUser, user } = useUser();
  const [authenticatedSessionIssue, setAuthenticatedSessionIssue] = useState<string | null>(null);
  const [checkingAuthenticatedSession, setCheckingAuthenticatedSession] = useState(false);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "continue" | "logout" | "send-code" | "verify-code" | null
  >(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");

  const normalizedPhoneNumber = useMemo(() => normalizePhoneNumber(phoneNumber), [phoneNumber]);

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
        setAuthenticatedSessionIssue(describeHostedPrivySessionIssue(sessionState));
      }
      if (!cancelled) {
        setCheckingAuthenticatedSession(false);
      }
    }

    void inspectAuthenticatedSession();

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready, refreshUser, user]);

  async function handleSendCode() {
    setErrorMessage(null);

    if (!normalizedPhoneNumber) {
      setErrorMessage("Enter a valid phone number in international format, like +1 415 555 2671.");
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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {authenticated ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
          <strong className="text-stone-900">Verified Privy session found.</strong>
          <p className="mt-1">
            {checkingAuthenticatedSession
              ? "Checking the current Privy session for a verified phone number and rewards wallet."
              : authenticatedSessionIssue ??
                "Continue with your current verified phone session, or sign out and use a different number."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-stone-900" htmlFor={`hosted-phone-${mode}`}>
            {mode === "invite" ? "Phone number that received this invite" : "Your phone number"}
          </label>
          <input
            id={`hosted-phone-${mode}`}
            autoComplete="tel"
            inputMode="tel"
            placeholder="+1 415 555 2671"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.currentTarget.value)}
            className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-stone-900 placeholder:text-stone-400 focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-100"
          />
          <p className="text-sm text-stone-500">
            {mode === "invite"
              ? `Use the same number we texted${phoneHint ? ` (${phoneHint})` : ""}.`
              : "We verify your number with SMS, then create your rewards wallet automatically."}
          </p>
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
            className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-stone-900 placeholder:text-stone-400 focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-100"
          />
          <p className="text-sm text-stone-500">Enter the code we just texted you.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {authenticated ? (
          <>
            {!checkingAuthenticatedSession && !authenticatedSessionIssue ? (
              <button
                type="button"
                onClick={handleContinueAuthenticated}
                disabled={!ready || pendingAction !== null}
                className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "continue"
                  ? mode === "invite"
                    ? "Verifying phone and wallet..."
                    : "Creating account..."
                  : "Continue with verified phone"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              disabled={pendingAction !== null}
              className="rounded-full border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
            </button>
          </>
        ) : step === "phone" ? (
          <button
            type="button"
            onClick={handleSendCode}
            disabled={!ready || pendingAction !== null}
            className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={!ready || pendingAction !== null}
              className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "verify-code"
                ? mode === "invite"
                  ? "Verifying phone and wallet..."
                  : "Verifying and creating account..."
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
              className="rounded-full border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change number
            </button>
          </>
        )}
      </div>

      <p className="text-sm leading-relaxed text-stone-500">
        Healthy Bob uses your verified phone number for sign-in and provisions a self-custodial rewards wallet before checkout.
      </p>
    </div>
  );
}

async function finalizeHostedPrivyVerification(input: {
  inviteCode?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}) {
  await requireHostedPrivyPhoneAndWalletReady(input);
  const payload = await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
    payload: input.inviteCode ? { inviteCode: input.inviteCode } : {},
    url: "/api/hosted-onboarding/privy/complete",
  });

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

async function requireHostedPrivyPhoneAndWalletReady(input: {
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}): Promise<void> {
  const sessionState = await readHostedPrivyClientSessionState(input);

  if (!sessionState.phone) {
    throw new Error("This Privy session is missing a verified phone number.");
  }

  if (!sessionState.wallet) {
    throw new Error("We could not finish preparing your rewards wallet. Sign out and try the SMS flow again.");
  }
}

async function readHostedPrivyClientSessionState(input: {
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}): Promise<HostedPrivyLinkedAccountState> {
  const currentState = resolveHostedPrivyLinkedAccountState(input.user);

  if (currentState.phone && currentState.wallet) {
    return currentState;
  }

  try {
    return resolveHostedPrivyLinkedAccountState(await input.refreshUser());
  } catch {
    return currentState;
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function describeHostedPrivySessionIssue(sessionState: HostedPrivyLinkedAccountState): string | null {
  if (!sessionState.phone) {
    return "Your current Privy session is missing a verified phone number. Sign out and continue with SMS.";
  }

  if (!sessionState.wallet) {
    return "Your current Privy session does not have a rewards wallet yet. Sign out and continue with SMS to finish setup.";
  }

  return null;
}
