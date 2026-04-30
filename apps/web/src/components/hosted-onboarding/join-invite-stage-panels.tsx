"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import Link from "next/link";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  DiamondIcon,
  LoaderCircleIcon,
  SparkleIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { CheckoutButton } from "@/src/components/ui/checkout-button";
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
import { HostedLegalConsentCard } from "../legal/hosted-legal-consent-card";
import { HostedPhoneSettings } from "../settings/hosted-phone-settings";
import { HostedTelegramSettings } from "../settings/hosted-telegram-settings";

const MURPH_CONTACT_DOWNLOAD_FILENAME = "Murph.vcf";
const MURPH_GITHUB_URL = "https://github.com/cobuildwithus/murph";

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

const FREE_FEATURES = [
  "Full product — no paywall",
  "Bring your own API keys",
  "Self-host or run locally",
  "Own your data, export anytime",
  "Community-supported setup",
];

const PULSE_FEATURES = [
  "Everything in Free and:",
  "Access to frontier models",
  "Wearable data sync",
  "Before/after outcome cards",
  "Chat via iMessage, Telegram, or email",
  "Guided experiment setup",
];

const EDGE_FEATURES = [
  "Everything in Pulse and:",
  "3x AI usage across all models",
  "Always the best model available",
  "Deeper outcome analysis",
  "Detailed biomarker deltas",
  "Richer protocol recommendations",
  "Early access to new features",
];

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
  const monthlyPlan = billingPlans.find((p) => p.interval === "month");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Free */}
        <PricingTierCard
          tier="free"
          name="Free"
          description="Full product, your keys, your data."
          price="$0"
          priceUnit="/ month"
          features={FREE_FEATURES}
          cta={
            <Button
              size="lg"
              className="h-12 w-full rounded-full bg-foreground text-sm font-semibold text-background hover:bg-foreground/90"
              render={
                <Link
                  href={MURPH_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <span className="flex-1 text-center">Open Source</span>
              <ArrowRightIcon className="size-4 shrink-0" />
            </Button>
          }
        />

        {/* Pulse */}
        <PricingTierCard
          tier="go"
          name="Pulse"
          description="Private experiments for one person."
          price={monthlyPlan ? `$${Math.round(monthlyPlan.recurringAmountUsdCents / 100)}` : "$8"}
          priceUnit="/ month"
          features={PULSE_FEATURES}
          cta={
            <CheckoutButton
              onCheckout={async () => {
                if (monthlyPlan) onSelectBillingPlan(monthlyPlan.code);
                await onCheckout();
              }}
              onSuccess={onCheckoutSuccess}
              onError={onCheckoutError}
              disabled={!billingReady}
              size="lg"
              className="h-12 w-full rounded-full bg-foreground text-sm font-semibold text-background hover:bg-foreground/90"
              idleLabel="Get Pulse"
              idleAdornment={<ArrowRightIcon className="size-4" />}
            />
          }
        />

        {/* Edge */}
        <PricingTierCard
          tier="plus"
          name="Edge"
          description="More guidance and deeper research."
          price="$20"
          priceUnit="/ month"
          features={EDGE_FEATURES}
          cta={
            <Button
              size="lg"
              className="h-12 w-full rounded-full bg-foreground text-sm font-semibold text-background hover:bg-foreground/90"
              render={
                <Link href="mailto:support@withmurph.ai?subject=Murph Plus" />
              }
            >
              <span className="flex-1 text-center">Get Edge</span>
              <ArrowRightIcon className="size-4 shrink-0" />
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-border bg-background px-6 py-5 sm:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <CheckoutTrustItem
            icon={LockIcon}
            label="Private by default"
            sublabel="Your data stays yours."
          />
          <CheckoutTrustItem
            icon={ShieldCheckIcon}
            label="No data sold"
            sublabel="Ever. That’s our promise."
            divider
          />
          <CheckoutTrustItem
            icon={RefreshCwIcon}
            label="Full data access"
            sublabel="Export or delete anytime."
            divider
          />
        </div>
      </div>
    </div>
  );
}

function PricingTierCard({
  name,
  description,
  price,
  priceUnit,
  features,
  cta,
  tier,
}: {
  name: string;
  description: string;
  price: string;
  priceUnit: string;
  features: readonly string[];
  cta: React.ReactNode;
  tier: "free" | "go" | "plus";
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-background px-7 pt-6 pb-8">
      <div className="flex items-center gap-3">
        <PricingDots tier={tier} />
        <p className="font-serif text-3xl font-normal tracking-tight text-foreground">
          {name}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      <div className="mt-6 border-t border-border pt-6">
        <div className="flex items-baseline gap-1">
          <span className="font-serif text-5xl font-normal leading-none tracking-tight text-foreground">
            {price}
          </span>
          <span className="text-sm text-muted-foreground">{priceUnit}</span>
        </div>
      </div>

      <div className="mt-6">{cta}</div>

      <ul className="mt-6 flex flex-col gap-3">
        {features.map((feature, i) => (
          <li key={feature} className="text-sm">
            {i === 0 && feature.endsWith(":") ? (
              <div className="flex flex-col gap-3">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  {tier === "plus" ? (
                    <DiamondIcon className="size-4 text-olive" />
                  ) : (
                    <SparkleIcon className="size-4 text-olive" />
                  )}
                  {feature}
                </span>
                <hr className="border-border" />
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-olive/15">
                  <CheckIcon className="size-3 text-olive" strokeWidth={2.5} />
                </span>
                <span className="text-foreground">{feature}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingDots({ tier }: { tier: "free" | "go" | "plus" }) {
  if (tier === "free") {
    return (
      <svg width="28" height="28" viewBox="0 0 44 44" fill="none" aria-hidden>
        <circle cx="7" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.35} />
        <circle cx="17" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="27" cy="6" r="2" fill="#c4956a" fillOpacity={0.3} />
        <circle cx="37" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="7" cy="16" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="16" r="2" fill="#c4956a" fillOpacity={0.4} />
        <circle cx="27" cy="16" r="2.5" fill="#c4956a" fillOpacity={0.5} />
        <circle cx="37" cy="16" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="7" cy="27" r="2" fill="#c4956a" fillOpacity={0.3} />
        <circle cx="17" cy="27" r="2.5" fill="#c4956a" fillOpacity={0.45} />
        <circle cx="27" cy="27" r="2" fill="#b5c4a1" fillOpacity={0.35} />
        <circle cx="37" cy="27" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="7" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="27" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="37" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.35} />
      </svg>
    );
  }

  if (tier === "go") {
    return (
      <svg width="24" height="24" viewBox="0 0 44 44" fill="none" aria-hidden>
        <circle cx="7" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="27" cy="6" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="37" cy="6" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="7" cy="16" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="16" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="27" cy="16" r="3" fill="#a07a4e" />
        <circle cx="37" cy="16" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="7" cy="27" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="27" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="27" cy="27" r="3.5" fill="#8b6840" />
        <circle cx="37" cy="27" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="7" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="17" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
        <circle cx="27" cy="38" r="2.5" fill="#c4956a" fillOpacity={0.55} />
        <circle cx="37" cy="38" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      </svg>
    );
  }

  return (
    <svg width="28" height="28" viewBox="0 0 65 44" fill="none" aria-hidden>
      <circle cx="6.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="16.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="27" cy="5.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="38" cy="5.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="48.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="58.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="4.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="14.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="26" cy="15.5" r="3.5" fill="#a07a4e" />
      <circle cx="39" cy="15.5" r="3.5" fill="#a07a4e" />
      <circle cx="50.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="60.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="2" cy="27.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="12.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="25" cy="27.5" r="4" fill="#8b6840" />
      <circle cx="39.5" cy="27.5" r="4.5" fill="#8b6840" />
      <circle cx="52.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="63" cy="27.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="6.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="16.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="27" cy="38.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="38" cy="38.5" r="2.5" fill="#c4956a" fillOpacity={0.55} />
      <circle cx="48.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
      <circle cx="58.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity={0.3} />
    </svg>
  );
}

function CheckoutTrustItem({
  icon: Icon,
  label,
  sublabel,
  divider,
}: {
  icon: typeof LockIcon;
  label: string;
  sublabel: string;
  divider?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center gap-3 py-1",
        divider ? "sm:border-l sm:border-border sm:pl-6" : "",
      ].join(" ")}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
        <Icon className="size-[18px] text-muted-foreground" />
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
    </div>
  );
}

export function JoinInviteActivePanel({
  murphPhoneNumber,
  stage,
}: {
  murphPhoneNumber: string | null;
  stage: HostedAccessibleOnboardingStage;
}) {
  const activationPending = stage === "activating";
  const [legalConsentRequired, setLegalConsentRequired] = useState(true);

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

      <HostedLegalConsentCard
        mode="panel"
        onRequirementChange={setLegalConsentRequired}
        preferredScope="launch.required"
        source="join-invite-active"
      />

      {!legalConsentRequired ? (
        <JoinInviteMurphContactActions murphPhoneNumber={murphPhoneNumber} />
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
