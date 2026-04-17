"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import Link from "next/link";

import {
  CheckCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import type { HostedSharePreview } from "@/src/lib/hosted-share/service";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import type { JoinInviteShareImportState } from "./join-invite-state";
import { describeHostedSharePreview } from "../hosted-share/hosted-share-preview";
import { HostedPhoneSettings } from "../settings/hosted-phone-settings";
import { HostedTelegramSettings } from "../settings/hosted-telegram-settings";

const MURPH_CONTACT_DOWNLOAD_FILENAME = "Murph.vcf";

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
      <AlertTitle>This browser is signed in with a different Murph account.</AlertTitle>
      <AlertDescription>
        This browser is already signed in with a different Murph account. Sign out first to continue with this invite.
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
      <Alert className="border-[#c4a882]/20 bg-[#f5f0e8]/40">
        <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
        <AlertTitle>Checking your signup state</AlertTitle>
        <AlertDescription>One moment while we pick up your session.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-6 shadow-[0_1px_2px_rgba(45,52,54,0.04)]">
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
    <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
      <AlertTitle className="text-destructive">This account needs support.</AlertTitle>
      <AlertDescription className="text-destructive/85">
        This account can&apos;t continue from this invite right now. Contact support and we&apos;ll help restore
        access.
      </AlertDescription>
    </Alert>
  );
}

export function JoinInviteMessagingSetupPanel({
  authenticated,
  initialLinkedAccounts,
  onRefreshStatus,
}: {
  authenticated: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  onRefreshStatus: () => Promise<HostedInviteStatusPayload>;
}) {
  return (
    <div className="space-y-4">
      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <AlertTitle>Add a message channel before checkout</AlertTitle>
        <AlertDescription>
          Murph needs a phone number or Telegram connection before payment so the bot knows where to reach you right after signup.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-6 shadow-[0_1px_2px_rgba(45,52,54,0.04)]">
          <HostedPhoneSettings
            authenticated={authenticated}
            autoOpen
            initialLinkedAccounts={initialLinkedAccounts}
            onLinked={async () => {
              await onRefreshStatus();
            }}
          />
        </div>
        <div className="rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-6 shadow-[0_1px_2px_rgba(45,52,54,0.04)]">
          <HostedTelegramSettings
            authenticated={authenticated}
            initialLinkedAccounts={initialLinkedAccounts}
            onSynced={async () => {
              await onRefreshStatus();
            }}
          />
        </div>
      </div>
    </div>
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
          ? "Continue to checkout"
          : "Billing is not configured yet"}
    </Button>
  );
}

export function JoinInviteActivePanel({
  activationPending,
  murphPhoneNumber,
  pendingAction,
  shareImportState,
  sharePreview,
  onAcceptShare,
}: {
  activationPending: boolean;
  murphPhoneNumber: string | null;
  pendingAction: "checkout" | "share" | null;
  shareImportState: JoinInviteShareImportState;
  sharePreview: HostedSharePreview | null;
  onAcceptShare: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-8">
      {activationPending ? (
        <div className="flex items-start gap-3 text-sm text-olive">
          <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" />
          <div className="space-y-1">
            <p className="font-semibold">{JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelTitle}</p>
            <p className="leading-relaxed text-olive/85">{JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelDescription}</p>
            {sharePreview ? (
              <p className="leading-relaxed text-olive/85">{JOIN_INVITE_ACTIVATION_PENDING_COPY.shareImportDescription}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 text-sm text-olive">
          <CheckCircleIcon className="size-4 shrink-0" />
          <p className="leading-relaxed">
            Murph should reach out shortly. Just reply there to start chatting.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <JoinInviteMurphContactActions murphPhoneNumber={murphPhoneNumber} />
      </div>

      {sharePreview ? (
        <div>
          {shareImportState === "completed" ? (
            <p className="text-sm text-olive">{describeHostedSharePreview(sharePreview)} has been added to your account.</p>
          ) : shareImportState === "processing" ? (
            <p className="text-sm text-muted-foreground">{describeHostedSharePreview(sharePreview)} is being added to your account.</p>
          ) : (
            <Button type="button" onClick={onAcceptShare} disabled={pendingAction !== null} size="lg">
              {pendingAction === "share"
                ? "Adding shared bundle..."
                : `Add ${describeHostedSharePreview(sharePreview).toLowerCase()}`}
            </Button>
          )}
        </div>
      ) : null}

      <div className="border-t border-[#c4a882]/25 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          What Murph can help with
        </p>
        <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
            <div key={item.title} className="flex gap-3">
              <item.icon className="mt-0.5 size-4 shrink-0 text-olive-light" />
              <div>
                <p className="text-sm font-semibold text-[#2d3436]">{item.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Button
        render={<Link href="/settings" />}
        nativeButton={false}
        variant="link"
        size="sm"
        className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-[#2d3436]"
      >
        Manage settings
      </Button>
    </div>
  );
}

function JoinInviteMurphContactActions({
  murphPhoneNumber,
}: {
  murphPhoneNumber: string | null;
}) {
  if (!murphPhoneNumber) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
      <Button render={<a href={buildMurphSmsHref(murphPhoneNumber)} />} nativeButton={false} size="lg">
        Text Murph
      </Button>
      <Button
        render={<a download={MURPH_CONTACT_DOWNLOAD_FILENAME} href={buildMurphVcardHref(murphPhoneNumber)} />}
        nativeButton={false}
        variant="outline"
        size="lg"
      >
        Add Murph to Contacts
      </Button>
    </div>
  );
}

function buildMurphSmsHref(phoneNumber: string): string {
  return `sms:${phoneNumber}`;
}

function buildMurphVcardHref(phoneNumber: string): string {
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(buildMurphVcard(phoneNumber))}`;
}

function buildMurphVcard(phoneNumber: string): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Murph",
    `TEL;TYPE=CELL:${phoneNumber}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}
