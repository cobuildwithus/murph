"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  DiamondIcon,
  LoaderCircleIcon,
  PhoneIcon,
  SendIcon,
  SparkleIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { CheckoutButton } from "@/src/components/ui/checkout-button";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { cn } from "@/src/lib/utils";
import type { HostedAccessibleOnboardingStage } from "@/src/lib/hosted-onboarding/stage";
import type {
  HostedInviteStatusPayload,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";
import type { PrivyLinkedAccountLike } from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import { HostedLegalConsentCard } from "../legal/hosted-legal-consent-card";
import { ConnectTelegram } from "../settings/hosted-telegram-settings";

const MURPH_CONTACT_DOWNLOAD_FILENAME = "Murph.vcf";
const MURPH_GITHUB_URL = "https://github.com/cobuildwithus/murph";

interface JoinInvitePhoneVerificationPanelProps {
  awaitingInviteSessionResolution: boolean;
  inviteCode: string;
  phoneAuthTarget?: NonNullable<HostedInviteStatusPayload["invite"]>["phoneAuthTarget"] | null;
  phoneHint?: string | null;
  statusRefreshErrorMessage: string | null;
  statusRefreshRetryPending: boolean;
  verificationMode: NonNullable<HostedInviteStatusPayload["invite"]>["verificationMode"];
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
    <Alert className="border-sienna/20 bg-sienna/5 text-sienna">
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

type ContactMethod = "phone" | "telegram";

interface ContactMethodOption {
  icon: typeof PhoneIcon;
  label: string;
  subtitle: string;
  value: ContactMethod;
}

const CONTACT_METHOD_OPTIONS: readonly ContactMethodOption[] = [
  {
    icon: PhoneIcon,
    label: "Phone",
    subtitle: "iMessage + SMS",
    value: "phone",
  },
  {
    icon: SendIcon,
    label: "Telegram",
    subtitle: "Private messaging",
    value: "telegram",
  },
];

function JoinInvitePanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-border bg-card/80 p-6">
        {children}
      </div>
    </div>
  );
}

function ContactMethodPicker({
  options,
  value,
  onChange,
}: {
  options: readonly ContactMethodOption[];
  value: ContactMethod;
  onChange: (value: ContactMethod) => void;
}) {
  return (
    <div
      aria-label="Contact method"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {options.map((option) => (
        <ContactMethodCard
          key={option.value}
          active={value === option.value}
          icon={option.icon}
          label={option.label}
          subtitle={option.subtitle}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function ContactMethodCard({
  active,
  icon: Icon,
  label,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: typeof PhoneIcon;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-4 rounded-xl border p-5 text-left transition-colors",
        active
          ? "border-olive/25 bg-olive/[0.06]"
          : "border-border bg-card hover:border-olive/15",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          active ? "bg-olive/10 text-olive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span
        className={cn(
          "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full",
          active
            ? "bg-foreground text-background"
            : "border-2 border-muted-foreground/25",
        )}
      >
        {active ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : null}
      </span>
    </button>
  );
}

export function JoinInvitePhoneVerificationPanel({
  awaitingInviteSessionResolution,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  statusRefreshErrorMessage,
  statusRefreshRetryPending,
  verificationMode,
  onPhoneVerified,
  onRefreshStatus,
  onRetryStatusRefresh,
}: JoinInvitePhoneVerificationPanelProps) {
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
      <Alert className="border-amber/20 bg-cream/40">
        <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
        <AlertTitle>Checking your signup state</AlertTitle>
        <AlertDescription>
          One moment while we pick up your session.
        </AlertDescription>
      </Alert>
    );
  }

  const resolvedPhoneAuthTarget =
    verificationMode === "invite_phone"
      ? phoneAuthTarget
      : ({ kind: "manual" } as const);
  const resolvedPhoneHint =
    verificationMode === "invite_phone" ? phoneHint : null;

  return (
    <JoinInvitePanelCard>
      <HostedInvitePhoneAuth
        inviteCode={inviteCode}
        phoneAuthTarget={resolvedPhoneAuthTarget}
        phoneHint={resolvedPhoneHint}
        onSignOut={async () => {
          await onRefreshStatus();
        }}
        onCompleted={onPhoneVerified}
      />
    </JoinInvitePanelCard>
  );
}

export function JoinInviteLaunchLegalConsentPanel({
  onLaunchLegalConsentSatisfied,
}: {
  onLaunchLegalConsentSatisfied: () => Promise<void>;
}) {
  return (
    <HostedLegalConsentCard
      mode="compact"
      onAccepted={onLaunchLegalConsentSatisfied}
      onRequirementChange={(required) => {
        if (!required) {
          void onLaunchLegalConsentSatisfied();
        }
      }}
      preferredScope="launch.legal"
      source="join-invite-phone-verify"
    />
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
  const [contactMethod, setContactMethod] = useState<ContactMethod>("phone");

  return (
    <JoinInvitePanelCard>
      <ContactMethodPicker
        options={CONTACT_METHOD_OPTIONS}
        value={contactMethod}
        onChange={setContactMethod}
      />

      <div className="mt-6">
        {contactMethod === "phone" ? (
          <HostedPhoneAuth
            intent="link"
            onLinked={async () => {
              await onRefreshStatus();
            }}
          />
        ) : (
          <ConnectTelegram
            authenticated={authenticated}
            initialLinkedAccounts={initialLinkedAccounts}
            onSynced={async () => {
              await onRefreshStatus();
            }}
          />
        )}
      </div>
    </JoinInvitePanelCard>
  );
}

const FREE_FEATURES = [
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
  "More usage on latest OpenAI, Claude, Gemini models",
  "Longer experiment context",
  "Deeper outcome analysis",
  "Detailed biomarker deltas",
  "Richer protocol recommendations",
  "Early access to new features",
];

export function JoinInviteCheckoutPanel({
  billingReady,
  billingPlans,
  onCheckout,
  onCheckoutSuccess,
  onCheckoutError,
  onSelectBillingPlan,
}: {
  billingReady: boolean;
  billingPlans: HostedInviteStatusPayload["billing"]["plans"];
  onCheckout: (billingPlanCode: HostedBillingPlanCode) => Promise<void>;
  onCheckoutSuccess: () => void;
  onCheckoutError: (error: unknown) => void;
  onSelectBillingPlan: (billingPlanCode: HostedBillingPlanCode) => void;
}) {
  const pulsePlan = billingPlans.find((p) => p.code === "launch_monthly");
  const edgePlan = billingPlans.find((p) => p.code === "launch_edge_monthly");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
        {/* Free */}
        <PricingTierCard
          tier="free"
          name="Free"
          description="Open-source, self-hosted Murph."
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
              <span className="flex-1 text-center">View on GitHub</span>
              <ArrowRightIcon className="size-4 shrink-0" />
            </Button>
          }
        />

        {/* Pulse */}
        <PricingTierCard
          tier="go"
          name="Pulse"
          description="Private experiments for one person."
          price={pulsePlan ? `$${Math.round(pulsePlan.recurringAmountUsdCents / 100)}` : "$8"}
          priceUnit="/ month"
          features={PULSE_FEATURES}
          cta={
            <CheckoutButton
              onCheckout={async () => {
                if (!pulsePlan) return;
                onSelectBillingPlan(pulsePlan.code);
                await onCheckout(pulsePlan.code);
              }}
              onSuccess={onCheckoutSuccess}
              onError={onCheckoutError}
              disabled={!billingReady || !pulsePlan}
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
          price={edgePlan ? `$${Math.round(edgePlan.recurringAmountUsdCents / 100)}` : "$20"}
          priceUnit="/ month"
          features={EDGE_FEATURES}
          cta={
            <CheckoutButton
              onCheckout={async () => {
                if (!edgePlan) return;
                onSelectBillingPlan(edgePlan.code);
                await onCheckout(edgePlan.code);
              }}
              onSuccess={onCheckoutSuccess}
              onError={onCheckoutError}
              disabled={!billingReady || !edgePlan}
              size="lg"
              className="h-12 w-full rounded-full bg-foreground text-sm font-semibold text-background hover:bg-foreground/90"
              idleLabel={edgePlan ? "Get Edge" : "Coming soon"}
              idleAdornment={<ArrowRightIcon className="size-4" />}
            />
          }
        />
      </div>

      <div className="rounded-xl border border-border bg-background px-6 py-5 sm:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-0">
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
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-background px-7 pt-6 pb-8">
      <div className="flex items-center gap-3">
        <PricingDots tier={tier} />
        <h3 className="font-serif text-3xl font-normal tracking-tight text-foreground">
          {name}
        </h3>
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
                <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-olive/15">
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
        divider ? "lg:border-l lg:border-border lg:pl-6" : "",
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
  launchLegalConsentSatisfied,
  murphPhoneNumber,
  stage,
}: {
  launchLegalConsentSatisfied: boolean;
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

      {launchLegalConsentSatisfied ? (
        <JoinInviteMurphContactActions murphPhoneNumber={murphPhoneNumber} />
      ) : null}

      <div className="border-t border-amber/25 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          What Murph can help with
        </p>
        <div className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
            <div key={item.title} className="flex gap-3">
              <item.icon className="mt-0.5 size-4 shrink-0 text-olive-light" />
              <div>
                <p className="text-sm font-semibold text-foreground">
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
        className="h-auto w-fit p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
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
