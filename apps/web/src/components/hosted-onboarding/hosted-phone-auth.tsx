"use client";

import {
  getIdentityToken,
  useCreateWallet,
  useLoginWithSms,
  usePrivy,
} from "@privy-io/react-auth";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyWalletAccount,
  parseHostedPrivyIdentityToken,
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
  const { createWallet } = useCreateWallet();
  const { loginWithCode, sendCode } = useLoginWithSms();
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

      try {
        const identityToken = await requireHostedPrivyIdentityToken();
        const linkedAccounts = parseHostedPrivyIdentityToken(identityToken).linkedAccounts;

        if (!extractHostedPrivyPhoneAccount(linkedAccounts)) {
          if (!cancelled) {
            setAuthenticatedSessionIssue(
              "Your current Privy session is missing a verified phone number. Sign out and continue with SMS.",
            );
          }
          return;
        }

        if (!cancelled) {
          setAuthenticatedSessionIssue(null);
        }
      } catch {
        if (!cancelled) {
          setAuthenticatedSessionIssue(
            "Your current Privy session is missing a verified phone number. Sign out and continue with SMS.",
          );
        }
      } finally {
        if (!cancelled) {
          setCheckingAuthenticatedSession(false);
        }
      }
    }

    void inspectAuthenticatedSession();

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready]);

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
        createWallet,
        inviteCode,
        onCompleted,
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
              ? "Checking the current Privy session for a verified phone number."
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
  createWallet: () => Promise<unknown>;
  inviteCode?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
}) {
  const identityToken = await ensureHostedPrivyWalletIdentityToken(input.createWallet);
  const payload = await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
    payload: {
      identityToken,
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    },
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

async function ensureHostedPrivyWalletIdentityToken(createWallet: () => Promise<unknown>): Promise<string> {
  let identityToken = await requireHostedPrivyIdentityToken();
  let linkedAccounts = parseHostedPrivyIdentityToken(identityToken).linkedAccounts;
  const phoneAccount = extractHostedPrivyPhoneAccount(linkedAccounts);

  if (!phoneAccount) {
    throw new Error("This Privy session is missing a verified phone number.");
  }

  let walletAccount = extractHostedPrivyWalletAccount(linkedAccounts, "ethereum");

  if (!walletAccount) {
    await createWallet();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      identityToken = await requireHostedPrivyIdentityToken();
      linkedAccounts = parseHostedPrivyIdentityToken(identityToken).linkedAccounts;
      walletAccount = extractHostedPrivyWalletAccount(linkedAccounts, "ethereum");

      if (walletAccount) {
        break;
      }

      await sleep(250 * (attempt + 1));
    }
  }

  if (!walletAccount) {
    throw new Error("We could not finish creating your rewards wallet.");
  }

  return identityToken;
}

async function requireHostedPrivyIdentityToken(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const identityToken = await getIdentityToken();

    if (identityToken) {
      return identityToken;
    }

    await sleep(150 * (attempt + 1));
  }

  throw new Error("Your Privy session is missing an identity token. Refresh and try again.");
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
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
