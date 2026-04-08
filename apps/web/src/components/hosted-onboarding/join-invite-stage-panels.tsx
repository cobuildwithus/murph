"use client";

import Link from "next/link";

import {
  CheckCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

import { HostedPhoneAuth } from "./hosted-phone-auth";
import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import type { JoinInviteShareImportState } from "./join-invite-state";
import { describeHostedSharePreview } from "../hosted-share/hosted-share-preview";

interface JoinInviteVerificationPanelProps {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  phoneAuthReady: boolean;
  privyAppId: string | null;
  privyClientId?: string | null;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  onPhoneVerified: (payload: HostedPrivyCompletionPayload) => Promise<void>;
  onRefreshStatus: () => Promise<HostedInviteStatusPayload>;
  onRetryStatusRefresh: () => Promise<void>;
}

export function JoinInviteSignedInMismatchAlert({
  pendingAction,
  onSignOut,
}: {
  pendingAction: "checkout" | "logout" | "share" | null;
  onSignOut: () => Promise<void>;
}) {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900">
      <AlertTitle>This browser is signed in with a different number.</AlertTitle>
      <AlertDescription>
        This browser is already signed in with a different number. Sign out first to continue with this invite.
      </AlertDescription>
      <div className="mt-3">
        <Button type="button" onClick={onSignOut} disabled={pendingAction !== null} variant="outline" size="lg">
          {pendingAction === "logout" ? "Signing out..." : "Use this invite instead"}
        </Button>
      </div>
    </Alert>
  );
}

export function JoinInviteVerificationPanel({
  awaitingInviteSessionResolution,
  inviteCode,
  phoneAuthReady,
  privyAppId,
  privyClientId,
  statusRefreshErrorMessage,
  statusRefreshRetryPending,
  onPhoneVerified,
  onRefreshStatus,
  onRetryStatusRefresh,
}: JoinInviteVerificationPanelProps) {
  if (awaitingInviteSessionResolution) {
    if (statusRefreshErrorMessage) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Unable to refresh your signup state</AlertTitle>
          <AlertDescription>
            We couldn&apos;t pick up your verified phone session yet. Check again to continue.
          </AlertDescription>
          <div className="mt-3">
            <Button
              type="button"
              onClick={onRetryStatusRefresh}
              disabled={statusRefreshRetryPending}
              size="lg"
              variant="outline"
            >
              {statusRefreshRetryPending ? "Checking..." : "Check again"}
            </Button>
          </div>
        </Alert>
      );
    }

    return (
      <Alert className="border-stone-200 bg-stone-50">
        <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
        <AlertTitle>Checking your signup state</AlertTitle>
        <AlertDescription>One moment while we pick up your verified phone session.</AlertDescription>
      </Alert>
    );
  }

  if (phoneAuthReady && privyAppId) {
    return (
      <div className="rounded-xl border border-stone-200/60 bg-stone-50/60 p-5">
        <HostedPhoneAuth
          inviteCode={inviteCode}
          mode="invite"
          onSignOut={async () => {
            await onRefreshStatus();
          }}
          onCompleted={onPhoneVerified}
          privyAppId={privyAppId}
          privyClientId={privyClientId}
          wrapProvider={false}
        />
      </div>
    );
  }

  return (
    <Alert className="border-stone-200 bg-stone-50">
      <AlertTitle>Phone signup is unavailable</AlertTitle>
      <AlertDescription>Phone signup is not configured for this environment yet.</AlertDescription>
    </Alert>
  );
}

export function JoinInviteBlockedAlert() {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900">
      <AlertTitle>This hosted account needs support.</AlertTitle>
      <AlertDescription>
        This hosted account cannot continue from this invite right now. Contact support to restore access.
      </AlertDescription>
    </Alert>
  );
}

export function JoinInviteCheckoutButton({
  billingReady,
  pendingAction,
  onCheckout,
}: {
  billingReady: boolean;
  pendingAction: "checkout" | "logout" | "share" | null;
  onCheckout: () => Promise<void>;
}) {
  return (
    <Button type="button" onClick={onCheckout} disabled={pendingAction !== null || !billingReady} size="lg">
      {pendingAction === "checkout"
        ? "Opening checkout..."
        : billingReady
          ? "Continue to Apple Pay"
          : "Billing is not configured yet"}
    </Button>
  );
}

export function JoinInviteActivatingPanel({ sharePreview }: { sharePreview: HostedSharePreview | null }) {
  return (
    <div className="rounded-xl border border-olive/20 bg-olive/5 px-5 py-4 text-olive">
      <div className="flex items-start gap-3">
        <LoaderCircleIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Payment received. We&apos;re setting up your account.</p>
          <p className="text-sm leading-relaxed">
            Keep this page open. Murph is finishing hosted activation now and will switch you through as soon as it&apos;s
            ready.
          </p>
          {sharePreview ? (
            <p className="text-sm leading-relaxed">We&apos;ll add your shared bundle after setup finishes.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function JoinInviteActivePanel({
  pendingAction,
  shareImportState,
  sharePreview,
  onAcceptShare,
}: {
  pendingAction: "checkout" | "logout" | "share" | null;
  shareImportState: JoinInviteShareImportState;
  sharePreview: HostedSharePreview | null;
  onAcceptShare: () => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl border border-olive/20 bg-olive/5 px-5 py-4">
        <CheckCircleIcon className="h-6 w-6 shrink-0 text-olive" />
        <p className="text-sm leading-relaxed text-olive">
          You should receive a text message from Murph shortly. Just reply to start chatting.
        </p>
      </div>

      <div>
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">Things Murph can help with</p>
        <div className="grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-2">
          {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
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
            <Button type="button" onClick={onAcceptShare} disabled={pendingAction !== null} size="lg">
              {pendingAction === "share"
                ? "Adding shared bundle..."
                : `Add ${describeHostedSharePreview(sharePreview).toLowerCase()}`}
            </Button>
          )}
        </div>
      ) : null}

      <Button render={<Link href="/settings" />} nativeButton={false} variant="outline" size="lg">
        Manage settings
      </Button>
    </div>
  );
}
