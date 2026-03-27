"use client";

import {
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  type HostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccountState,
} from "@/src/lib/hosted-onboarding/privy-shared";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { hasHostedPrivyClientConfig, HostedPrivyProvider } from "./privy-provider";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  mode: "invite" | "public";
  onClearHostedSession?: () => Promise<void> | void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  phoneHint?: string | null;
}

export function HostedPhoneAuth(props: HostedPhoneAuthProps) {
  if (!hasHostedPrivyClientConfig()) {
    return <div style={noticeStyle}>Phone signup is not configured for this environment yet.</div>;
  }

  return (
    <HostedPrivyProvider>
      <HostedPhoneAuthInner {...props} />
    </HostedPrivyProvider>
  );
}

function HostedPhoneAuthInner({ inviteCode, mode, onClearHostedSession, onCompleted, phoneHint }: HostedPhoneAuthProps) {
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
    <div style={{ display: "grid", gap: "0.9rem" }}>
      {errorMessage ? <div style={errorStyle}>{errorMessage}</div> : null}

      {authenticated ? (
        <div style={noticeStyle}>
          <strong style={{ color: "rgb(15 23 42)" }}>Verified Privy session found.</strong>
          <div style={{ paddingTop: "0.35rem" }}>
            {checkingAuthenticatedSession
              ? "Checking the current Privy session for a verified phone number and rewards wallet."
              : authenticatedSessionIssue ??
                "Continue with your current verified phone session, or sign out and use a different number."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={fieldLabelStyle} htmlFor={`hosted-phone-${mode}`}>
            {mode === "invite" ? "Phone number that received this invite" : "Your phone number"}
          </label>
          <input
            id={`hosted-phone-${mode}`}
            autoComplete="tel"
            inputMode="tel"
            placeholder="+1 415 555 2671"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.currentTarget.value)}
            style={inputStyle}
          />
          <div style={captionStyle}>
            {mode === "invite"
              ? `Use the same number we texted${phoneHint ? ` (${phoneHint})` : ""}.`
              : "We verify your number with SMS, then create your rewards wallet automatically."}
          </div>
        </div>
      )}

      {!authenticated && step === "code" ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={fieldLabelStyle} htmlFor={`hosted-code-${mode}`}>
            Verification code
          </label>
          <input
            id={`hosted-code-${mode}`}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            style={inputStyle}
          />
          <div style={captionStyle}>Enter the code we just texted you.</div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        {authenticated ? (
          <>
            {!checkingAuthenticatedSession && !authenticatedSessionIssue ? (
              <button
                type="button"
                onClick={handleContinueAuthenticated}
                disabled={!ready || pendingAction !== null}
                style={primaryButtonStyle}
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
              style={secondaryButtonStyle}
            >
              {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
            </button>
          </>
        ) : step === "phone" ? (
          <button
            type="button"
            onClick={handleSendCode}
            disabled={!ready || pendingAction !== null}
            style={primaryButtonStyle}
          >
            {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={!ready || pendingAction !== null}
              style={primaryButtonStyle}
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
              style={secondaryButtonStyle}
            >
              Change number
            </button>
          </>
        )}
      </div>

      <div style={captionStyle}>
        Healthy Bob uses your verified phone number for sign-in and provisions a self-custodial rewards wallet before checkout.
      </div>
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

const fieldLabelStyle = {
  color: "rgb(15 23 42)",
  fontSize: "0.95rem",
  fontWeight: 600,
} satisfies CSSProperties;

const inputStyle = {
  appearance: "none",
  border: "1px solid rgba(148, 163, 184, 0.38)",
  borderRadius: "1rem",
  background: "white",
  color: "rgb(15 23 42)",
  fontSize: "1rem",
  padding: "0.9rem 1rem",
} satisfies CSSProperties;

const captionStyle = {
  color: "rgb(71 85 105)",
  fontSize: "0.92rem",
  lineHeight: 1.6,
} satisfies CSSProperties;

const errorStyle = {
  borderRadius: "1rem",
  border: "1px solid rgba(220, 38, 38, 0.16)",
  background: "rgba(254, 242, 242, 0.95)",
  color: "rgb(153 27 27)",
  padding: "0.9rem 1rem",
  lineHeight: 1.5,
} satisfies CSSProperties;

const noticeStyle = {
  borderRadius: "1rem",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(248,250,252,0.82)",
  color: "rgb(51 65 85)",
  lineHeight: 1.6,
  padding: "0.95rem 1rem",
} satisfies CSSProperties;

const primaryButtonStyle = {
  appearance: "none",
  border: 0,
  borderRadius: "999px",
  background: "linear-gradient(135deg, rgb(15 23 42), rgb(30 41 59))",
  color: "white",
  cursor: "pointer",
  fontSize: "1rem",
  fontWeight: 700,
  padding: "0.95rem 1.2rem",
} satisfies CSSProperties;

const secondaryButtonStyle = {
  appearance: "none",
  border: "1px solid rgba(148, 163, 184, 0.45)",
  borderRadius: "999px",
  background: "white",
  color: "rgb(15 23 42)",
  cursor: "pointer",
  fontSize: "0.95rem",
  fontWeight: 600,
  padding: "0.8rem 1rem",
} satisfies CSSProperties;
