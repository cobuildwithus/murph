"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowRightIcon,
  CheckIcon,
  PhoneIcon,
  SendIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import type {
  HostedBillingPlanCode,
  HostedPublicBillingCheckoutOffer,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import type {
  HostedInviteEmailAuthTarget,
  HostedInvitePhoneAuthTarget,
  HostedInviteVerificationMode,
} from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { cn } from "@/src/lib/utils";

import { HostedLegalConsentCard } from "../legal/hosted-legal-consent-card";
import { ConnectTelegram } from "../settings/hosted-telegram-settings";
import { requestHostedBillingCheckout } from "./client-api";
import { HostedEmailAuthButton } from "./hosted-email-auth-button";
import { logoutHostedAppSession } from "./hosted-app-session-client";
import { HostedInvitePhoneAuth } from "./hosted-invite-phone-auth";
import { HostedPhoneAuth } from "./hosted-phone-auth";
import { useHostedInviteStatusRefresh } from "./invite-status-client";
import type { JoinInviteTelegramAccountSeed } from "./join-invite-page-model";
import {
  shouldRefreshJoinInviteStatusFromPayload,
  type JoinInviteStatusRefreshSnapshot,
} from "./join-invite-state";

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

export function JoinInviteStatusRefreshIsland({
  current,
  disabled = false,
  inviteCode,
  legalGateActive,
}: {
  current: JoinInviteStatusRefreshSnapshot;
  disabled?: boolean;
  inviteCode: string;
  legalGateActive: boolean;
}) {
  const router = useRouter();
  const [refreshErrorMessage, setRefreshErrorMessage] = useState<string | null>(null);
  const pollingEligible = isHostedOnboardingPendingStage(current.stage);

  useHostedInviteStatusRefresh({
    disabled: disabled || legalGateActive || !pollingEligible,
    inviteCode,
    onError: (error) => {
      setRefreshErrorMessage(error instanceof Error ? error.message : String(error));
    },
    onStatus: (payload) => {
      setRefreshErrorMessage(null);
      const shouldRefresh = shouldRefreshJoinInviteStatusFromPayload({
        current,
        nextStatus: payload,
      });

      if (!shouldRefresh) {
        return;
      }

      router.refresh();
    },
    shouldPoll: pollingEligible && !legalGateActive,
  });

  if (!refreshErrorMessage) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTitle>Unable to refresh invite status</AlertTitle>
      <AlertDescription>{refreshErrorMessage}</AlertDescription>
      <div className="mt-3">
        <Button
          type="button"
          onClick={() => {
            setRefreshErrorMessage(null);
            router.refresh();
          }}
          variant="outline"
          size="lg"
        >
          Try again
        </Button>
      </div>
    </Alert>
  );
}

export function JoinInvitePhoneVerificationIsland({
  emailAuthTarget,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  verificationMode,
}: {
  emailAuthTarget?: HostedInviteEmailAuthTarget | null;
  inviteCode: string;
  phoneAuthTarget?: HostedInvitePhoneAuthTarget | null;
  phoneHint?: string | null;
  verificationMode: HostedInviteVerificationMode;
}) {
  const router = useRouter();
  const { logout } = usePrivy();
  if (verificationMode === "invite_email") {
    return (
      <HostedEmailAuthButton
        active
        inline
        initialEmailAddress={
          emailAuthTarget?.kind === "saved" ? emailAuthTarget.emailAddress : null
        }
        inviteCode={inviteCode}
        onCompleted={async () => {
          router.refresh();
        }}
      />
    );
  }

  const resolvedPhoneAuthTarget =
    verificationMode === "invite_phone"
      ? phoneAuthTarget
      : ({ kind: "manual" } as const);
  const resolvedPhoneHint = verificationMode === "invite_phone" ? phoneHint : null;

  return (
    <HostedInvitePhoneAuth
      inviteCode={inviteCode}
      phoneAuthTarget={resolvedPhoneAuthTarget}
      phoneHint={resolvedPhoneHint}
      onSignOut={async () => {
        await logoutHostedAppSession({ logoutPrivy: logout });
        router.refresh();
      }}
      onCompleted={() => {
        router.refresh();
      }}
    />
  );
}

export function JoinInviteSignOutButtonIsland() {
  const router = useRouter();
  const { logout } = usePrivy();
  const [signOutPending, setSignOutPending] = useState(false);

  async function handleSignOut() {
    setSignOutPending(true);

    try {
      await logoutHostedAppSession({ logoutPrivy: logout });
      router.refresh();
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

export function JoinInviteMessagingSetupIsland({
  authenticated,
  initialTelegramAccount,
}: {
  authenticated: boolean;
  initialTelegramAccount: JoinInviteTelegramAccountSeed | null;
}) {
  const router = useRouter();
  const [contactMethod, setContactMethod] = useState<ContactMethod>(
    initialTelegramAccount ? "telegram" : "phone",
  );

  return (
    <>
      <ContactMethodPicker
        options={CONTACT_METHOD_OPTIONS}
        value={contactMethod}
        onChange={setContactMethod}
      />

      <div className="mt-6">
        {contactMethod === "phone" ? (
          <HostedPhoneAuth
            intent="link"
            onLinked={() => {
              router.refresh();
            }}
          />
        ) : (
          <ConnectTelegram
            authenticated={authenticated}
            initialTelegramAccount={initialTelegramAccount}
            onSynced={() => {
              router.refresh();
            }}
          />
        )}
      </div>
    </>
  );
}

export function JoinInviteLegalConsentIsland({
  initialStatus,
}: {
  initialStatus: HostedConsentStatus | null;
}) {
  const router = useRouter();

  function refreshRoute() {
    router.refresh();
  }

  return (
    <HostedLegalConsentCard
      acceptedPendingLabel="Continuing..."
      initialStatus={initialStatus}
      mode="compact"
      onAccepted={refreshRoute}
      onRequirementChange={(required) => {
        if (!required) {
          refreshRoute();
        }
      }}
      preferredScope="launch.legal"
      source="join-invite-phone-verify"
    />
  );
}

export function JoinInviteRefreshButtonIsland({
  label = "Try again",
}: {
  label?: string;
}) {
  const router = useRouter();

  return (
    <Button type="button" onClick={() => router.refresh()} variant="outline" size="lg">
      {label}
    </Button>
  );
}

export function JoinInviteCheckoutPlanButtonIsland({
  billingReady,
  className,
  checkoutOffer,
  disabledLabel,
  idleLabel,
  inviteCode,
  planCode,
}: {
  billingReady: boolean;
  className?: string;
  checkoutOffer?: HostedPublicBillingCheckoutOffer | null;
  disabledLabel?: string;
  idleLabel: string;
  inviteCode: string;
  planCode: HostedBillingPlanCode | null;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const checkoutOutcomeRef = useRef<
    | { kind: "redirect"; url: string }
    | { kind: "alreadyActive" }
    | null
  >(null);

  async function startCheckout() {
    setErrorMessage(null);
    checkoutOutcomeRef.current = null;

    if (!planCode) {
      throw new Error("This plan is not available yet.");
    }

    const payload = await requestHostedBillingCheckout({
      billingPlanCode: planCode,
      ...(checkoutOffer ? { checkoutOffer } : {}),
      inviteCode,
    });

    if (payload.alreadyActive) {
      checkoutOutcomeRef.current = { kind: "alreadyActive" };
      return;
    }

    if (!payload.url) {
      throw new Error("Checkout did not return a redirect URL.");
    }

    checkoutOutcomeRef.current = { kind: "redirect", url: payload.url };
  }

  function handleCheckoutSuccess() {
    const outcome = checkoutOutcomeRef.current;
    checkoutOutcomeRef.current = null;
    if (!outcome) return;
    if (outcome.kind === "alreadyActive") {
      router.refresh();
      return;
    }

    window.location.assign(outcome.url);
  }

  function handleCheckoutError(error: unknown) {
    checkoutOutcomeRef.current = null;
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }

  return (
    <div className="space-y-3">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <PaymentButton
        onClick={startCheckout}
        onSuccess={handleCheckoutSuccess}
        onError={handleCheckoutError}
        disabled={!billingReady || !planCode}
        size="lg"
        className={className}
        idleLabel={billingReady && planCode ? idleLabel : disabledLabel ?? idleLabel}
        idleAdornment={<ArrowRightIcon className="size-4" />}
      />
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
      role="radiogroup"
    >
      {options.map((option) => (
        <ContactMethodCard
          key={option.value}
          active={value === option.value}
          icon={option.icon}
          label={option.label}
          name="join-contact-method"
          subtitle={option.subtitle}
          value={option.value}
          onChange={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function ContactMethodCard({
  active,
  icon: Icon,
  label,
  name,
  subtitle,
  value,
  onChange,
}: {
  active: boolean;
  icon: typeof PhoneIcon;
  label: string;
  name: string;
  subtitle: string;
  value: ContactMethod;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "relative flex w-full cursor-pointer items-start gap-4 rounded-xl border p-5 text-left transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
        active
          ? "border-olive/25 bg-olive/[0.06]"
          : "border-border bg-card hover:border-olive/15",
      )}
    >
      <input
        type="radio"
        checked={active}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        name={name}
        onChange={onChange}
        value={value}
      />
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
    </label>
  );
}
