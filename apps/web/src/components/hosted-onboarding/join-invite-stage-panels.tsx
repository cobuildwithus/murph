"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
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

import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import type { JoinInviteShareImportState } from "./join-invite-state";
import { describeHostedSharePreview } from "../hosted-share/hosted-share-preview";

const MESSAGES_APP_HREF = "sms:";

interface JoinInviteVerificationPanelProps {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  onPhoneVerified: (payload: HostedPrivyCompletionPayload) => Promise<void>;
  onRefreshStatus: () => Promise<HostedInviteStatusPayload>;
  onRetryStatusRefresh: () => Promise<void>;
}

export function JoinInviteSignedInMismatchAlert({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900">
      <AlertTitle>This browser is signed in with a different number.</AlertTitle>
      <AlertDescription>
        This browser is already signed in with a different number. Sign out first to continue with this invite.
      </AlertDescription>
      <div className="mt-3">
        <HostedInviteSignOutButton onSignOut={onSignOut} />
      </div>
    </Alert>
  );
}

function HostedInviteSignOutButton({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { logout } = usePrivy();
  const [signOutPending, setSignOutPending] = useState(false);

  async function handleSignOut() {
    setSignOutPending(true);

    try {
      await logout();
      await onSignOut();
    } finally {
      setSignOutPending(false);
    }
  }

  return (
    <Button type="button" onClick={handleSignOut} disabled={signOutPending} variant="outline" size="lg">
      {signOutPending ? "Signing out..." : "Use this invite instead"}
    </Button>
  );
}

export function JoinInviteVerificationPanel({
  awaitingInviteSessionResolution,
  inviteCode,
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
            We couldn&apos;t pick up your verified session yet. Check again to continue.
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
        <AlertDescription>One moment while we pick up your session.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200/60 bg-stone-50/60 p-5">
      <HostedInvitePhoneAuth
        inviteCode={inviteCode}
        onSignOut={async () => {
          await onRefreshStatus();
        }}
        onCompleted={onPhoneVerified}
      />
    </div>
  );
}

export function JoinInviteBlockedAlert() {
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900">
      <AlertTitle>This account needs support.</AlertTitle>
      <AlertDescription>
        This account can&apos;t continue from this invite right now. Contact support and we&apos;ll help restore
        access.
      </AlertDescription>
    </Alert>
  );
}

export function JoinInviteCheckoutButton({
  billingReady,
  checkoutPending,
  onCheckout,
}: {
  billingReady: boolean;
  checkoutPending: boolean;
  onCheckout: () => Promise<void>;
}) {
  return (
    <Button type="button" onClick={onCheckout} disabled={checkoutPending || !billingReady} size="lg">
      {checkoutPending
        ? "Opening checkout..."
        : billingReady
          ? "Continue to Apple Pay"
          : "Billing is not configured yet"}
    </Button>
  );
}

export function JoinInviteActivePanel({
  activationPending,
  pendingAction,
  shareImportState,
  sharePreview,
  onAcceptShare,
}: {
  activationPending: boolean;
  pendingAction: "checkout" | "share" | null;
  shareImportState: JoinInviteShareImportState;
  sharePreview: HostedSharePreview | null;
  onAcceptShare: () => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      {activationPending ? (
        <div className="flex items-start gap-3 rounded-xl border border-olive/20 bg-olive/5 px-5 py-4 text-olive">
          <LoaderCircleIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">{JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelTitle}</p>
            <p className="text-sm leading-relaxed">{JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelDescription}</p>
            {sharePreview ? (
              <p className="text-sm leading-relaxed">{JOIN_INVITE_ACTIVATION_PENDING_COPY.shareImportDescription}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-olive/20 bg-olive/5 px-5 py-4">
          <CheckCircleIcon className="h-6 w-6 shrink-0 text-olive" />
          <p className="text-sm leading-relaxed text-olive">
            You should receive a text message from Murph shortly. Just reply to start chatting.
          </p>
        </div>
      )}

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

      <div className="flex flex-col items-start gap-3">
        <Button render={<a href={MESSAGES_APP_HREF} />} nativeButton={false} size="lg">
          Open Messages
        </Button>
        <Button
          render={<Link href="/settings" />}
          nativeButton={false}
          variant="link"
          size="sm"
          className="h-auto p-0 text-sm font-medium text-stone-500 hover:text-stone-900"
        >
          Manage settings
        </Button>
      </div>
    </div>
  );
}
