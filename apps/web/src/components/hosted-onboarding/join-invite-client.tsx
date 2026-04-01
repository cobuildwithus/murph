"use client";

import { startTransition, useEffect, useState } from "react";

import type {
  AcceptHostedShareResult,
  HostedSharePageData,
  HostedSharePreview,
} from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { HostedPhoneAuth } from "./hosted-phone-auth";

interface JoinInviteClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  privyAppId: string | null;
  privyClientId?: string | null;
  shareCode: string | null;
  sharePreview: HostedSharePreview | null;
}

type JoinInviteShareImportState = "idle" | "processing" | "completed";

export function JoinInviteClient({
  initialStatus,
  inviteCode,
  privyAppId,
  privyClientId,
  shareCode,
  sharePreview,
}: JoinInviteClientProps) {
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "logout" | "share" | null>(null);
  const [shareImportState, setShareImportState] = useState<JoinInviteShareImportState>("idle");
  const phoneAuthReady = status.capabilities.phoneAuthReady && Boolean(privyAppId);

  const title = resolveTitle(status);
  const subtitle = resolveSubtitle(status);

  useEffect(() => {
    if (!shareCode || shareImportState !== "idle" || status.stage !== "active") {
      return;
    }

    void handleAcceptShare();
  }, [shareCode, shareImportState, status.stage]);

  useEffect(() => {
    if (!shareCode || shareImportState !== "processing") {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await requestHostedOnboardingJson<HostedSharePageData>({
          url: buildHostedShareStatusUrl({
            inviteCode,
            shareCode,
          }),
        });

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setShareImportState(resolveJoinInviteShareStateFromStatus(payload));
        });
      } catch {
        // Keep polling; transient status failures should not reset the pending state.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [inviteCode, shareCode, shareImportState]);

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
    if (!shareCode || shareImportState === "completed") {
      return;
    }

    setErrorMessage(null);
    setPendingAction("share");

    try {
      const payload = await requestHostedOnboardingJson<Pick<
        AcceptHostedShareResult,
        "alreadyImported" | "imported" | "pending"
      >>({
        payload: {},
        url: `/api/hosted-share/${encodeURIComponent(shareCode)}/accept`,
      });
      setShareImportState(resolveJoinInviteShareStateFromAccept(payload));
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
      <section className="rounded-lg bg-white p-6 shadow-sm md:p-8">
        <div className="space-y-3">
          <span className="inline-block rounded bg-olive/10 px-3.5 py-1.5 text-sm font-semibold text-olive">
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
            <div className="rounded border border-red-200 bg-red-50 p-4 text-sm leading-snug text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {sharePreview ? (
            <div className="space-y-1.5 rounded border border-green-200 bg-green-50 p-4 text-sm leading-snug">
              <strong className="text-green-800">Add after signup: {sharePreview.title}</strong>
              <p className="text-green-700">
                {[
                  sharePreview.counts.foods ? `${sharePreview.counts.foods} foods` : null,
                  sharePreview.counts.protocols ? `${sharePreview.counts.protocols} protocols` : null,
                  sharePreview.counts.recipes ? `${sharePreview.counts.recipes} recipes` : null,
                ].filter(Boolean).join(" · ")}
              </p>
              {sharePreview.protocolTitles.length > 0 ? (
                <p className="text-green-700">Protocols: {sharePreview.protocolTitles.join(", ")}</p>
              ) : null}
              {sharePreview.logMealAfterImport ? (
                <p className="text-green-600">Murph will also log the smoothie after import.</p>
              ) : null}
            </div>
          ) : null}

          {status.session.authenticated && !status.session.matchesInvite ? (
            <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p>
                This browser is currently signed in to a different hosted member. Continuing below will switch the
                browser session to {status.invite?.phoneHint ?? "this invite"}.
              </p>
              <button
                type="button"
                onClick={handleClearHostedSession}
                disabled={pendingAction !== null}
                className="rounded border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "logout" ? "Signing out..." : "Sign out current browser session"}
              </button>
            </div>
          ) : null}

          {(status.stage === "register" || status.stage === "authenticate") ? (
            phoneAuthReady && privyAppId ? (
              <div className="rounded border border-stone-200/60 bg-stone-50/60 p-5">
                <HostedPhoneAuth
                  inviteCode={inviteCode}
                  mode="invite"
                  onClearHostedSession={handleClearHostedSession}
                  onCompleted={handlePhoneVerified}
                  phoneHint={status.invite?.phoneHint ?? status.member?.phoneHint ?? null}
                  privyAppId={privyAppId}
                  privyClientId={privyClientId}
                />
              </div>
            ) : (
              <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-600">
                Phone signup is not configured for this environment yet.
              </div>
            )
          ) : null}

          {status.stage === "checkout" ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={pendingAction !== null || !status.capabilities.billingReady}
              className="rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "checkout"
                ? "Opening checkout..."
                : status.capabilities.billingReady
                  ? "Continue to Apple Pay"
                  : "Billing is not configured yet"}
            </button>
          ) : null}

          {status.stage === "active" ? (
            <div className="space-y-3 rounded border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-700">
              <p>
                Your hosted identity is active. Your phone-verified account and hosted session are all ready.
              </p>
              <a
                href="/settings"
                className="inline-flex rounded border border-green-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50"
              >
                Manage email settings
              </a>
              {sharePreview ? (
                shareImportState === "completed" ? (
                  <p>{sharePreview.title} has been added to this hosted vault.</p>
                ) : shareImportState === "processing" ? (
                  <p>{sharePreview.title} is being added to this hosted vault.</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleAcceptShare}
                    disabled={pendingAction !== null}
                    className="rounded bg-olive px-6 py-3 font-bold text-white transition-colors hover:bg-olive-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pendingAction === "share" ? "Adding shared bundle..." : `Add ${sharePreview.title}`}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-2.5 rounded border border-stone-200/60 bg-white/80 p-5 text-sm leading-relaxed text-stone-500">
        <strong className="text-stone-800">What happens here</strong>
        <p>1. We verify the phone number that received this invite.</p>
        <p>2. We create or reconnect your Murph account in Postgres.</p>
        <p>3. We finish account setup and set a hosted session cookie.</p>
        <p>4. We hand you off to checkout, then your hosted access turns active.</p>
      </section>
    </div>
  );
}

function resolveTitle(status: HostedInviteStatusPayload): string {
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
      return "Murph";
  }
}

function resolveSubtitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "Text the Murph number again and we\u2019ll send you a fresh hosted link.";
    case "expired":
      return "Text the Murph number again and we\u2019ll send you a fresh link.";
    case "register":
      return `Verify ${status.invite?.phoneHint ?? "your number"} by text, then we\u2019ll finish setup and hand you off to Apple Pay.`;
    case "authenticate":
      return `Continue with the verified phone already linked to ${status.invite?.phoneHint ?? "this number"}.`;
    case "checkout":
      return "Your phone is verified, setup is complete, and one more tap finishes hosted access.";
    case "active":
      return "Your hosted Murph access is active for this number.";
    default:
      return "Murph hosted onboarding";
  }
}

export function resolveJoinInviteShareStateFromAccept(
  payload: Pick<AcceptHostedShareResult, "alreadyImported" | "imported" | "pending">,
): JoinInviteShareImportState {
  if (payload.imported || payload.alreadyImported) {
    return "completed";
  }

  return payload.pending ? "processing" : "idle";
}

export function resolveJoinInviteShareStateFromStatus(
  data: HostedSharePageData,
): JoinInviteShareImportState {
  if (data.stage === "consumed" && data.share?.acceptedByCurrentMember) {
    return "completed";
  }

  if (data.stage === "processing" && data.share?.acceptedByCurrentMember) {
    return "processing";
  }

  return "idle";
}

function buildHostedShareStatusUrl(input: {
  inviteCode: string;
  shareCode: string;
}): string {
  const url = new URL(`/api/hosted-share/${encodeURIComponent(input.shareCode)}/status`, "https://join.example.test");
  url.searchParams.set("invite", input.inviteCode);
  return `${url.pathname}${url.search}`;
}
