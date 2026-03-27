"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { HostedPhoneAuth } from "./hosted-phone-auth";

interface JoinInviteClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
}

export function JoinInviteClient({ initialStatus, inviteCode, shareCode, sharePreview }: JoinInviteClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "logout" | "share" | null>(null);
  const [shareImported, setShareImported] = useState(false);

  const title = useMemo(() => {
    switch (status.stage) {
      case "invalid":
        return "That invite link is not valid";
      case "expired":
        return "That invite link expired";
      case "register":
        return "Verify your phone";
      case "authenticate":
        return "Continue with your phone";
      case "checkout":
        return "Finish checkout";
      case "active":
        return "You're in";
      default:
        return "Healthy Bob";
    }
  }, [status.stage]);

  const subtitle = useMemo(() => {
    switch (status.stage) {
      case "invalid":
        return "Text the Healthy Bob number again and we'll send you a fresh hosted link.";
      case "expired":
        return "Text the Healthy Bob number again and we'll send you a fresh link.";
      case "register":
        return `Verify ${status.invite?.phoneHint ?? "your number"} by text, then we'll create your rewards wallet and hand you off to Apple Pay.`;
      case "authenticate":
        return `Continue with the verified phone already linked to ${status.invite?.phoneHint ?? "this number"}.`;
      case "checkout":
        return "Your phone is verified, your wallet is ready, and one more tap finishes hosted access.";
      case "active":
        return "Your hosted Healthy Bob access is active for this number.";
      default:
        return "Healthy Bob hosted onboarding";
    }
  }, [status.invite?.phoneHint, status.stage]);

  useEffect(() => {
    if (!shareCode || shareImported || status.stage !== "active") {
      return;
    }

    void handleAcceptShare();
  }, [shareCode, shareImported, status.stage]);

  async function refreshStatus(): Promise<HostedInviteStatusPayload> {
    const payload = await requestHostedOnboardingJson<HostedInviteStatusPayload>({
      url: `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/status`,
    });

    setStatus(payload);
    return payload;
  }

  async function handleCheckout() {
    setErrorMessage(null);
    setPendingAction("checkout");

    try {
      const payload = await requestHostedOnboardingJson<{ alreadyActive: boolean; url: string | null }>({
        payload: {
          inviteCode,
          shareCode,
        },
        url: "/api/hosted-onboarding/billing/checkout",
      });

      if (payload.alreadyActive) {
        await refreshStatus();
        return;
      }

      if (!payload.url) {
        throw new Error("Checkout did not return a redirect URL.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleAcceptShare() {
    if (!shareCode || shareImported) {
      return;
    }

    setErrorMessage(null);
    setPendingAction("share");

    try {
      await requestHostedOnboardingJson<{ imported: boolean; alreadyImported?: boolean }>({
        payload: {},
        url: `/api/hosted-share/${encodeURIComponent(shareCode)}/accept`,
      });
      setShareImported(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleClearHostedSession() {
    setErrorMessage(null);
    setPendingAction("logout");

    try {
      await requestHostedOnboardingJson<{ ok: true }>({
        payload: {},
        url: "/api/hosted-onboarding/session/logout",
      });
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      throw error;
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePhoneVerified(_: HostedPrivyCompletionPayload) {
    const nextStatus = await refreshStatus();

    if (nextStatus.stage === "checkout" && nextStatus.capabilities.billingReady) {
      await handleCheckout();
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "1.25rem",
      }}
    >
      <section
        style={{
          borderRadius: "1.5rem",
          background: "rgba(255,255,255,0.92)",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.12)",
          padding: "clamp(1.25rem, 4vw, 2rem)",
        }}
      >
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <span
            style={{
              display: "inline-flex",
              width: "fit-content",
              borderRadius: "999px",
              background: "rgba(15, 23, 42, 0.08)",
              padding: "0.35rem 0.75rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Hosted access for {status.invite?.phoneHint ?? "your number"}
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2rem, 6vw, 3.25rem)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
            }}
          >
            {title}
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: "34rem",
              color: "rgb(51 65 85)",
              fontSize: "1.05rem",
              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </p>
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "0.85rem",
          }}
        >
          {errorMessage ? (
            <div
              style={{
                borderRadius: "1rem",
                border: "1px solid rgba(220, 38, 38, 0.16)",
                background: "rgba(254, 242, 242, 0.95)",
                color: "rgb(153 27 27)",
                padding: "0.9rem 1rem",
                lineHeight: 1.5,
              }}
            >
              {errorMessage}
            </div>
          ) : null}

          {sharePreview ? (
            <div
              style={{
                borderRadius: "1rem",
                border: "1px solid rgba(59, 130, 246, 0.18)",
                background: "rgba(239, 246, 255, 0.9)",
                padding: "0.95rem 1rem",
                display: "grid",
                gap: "0.4rem",
                lineHeight: 1.5,
              }}
            >
              <strong>Add after signup: {sharePreview.title}</strong>
              <span>
                {[
                  sharePreview.counts.foods ? `${sharePreview.counts.foods} foods` : null,
                  sharePreview.counts.protocols ? `${sharePreview.counts.protocols} protocols` : null,
                  sharePreview.counts.recipes ? `${sharePreview.counts.recipes} recipes` : null,
                ].filter(Boolean).join(" · ")}
              </span>
              {sharePreview.protocolTitles.length > 0 ? (
                <span>Protocols: {sharePreview.protocolTitles.join(", ")}</span>
              ) : null}
              {sharePreview.logMealAfterImport ? (
                <span style={{ color: "rgb(2 132 199)" }}>Healthy Bob will also log the smoothie after import.</span>
              ) : null}
            </div>
          ) : null}

          {status.session.authenticated && !status.session.matchesInvite ? (
            <div
              style={{
                borderRadius: "1rem",
                border: "1px solid rgba(249, 115, 22, 0.18)",
                background: "rgba(255, 247, 237, 0.98)",
                color: "rgb(154 52 18)",
                padding: "0.95rem 1rem",
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <span>
                This browser is currently signed in to a different hosted member. Continuing below will switch the
                browser session to {status.invite?.phoneHint ?? "this invite"}.
              </span>
              <button
                type="button"
                onClick={handleClearHostedSession}
                disabled={pendingAction !== null}
                style={secondaryButtonStyle}
              >
                {pendingAction === "logout" ? "Signing out..." : "Sign out current browser session"}
              </button>
            </div>
          ) : null}

          {(status.stage === "register" || status.stage === "authenticate") ? (
            status.capabilities.phoneAuthReady ? (
              <div
                style={{
                  borderRadius: "1.25rem",
                  border: "1px solid rgba(148, 163, 184, 0.22)",
                  background: "rgba(248,250,252,0.82)",
                  padding: "1rem 1.05rem",
                }}
              >
                <HostedPhoneAuth
                  inviteCode={inviteCode}
                  mode="invite"
                  onClearHostedSession={handleClearHostedSession}
                  onCompleted={handlePhoneVerified}
                  phoneHint={status.invite?.phoneHint ?? status.member?.phoneHint ?? null}
                />
              </div>
            ) : (
              <div style={noticeStyle}>Phone signup is not configured for this environment yet.</div>
            )
          ) : null}

          {status.stage === "checkout" ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={pendingAction !== null || !status.capabilities.billingReady}
              style={primaryButtonStyle}
            >
              {pendingAction === "checkout"
                ? "Opening checkout..."
                : status.capabilities.billingReady
                  ? "Continue to Apple Pay"
                  : "Billing is not configured yet"}
            </button>
          ) : null}

          {status.stage === "active" ? (
            <div
              style={{
                borderRadius: "1rem",
                border: "1px solid rgba(34, 197, 94, 0.18)",
                background: "rgba(240, 253, 244, 0.98)",
                color: "rgb(21 128 61)",
                padding: "1rem 1.05rem",
                lineHeight: 1.6,
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <span>
                Your hosted identity is active. Your phone-verified account, rewards wallet, and hosted session are all ready.
              </span>
              {sharePreview ? (
                shareImported ? (
                  <span>{sharePreview.title} has been added to this hosted vault.</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptShare}
                    disabled={pendingAction !== null}
                    style={primaryButtonStyle}
                  >
                    {pendingAction === "share" ? "Adding shared bundle..." : `Add ${sharePreview.title}`}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section
        style={{
          borderRadius: "1.25rem",
          border: "1px solid rgba(148, 163, 184, 0.22)",
          background: "rgba(248,250,252,0.8)",
          padding: "1rem 1.1rem",
          display: "grid",
          gap: "0.6rem",
          color: "rgb(71 85 105)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "rgb(15 23 42)" }}>What happens here</strong>
        <span>1. We verify the phone number that received this invite.</span>
        <span>2. We create or reconnect your Healthy Bob account in Postgres.</span>
        <span>3. We provision or reuse your self-custodial rewards wallet and set a hosted session cookie.</span>
        <span>4. We hand you off to checkout, then your hosted access turns active.</span>
      </section>
    </div>
  );
}

const primaryButtonStyle: CSSProperties = {
  appearance: "none",
  border: 0,
  borderRadius: "999px",
  background: "linear-gradient(135deg, rgb(15 23 42), rgb(30 41 59))",
  color: "white",
  cursor: "pointer",
  fontSize: "1rem",
  fontWeight: 700,
  padding: "0.95rem 1.2rem",
};

const secondaryButtonStyle: CSSProperties = {
  appearance: "none",
  border: "1px solid rgba(148, 163, 184, 0.45)",
  borderRadius: "999px",
  background: "white",
  color: "rgb(15 23 42)",
  cursor: "pointer",
  fontSize: "0.95rem",
  fontWeight: 600,
  padding: "0.8rem 1rem",
};

const noticeStyle: CSSProperties = {
  borderRadius: "1rem",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(248,250,252,0.82)",
  color: "rgb(51 65 85)",
  lineHeight: 1.6,
  padding: "0.95rem 1rem",
};
