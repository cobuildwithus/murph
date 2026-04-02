"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { startTransition, useEffect, useState } from "react";

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
  const { authenticated, logout, ready } = usePrivy();
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

  useEffect(() => {
    if (!ready || !authenticated) {
      return;
    }

    void refreshStatus().catch(() => null);
  }, [authenticated, ready]);

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

  async function handlePhoneVerified() {
    const nextStatus = await refreshStatus();

    if (nextStatus.stage === "checkout" && nextStatus.capabilities.billingReady) {
      await handleCheckout();
    }
  }

  return (
    <div className="space-y-5">
      <Card className="shadow-sm">
        <CardHeader className="gap-3">
          <Badge variant="secondary" className="w-fit">
            Invite for {status.invite?.phoneHint ?? "your number"}
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
              <AlertTitle>Add after signup: {sharePreview.title}</AlertTitle>
              <AlertDescription className="text-green-700">
                {[
                  sharePreview.counts.foods ? `${sharePreview.counts.foods} foods` : null,
                  sharePreview.counts.protocols ? `${sharePreview.counts.protocols} protocols` : null,
                  sharePreview.counts.recipes ? `${sharePreview.counts.recipes} recipes` : null,
                ].filter(Boolean).join(" · ")}
              </AlertDescription>
              {sharePreview.protocolTitles.length > 0 ? (
                <AlertDescription className="text-green-700">
                  Protocols: {sharePreview.protocolTitles.join(", ")}
                </AlertDescription>
              ) : null}
              {sharePreview.logMealAfterImport ? (
                <AlertDescription className="text-green-700">
                  Murph will also log the smoothie after import.
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}

          {status.session.authenticated && !status.session.matchesInvite ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>This browser is signed in with a different number.</AlertTitle>
              <AlertDescription>
                This browser is already signed in with a different number. Sign out first to continue with{" "}
                {status.invite?.phoneHint ?? "this invite"}.
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

          {(status.stage === "register" || status.stage === "authenticate") ? (
            phoneAuthReady && privyAppId ? (
              <div className="rounded-xl border border-stone-200/60 bg-stone-50/60 p-5">
                <HostedPhoneAuth
                  inviteCode={inviteCode}
                  mode="invite"
                  onSignOut={async () => {
                    await refreshStatus();
                  }}
                  onCompleted={handlePhoneVerified}
                  phoneHint={status.invite?.phoneHint ?? status.member?.phoneHint ?? null}
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

          {status.stage === "active" ? (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <AlertTitle>Your hosted identity is active.</AlertTitle>
              <AlertDescription>
                Your hosted identity is active. Your phone-verified account is ready to use.
              </AlertDescription>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button render={<Link href="/settings" />} nativeButton={false} variant="outline" size="lg">
                  Manage email settings
                </Button>
                {sharePreview ? (
                  shareImportState === "completed" ? (
                    <p>{sharePreview.title} has been added to this hosted vault.</p>
                  ) : shareImportState === "processing" ? (
                    <p>{sharePreview.title} is being added to this hosted vault.</p>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleAcceptShare}
                      disabled={pendingAction !== null}
                      size="lg"
                    >
                      {pendingAction === "share" ? "Adding shared bundle..." : `Add ${sharePreview.title}`}
                    </Button>
                  )
                ) : null}
              </div>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-stone-200/60 bg-white/80">
        <CardHeader>
          <CardTitle className="text-base text-stone-800">What happens next</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm leading-relaxed text-stone-500">
          <p>1. Confirm the phone number from your invite.</p>
          <p>2. Finish setting up your Murph account.</p>
          <p>3. Complete checkout.</p>
          <p>4. Start using Murph.</p>
        </CardContent>
      </Card>
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
      return "Finish joining Murph";
    case "authenticate":
      return "Keep going";
    case "checkout":
      return "One last step";
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
      return `Use ${status.invite?.phoneHint ?? "your number"} to claim this invite and finish joining Murph.`;
    case "authenticate":
      return `You already started with ${status.invite?.phoneHint ?? "this number"}. Keep going and we’ll finish the rest.`;
    case "checkout":
      return "Your phone is confirmed. Finish checkout to start using Murph.";
    case "active":
      return "Your Murph account is ready.";
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

function buildHostedShareStatusUrl(input: {
  inviteCode: string;
  shareCode: string;
}): string {
  const url = new URL(`/api/hosted-share/${encodeURIComponent(input.shareCode)}/status`, "https://join.example.test");
  url.searchParams.set("invite", input.inviteCode);
  return `${url.pathname}${url.search}`;
}
