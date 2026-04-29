"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import Link from "next/link";

import {
  ArrowRightIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  Code2Icon,
  LoaderCircleIcon,
  LockIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { CheckoutButton } from "@/src/components/ui/checkout-button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/src/components/ui/card";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedAccessibleOnboardingStage } from "@/src/lib/hosted-onboarding/stage";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import { HostedPhoneSettings } from "../settings/hosted-phone-settings";
import { HostedTelegramSettings } from "../settings/hosted-telegram-settings";

const MURPH_CONTACT_DOWNLOAD_FILENAME = "Murph.vcf";

interface JoinInviteVerificationPanelProps {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  phoneAuthTarget?: NonNullable<HostedInviteStatusPayload["invite"]>["phoneAuthTarget"] | null;
  phoneHint?: string | null;
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
      <AlertTitle>
        This browser is signed in with a different Murph account.
      </AlertTitle>
      <AlertDescription>
        This browser is already signed in with a different Murph account. Sign
        out first to continue with this invite.
      </AlertDescription>
      <div className="mt-3">
        <HostedInviteSignOutButton onSignOut={onSignOut} />
      </div>
    </Alert>
  );
}

function HostedInviteSignOutButton({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
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
    <Button
      type="button"
      onClick={handleSignOut}
      disabled={signOutPending}
      variant="outline"
      size="lg"
    >
      {signOutPending ? "Signing out..." : "Use this invite instead"}
    </Button>
  );
}

export function JoinInviteVerificationPanel({
  awaitingInviteSessionResolution,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
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
            We couldn&apos;t pick up your verified session yet. Check again to
            continue.
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
        <AlertDescription>
          One moment while we pick up your session.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-6 shadow-[0_1px_2px_rgba(45,52,54,0.04)]">
      <HostedInvitePhoneAuth
        inviteCode={inviteCode}
        phoneAuthTarget={phoneAuthTarget}
        phoneHint={phoneHint}
        onSignOut={async () => {
          await onRefreshStatus();
        }}
        onCompleted={onPhoneVerified}
      />
    </div>
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
    <div className="flex flex-col gap-4">
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
  );
}

export function JoinInviteCheckoutPanel({
  billingReady,
  billingPlanCode,
  billingPlans,
  onCheckout,
  onCheckoutSuccess,
  onCheckoutError,
  onSelectBillingPlan,
}: {
  billingReady: boolean;
  billingPlanCode: HostedBillingPlanCode | null;
  billingPlans: HostedInviteStatusPayload["billing"]["plans"];
  onCheckout: () => Promise<void>;
  onCheckoutSuccess: () => void;
  onCheckoutError: (error: unknown) => void;
  onSelectBillingPlan: (billingPlanCode: HostedBillingPlanCode) => void;
}) {
  const selectedBillingPlan =
    billingPlans.find((plan) => plan.code === billingPlanCode) ?? null;

  return (
    <div className="space-y-4">
      <Card className="gap-3 rounded-xl py-3 shadow-[0_24px_60px_-30px_rgba(26,31,22,0.18)] backdrop-blur-sm">
        <CardContent className="px-6 pt-2 pb-1 sm:px-8 sm:pt-4">
          <div className="space-y-2">
            <p className="font-serif text-2xl font-normal tracking-tight text-foreground">
              Choose your plan
            </p>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Private vault, every experiment, full before/after analysis.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {billingPlans.map((plan) => {
              const selected = plan.code === billingPlanCode;
              const [priceAmount, priceUnit] = splitRecurringSummary(
                plan.recurringSummary,
              );

              return (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => onSelectBillingPlan(plan.code)}
                  className={[
                    "rounded-2xl border px-5 py-5 text-left transition-all",
                    selected
                      ? "border-foreground/15 bg-olive-light/15 shadow-[0_2px_4px_rgba(26,31,22,0.05)]"
                      : "border-border bg-card hover:border-olive-light/40",
                  ].join(" ")}
                  aria-pressed={selected}
                >
                  <div className="flex h-7 items-center justify-between gap-3">
                    <p className="text-sm font-semibold leading-none text-foreground">
                      {plan.displayName}
                    </p>
                    {selected ? (
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                        <CheckIcon className="size-3.5" strokeWidth={2.5} />
                      </span>
                    ) : plan.badge ? (
                      <Badge
                        variant="secondary"
                        className="h-7 rounded-full bg-olive-light/20 px-2.5 font-mono text-[0.625rem] font-medium uppercase tracking-[0.14em] text-olive"
                      >
                        {plan.badge}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-baseline gap-0.5">
                    <span className="font-serif text-4xl font-normal leading-none tracking-tight text-foreground">
                      {priceAmount}
                    </span>
                    {priceUnit ? (
                      <span className="font-serif text-lg font-normal text-muted-foreground">
                        {priceUnit}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-full border border-border bg-card">
              <CalendarIcon className="size-3.5" />
            </span>
            <span className="leading-relaxed">
              {selectedBillingPlan
                ? `You’ll start on the ${selectedBillingPlan.displayName.toLowerCase()} plan.`
                : "Choose a plan to continue."}
            </span>
          </div>

          <CheckoutButton
            onCheckout={onCheckout}
            onSuccess={onCheckoutSuccess}
            onError={onCheckoutError}
            disabled={!billingReady || !billingPlanCode}
            size="lg"
            className="mt-4 h-16 w-full justify-between rounded-2xl bg-foreground px-7 text-[1.0625rem] font-semibold text-background hover:bg-foreground/90"
            idleLabel={billingReady ? "Continue to checkout" : "Billing is not configured yet"}
            idleAdornment={<ArrowRightIcon className="size-5" />}
          />
        </CardContent>

        <CardFooter className="border-t border-border bg-muted/40 px-6 py-4 sm:px-8">
          <ul className="flex w-full flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <CheckoutTrustItem icon={LockIcon} label="Private by default" />
            <CheckoutTrustItem icon={ShieldCheckIcon} label="No data sold, ever" />
            <CheckoutTrustItem icon={Code2Icon} label="Fully open source" />
          </ul>
        </CardFooter>
      </Card>
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden />
        <span>Secure checkout powered by Stripe</span>
      </div>
    </div>
  );
}

function CheckoutTrustItem({
  icon: Icon,
  label,
}: {
  icon: typeof LockIcon;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-full border border-border bg-card">
        <Icon className="size-3.5 text-olive-light" />
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </li>
  );
}

function splitRecurringSummary(summary: string): [string, string | null] {
  const match = summary.match(/^(.*?)(\/.+)$/);
  if (!match) {
    return [summary, null];
  }
  return [match[1].trim(), match[2]];
}

export function JoinInviteActivePanel({
  murphPhoneNumber,
  stage,
}: {
  murphPhoneNumber: string | null;
  stage: HostedAccessibleOnboardingStage;
}) {
  const activationPending = stage === "activating";

  return (
    <div className="flex flex-col gap-8">
      {activationPending ? (
        <div className="flex items-start gap-3 text-sm text-olive">
          <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" />
          <div className="space-y-1">
            <p className="font-semibold">
              {JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelTitle}
            </p>
            <p className="leading-relaxed text-olive/85">
              {JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelDescription}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 text-sm text-olive">
          <CheckCircleIcon className="size-4 shrink-0" />
          <p className="leading-relaxed">
            Murph will text you shortly. Reply to start.
          </p>
        </div>
      )}

      <JoinInviteMurphContactActions murphPhoneNumber={murphPhoneNumber} />

      <div className="border-t border-[#c4a882]/25 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          What Murph can help with
        </p>
        <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
            <div key={item.title} className="flex gap-3">
              <item.icon className="mt-0.5 size-4 shrink-0 text-olive-light" />
              <div>
                <p className="text-sm font-semibold text-[#2d3436]">
                  {item.title}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Button
        render={<Link href="/experiments" />}
        nativeButton={false}
        variant="link"
        size="sm"
        className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-[#2d3436]"
      >
        View experiments
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
      <Button
        render={<a href={buildMurphSmsHref(murphPhoneNumber)} />}
        nativeButton={false}
        size="lg"
      >
        Text Murph
      </Button>
      <Button
        render={
          <a
            download={MURPH_CONTACT_DOWNLOAD_FILENAME}
            href={buildMurphVcardHref(murphPhoneNumber)}
          />
        }
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
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(
    buildMurphVcard(phoneNumber)
  )}`;
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
