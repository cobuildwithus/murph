"use client";

import { useEffect, useMemo, useState } from "react";

import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { HostedPhoneAuth } from "./hosted-phone-auth";

interface JoinInviteClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  privyAppId: string | null;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
}

export function JoinInviteClient({
  initialStatus,
  inviteCode,
  privyAppId,
  shareCode,
  sharePreview,
}: JoinInviteClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "logout" | "share" | null>(null);
  const [shareImported, setShareImported] = useState(false);
  const phoneAuthReady = status.capabilities.phoneAuthReady && Boolean(privyAppId);

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
        return "You\u2019re in";
      default:
        return "Healthy Bob";
    }
  }, [status.stage]);

  const subtitle = useMemo(() => {
    switch (status.stage) {
      case "invalid":
        return "Text the Healthy Bob number again and we\u2019ll send you a fresh hosted link.";
      case "expired":
        return "Text the Healthy Bob number again and we\u2019ll send you a fresh link.";
      case "register":
        return `Verify ${status.invite?.phoneHint ?? "your number"} by text, then we\u2019ll create your rewards wallet and hand you off to Apple Pay.`;
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
    <div className="space-y-5">
      <section className="rounded-3xl bg-white p-6 shadow-sm md:p-8">
        <div className="space-y-3">
          <span className="inline-block rounded-full bg-green-50 px-3.5 py-1.5 text-sm font-semibold text-green-700">
            Hosted access for {status.invite?.phoneHint ?? "your number"}
          </span>
          <h1 className="text-4xl font-bold leading-none tracking-tight text-stone-900 md:text-5xl">
            {title}
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-stone-500">
            {subtitle}
          </p>
        </div>

        <div className="mt-6 space-y-4">
          {errorMessage ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {sharePreview ? (
            <div className="space-y-1.5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm leading-snug">
              <strong className="text-green-800">Add after signup: {sharePreview.title}</strong>
              <p className="text-green-700">
                {[
                  sharePreview.counts.foods ? `${sharePreview.counts.foods} foods` : null,
                  sharePreview.counts.protocols ? `${sharePreview.counts.protocols} protocols` : null,
                  sharePreview.counts.recipes ? `${sharePreview.counts.recipes} recipes` : null,
                ].filter(Boolean).join(" \u00B7 ")}
              </p>
              {sharePreview.protocolTitles.length > 0 ? (
                <p className="text-green-700">Protocols: {sharePreview.protocolTitles.join(", ")}</p>
              ) : null}
              {sharePreview.logMealAfterImport ? (
                <p className="text-green-600">Healthy Bob will also log the smoothie after import.</p>
              ) : null}
            </div>
          ) : null}

          {status.session.authenticated && !status.session.matchesInvite ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p>
                This browser is currently signed in to a different hosted member. Continuing below will switch the
                browser session to {status.invite?.phoneHint ?? "this invite"}.
              </p>
              <button
                type="button"
                onClick={handleClearHostedSession}
                disabled={pendingAction !== null}
                className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "logout" ? "Signing out..." : "Sign out current browser session"}
              </button>
            </div>
          ) : null}

          {(status.stage === "register" || status.stage === "authenticate") ? (
            phoneAuthReady && privyAppId ? (
              <div className="rounded-2xl border border-stone-200/60 bg-stone-50/60 p-5">
                <HostedPhoneAuth
                  inviteCode={inviteCode}
                  mode="invite"
                  onClearHostedSession={handleClearHostedSession}
                  onCompleted={handlePhoneVerified}
                  phoneHint={status.invite?.phoneHint ?? status.member?.phoneHint ?? null}
                  privyAppId={privyAppId}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
                Phone signup is not configured for this environment yet.
              </div>
            )
          ) : null}

          {status.stage === "checkout" ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={pendingAction !== null || !status.capabilities.billingReady}
              className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "checkout"
                ? "Opening checkout..."
                : status.capabilities.billingReady
                  ? "Continue to Apple Pay"
                  : "Billing is not configured yet"}
            </button>
          ) : null}

          {status.stage === "active" ? (
            <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-700">
              <p>
                Your hosted identity is active. Your phone-verified account, rewards wallet, and hosted session are all ready.
              </p>
              {sharePreview ? (
                shareImported ? (
                  <p>{sharePreview.title} has been added to this hosted vault.</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptShare}
                    disabled={pendingAction !== null}
                    className="rounded-full bg-green-700 px-6 py-3 font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === "share" ? "Adding shared bundle..." : `Add ${sharePreview.title}`}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-2.5 rounded-2xl border border-stone-200/60 bg-white/80 p-5 text-sm leading-relaxed text-stone-500">
        <strong className="text-stone-800">What happens here</strong>
        <p>1. We verify the phone number that received this invite.</p>
        <p>2. We create or reconnect your Healthy Bob account in Postgres.</p>
        <p>3. We provision or reuse your self-custodial rewards wallet and set a hosted session cookie.</p>
        <p>4. We hand you off to checkout, then your hosted access turns active.</p>
      </section>
    </div>
  );
}
