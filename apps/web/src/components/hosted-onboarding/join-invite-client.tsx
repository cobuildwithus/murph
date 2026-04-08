"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useState } from "react";

import {
  ActivityIcon,
  CheckCircleIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  MoonIcon,
  UtensilsIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type {
  AcceptHostedShareResult,
  HostedSharePageData,
  HostedSharePreview,
} from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { fetchHostedInviteStatus, useHostedInviteStatusRefresh } from "./invite-status-client";

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
  const { authenticated, logout, ready } = usePrivy();
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"checkout" | "logout" | "share" | null>(null);
  const [shareImportState, setShareImportState] = useState<JoinInviteShareImportState>("idle");
  const [statusRefreshErrorMessage, setStatusRefreshErrorMessage] = useState<string | null>(null);
  const [statusRefreshRetryPending, setStatusRefreshRetryPending] = useState(false);
  const phoneAuthReady = status.capabilities.phoneAuthReady && Boolean(privyAppId);
  const sharePreviewSummary = sharePreview ? formatHostedSharePreviewSummary(sharePreview) : null;
  const awaitingInviteSessionResolution = shouldAwaitHostedInviteSessionResolution({
    authenticated,
    ready,
    status,
  });

  const title = resolveTitle(status);
  const subtitle = resolveSubtitle(status);
  const acceptShareEffect = useEffectEvent(() => {
    void handleAcceptShare();
  });

  useEffect(() => {
    if (!shareCode || shareImportState !== "idle" || status.stage !== "active") {
      return;
    }

    acceptShareEffect();
  }, [shareCode, shareImportState, status.stage]);

  useEffect(() => {
    if (!shareCode || shareImportState !== "processing") {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await requestHostedOnboardingJson<HostedSharePageData>({
          auth: "optional",
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

  useHostedInviteStatusRefresh({
    authenticated,
    inviteCode,
    onError: (error: unknown) => {
      setStatusRefreshErrorMessage(
        error instanceof Error ? error.message : "We could not refresh your signup state.",
      );
    },
    onStatus: (payload) => {
      setStatus(payload);
      setStatusRefreshErrorMessage(null);
    },
    ready,
    sessionAuthenticated: status.session.authenticated,
    shouldPoll: status.stage === "activating",
  });

  async function refreshStatus(): Promise<HostedInviteStatusPayload> {
    const payload = await fetchHostedInviteStatus(inviteCode);
    setStatus(payload);
    setStatusRefreshErrorMessage(null);
    return payload;
  }

  async function handleRetryStatusRefresh() {
    setStatusRefreshErrorMessage(null);
    setStatusRefreshRetryPending(true);

    try {
      await refreshStatus();
    } catch (error) {
      setStatusRefreshErrorMessage(
        error instanceof Error ? error.message : "We could not refresh your signup state.",
      );
    } finally {
      setStatusRefreshRetryPending(false);
    }
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

  async function handleSignOut() {
    setErrorMessage(null);
    setPendingAction("logout");

    try {
      if (authenticated) {
        await logout();
      }
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      throw error;
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePhoneVerified(payload: HostedPrivyCompletionPayload) {
    const nextStatus = resolveInviteStatusAfterPrivyCompletion(status, payload);
    setStatus(nextStatus);

    if (payload.stage === "checkout" && nextStatus.capabilities.billingReady) {
      await handleCheckout();
    }
  }

  return (
    <div className="space-y-5">
      <Card className="shadow-sm">
        <CardHeader className="gap-3">
          <Badge variant="secondary" className="w-fit">
            Text signup
          </Badge>
          <div className="space-y-3">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              {title}
            </CardTitle>
            <CardDescription className="max-w-lg text-lg leading-relaxed text-stone-500">
              {subtitle}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to continue</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {sharePreview ? (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <AlertTitle>Add after signup: {describeHostedSharePreview(sharePreview)}</AlertTitle>
              {sharePreviewSummary ? (
                <AlertDescription className="text-green-700">
                  {sharePreviewSummary}
                </AlertDescription>
              ) : null}
              {sharePreview.logMealAfterImport ? (
                <AlertDescription className="text-green-700">
                  Murph will also log the shared food after import.
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}

          {status.session.authenticated && !status.session.matchesInvite ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>This browser is signed in with a different number.</AlertTitle>
              <AlertDescription>
                This browser is already signed in with a different number. Sign out first to continue with this invite.
              </AlertDescription>
              <div className="mt-3">
                <Button
                  type="button"
                  onClick={handleSignOut}
                  disabled={pendingAction !== null}
                  variant="outline"
                  size="lg"
                >
                  {pendingAction === "logout" ? "Signing out..." : "Use this invite instead"}
                </Button>
              </div>
            </Alert>
          ) : null}

          {status.stage === "verify" ? (
            awaitingInviteSessionResolution ? (
              statusRefreshErrorMessage ? (
                <Alert variant="destructive">
                  <AlertTitle>Unable to refresh your signup state</AlertTitle>
                  <AlertDescription>
                    We couldn&apos;t pick up your verified phone session yet. Check again to continue.
                  </AlertDescription>
                  <div className="mt-3">
                    <Button
                      type="button"
                      onClick={handleRetryStatusRefresh}
                      disabled={statusRefreshRetryPending}
                      size="lg"
                      variant="outline"
                    >
                      {statusRefreshRetryPending ? "Checking..." : "Check again"}
                    </Button>
                  </div>
                </Alert>
              ) : (
                <Alert className="border-stone-200 bg-stone-50">
                  <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
                  <AlertTitle>Checking your signup state</AlertTitle>
                  <AlertDescription>
                    One moment while we pick up your verified phone session.
                  </AlertDescription>
                </Alert>
              )
            ) : phoneAuthReady && privyAppId ? (
              <div className="rounded-xl border border-stone-200/60 bg-stone-50/60 p-5">
                <HostedPhoneAuth
                  inviteCode={inviteCode}
                  mode="invite"
                  onSignOut={async () => {
                    await refreshStatus();
                  }}
                  onCompleted={handlePhoneVerified}
                  privyAppId={privyAppId}
                  privyClientId={privyClientId}
                  wrapProvider={false}
                />
              </div>
            ) : (
              <Alert className="border-stone-200 bg-stone-50">
                <AlertTitle>Phone signup is unavailable</AlertTitle>
                <AlertDescription>
                  Phone signup is not configured for this environment yet.
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {status.stage === "blocked" ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>This hosted account needs support.</AlertTitle>
              <AlertDescription>
                This hosted account cannot continue from this invite right now. Contact support to restore access.
              </AlertDescription>
            </Alert>
          ) : null}

          {status.stage === "checkout" ? (
            <Button
              type="button"
              onClick={handleCheckout}
              disabled={pendingAction !== null || !status.capabilities.billingReady}
              size="lg"
            >
              {pendingAction === "checkout"
                ? "Opening checkout..."
                : status.capabilities.billingReady
                  ? "Continue to Apple Pay"
                  : "Billing is not configured yet"}
            </Button>
          ) : null}

          {status.stage === "activating" ? (
            <div className="rounded-xl border border-olive/20 bg-olive/5 px-5 py-4 text-olive">
              <div className="flex items-start gap-3">
                <LoaderCircleIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Payment received. We&apos;re setting up your account.</p>
                  <p className="text-sm leading-relaxed">
                    Keep this page open. Murph is finishing hosted activation now and will switch you through as soon
                    as it&apos;s ready.
                  </p>
                  {sharePreview ? (
                    <p className="text-sm leading-relaxed">
                      We&apos;ll add your shared bundle after setup finishes.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {status.stage === "active" ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3 rounded-xl border border-olive/20 bg-olive/5 px-5 py-4">
                <CheckCircleIcon className="h-6 w-6 shrink-0 text-olive" />
                <p className="text-sm leading-relaxed text-olive">
                  You should receive a text message from Murph shortly. Just reply to start chatting.
                </p>
              </div>

              <div>
                <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
                  Things Murph can help with
                </p>
                <div className="grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-2">
                  {[
                    { icon: UtensilsIcon, title: "Log meals & nutrition", body: "Text what you ate and Murph tracks it automatically." },
                    { icon: MoonIcon, title: "Track sleep & recovery", body: "Syncs with Oura, WHOOP, and Garmin in the background." },
                    { icon: MessageCircleIcon, title: "Ask health questions", body: "Plain-English answers grounded in your own data." },
                    { icon: ActivityIcon, title: "Spot patterns", body: "Connects how you eat, sleep, and move to show what works." },
                  ].map((item) => (
                    <div key={item.title} className="flex gap-3 bg-white p-5">
                      <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-olive-light" />
                      <div>
                        <p className="text-sm font-semibold text-stone-900">{item.title}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-stone-400">{item.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {sharePreview ? (
                <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-green-800">
                  {shareImportState === "completed" ? (
                    <p className="text-sm">{describeHostedSharePreview(sharePreview)} has been added to your account.</p>
                  ) : shareImportState === "processing" ? (
                    <p className="text-sm">{describeHostedSharePreview(sharePreview)} is being added to your account.</p>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleAcceptShare}
                      disabled={pendingAction !== null}
                      size="lg"
                    >
                      {pendingAction === "share" ? "Adding shared bundle..." : `Add ${describeHostedSharePreview(sharePreview).toLowerCase()}`}
                    </Button>
                  )}
                </div>
              ) : null}

              <Button render={<Link href="/settings" />} nativeButton={false} variant="outline" size="lg">
                Manage settings
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}

export function resolveInviteStatusAfterPrivyCompletion(
  status: HostedInviteStatusPayload,
  payload: HostedPrivyCompletionPayload,
): HostedInviteStatusPayload {
  return {
    ...status,
    session: {
      ...status.session,
      authenticated: true,
      matchesInvite: true,
    },
    stage: payload.stage,
  };
}

export function shouldAwaitHostedInviteSessionResolution(input: {
  authenticated: boolean;
  ready: boolean;
  status: HostedInviteStatusPayload;
}): boolean {
  if (input.status.stage !== "verify" || input.status.session.authenticated) {
    return false;
  }

  if (!input.ready) {
    return true;
  }

  return input.authenticated;
}

function resolveTitle(status: HostedInviteStatusPayload): string {
  switch (status.stage) {
    case "invalid":
      return "That invite link is not valid";
    case "expired":
      return "That invite link expired";
    case "verify":
      return "Finish joining Murph";
    case "checkout":
      return "One last step";
    case "activating":
      return "We’re setting up your account";
    case "blocked":
      return "This account is blocked";
    case "active":
      return "Welcome to Murph";
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
    case "verify":
      return "Verify the number that messaged Murph to finish joining.";
    case "checkout":
      return "Your phone is confirmed. Finish checkout to start using Murph.";
    case "activating":
      return "Your payment went through. Murph is finishing hosted activation now.";
    case "blocked":
      return "This hosted account cannot continue from the invite right now. Contact support to restore access.";
    case "active":
      return "Congrats, you\u2019re all set. Here\u2019s what to expect next.";
    default:
      return "Murph signup";
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

function formatHostedSharePreviewSummary(preview: HostedSharePreview): string {
  return [
    preview.counts.foods ? formatHostedSharePreviewCount(preview.counts.foods, "food") : null,
    preview.counts.protocols ? formatHostedSharePreviewCount(preview.counts.protocols, "protocol") : null,
    preview.counts.recipes ? formatHostedSharePreviewCount(preview.counts.recipes, "recipe") : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function describeHostedSharePreview(preview: HostedSharePreview): string {
  if (preview.kinds.length === 0) {
    return "Shared bundle";
  }

  if (preview.kinds.length === 1) {
    return `Shared ${preview.kinds[0]} bundle`;
  }

  return "Shared bundle";
}

function formatHostedSharePreviewCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function buildHostedShareStatusUrl(input: {
  inviteCode: string;
  shareCode: string;
}): string {
  const url = new URL(`/api/hosted-share/${encodeURIComponent(input.shareCode)}/status`, "https://join.example.test");
  url.searchParams.set("invite", input.inviteCode);
  return `${url.pathname}${url.search}`;
}
