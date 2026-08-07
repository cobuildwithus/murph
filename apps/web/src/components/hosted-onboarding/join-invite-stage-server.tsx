import Link from "next/link";
import type { ReactNode } from "react";
import {
  CheckCircleIcon,
  CheckIcon,
  DiamondIcon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparkleIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PlanVisual } from "@/src/components/ui/plan-visual";
import { ConsentSkeleton } from "@/src/components/legal/hosted-legal-consent-card";
import { MurphAddToContactsButton } from "@/src/components/murph/murph-contact-card-picker";
import { HostedFamilyStartButton } from "@/src/components/settings/hosted-family-start-button";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import {
  HOSTED_FAMILY_PLAN_DISPLAY,
  HOSTED_PULSE_TRIAL_DAYS,
  isHostedAutoPulseTrialEnabled,
  isHostedPulseTrialCheckoutEnabled,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  JOIN_EDGE_FEATURES,
  JOIN_FAMILY_FEATURES,
  JOIN_PULSE_FEATURES,
  PULSE_TRIAL_FEATURES,
} from "@/src/lib/hosted-onboarding/plan-features";
import type { HostedFamilyBillingRecoveryState } from "@/src/lib/hosted-onboarding/family-plan";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedAccessibleOnboardingStage } from "@/src/lib/hosted-onboarding/stage";

import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
import { JoinInviteAutoTrialIsland } from "./join-invite-auto-trial-island";
import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import type {
  JoinInvitePageModel,
  JoinInviteTelegramAccountSeed,
} from "./join-invite-page-model";
import {
  JoinInviteCheckoutPlanButtonIsland,
  JoinInviteLegalConsentIsland,
  JoinInviteMessagingSetupIsland,
  JoinInvitePhoneVerificationIsland,
  JoinInviteRefreshButtonIsland,
  JoinInviteSignOutButtonIsland,
} from "./join-invite-islands";

const MURPH_GITHUB_URL = "https://github.com/cobuildwithus/murph";

export function JoinInviteStageServer({ model }: { model: JoinInvitePageModel }) {
  const { status } = model;
  const autoPulseTrialReady = isJoinInviteAutoPulseTrialReady(
    status,
    model.familyBillingRecovery,
  );

  return (
    <>
      {status.session.authenticated && !status.session.matchesInvite ? (
        <JoinInviteSignedInMismatchAlert />
      ) : null}

      {model.launchConsent.gateActive ? (
        <JoinInviteLaunchLegalConsentPanel model={model} />
      ) : null}

      {!model.launchConsent.gateActive && status.stage === "verify" ? (
        <JoinInvitePhoneVerificationPanel
          awaitingInviteSessionResolution={model.awaitingInviteSessionResolution}
          emailAuthTarget={status.invite?.emailAuthTarget ?? null}
          inviteCode={model.inviteCode}
          phoneAuthTarget={status.invite?.phoneAuthTarget ?? null}
          phoneHint={status.invite?.phoneHint ?? null}
          verificationMode={status.invite?.verificationMode ?? "manual_phone"}
        />
      ) : null}

      {!model.launchConsent.gateActive && status.stage === "blocked" ? (
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Email support to restore access.
          </p>
          <ContactSupportAction
            body={[
              "Hi Murph support,",
              "",
              "I need help restoring access to my Murph account.",
              "",
              "Context: Invite or hosted account is blocked.",
            ].join("\n")}
            className="w-full sm:w-fit"
            subject="Murph account support"
          />
        </div>
      ) : null}

      {!model.launchConsent.gateActive
      && status.stage === "checkout"
      && model.familyBillingRecovery === "checkout" ? (
        <JoinInviteFamilyCheckoutContinuationPanel />
      ) : null}

      {!model.launchConsent.gateActive
      && status.stage === "checkout"
      && model.familyBillingRecovery === "syncing" ? (
        <JoinInviteFamilyBillingSyncPanel />
      ) : null}

      {!model.launchConsent.gateActive && status.stage === "checkout" && autoPulseTrialReady ? (
        <JoinInviteAutoTrialIsland inviteCode={model.inviteCode} />
      ) : null}

      {!model.launchConsent.gateActive
      && status.stage === "checkout"
      && model.familyBillingRecovery !== "checkout"
      && model.familyBillingRecovery !== "syncing"
      && !autoPulseTrialReady
      && status.messagingSetupRequired ? (
        <JoinInviteMessagingSetupPanel
          authenticated={status.session.authenticated}
          expectedPrivyUserId={model.expectedPrivyUserId}
          initialTelegramAccount={model.telegramAccountForMessagingSetup}
          privySessionMatchesAppSession={model.privySessionMatchesAppSession}
        />
      ) : null}

      {!model.launchConsent.gateActive
      && status.stage === "checkout"
      && model.familyBillingRecovery !== "checkout"
      && model.familyBillingRecovery !== "syncing"
      && !autoPulseTrialReady
      && !status.messagingSetupRequired ? (
        <JoinInviteCheckoutPanel
          billingReady={status.capabilities.billingReady}
          billingPlans={status.billing.plans}
          familyBillingRecovery={model.familyBillingRecovery}
          inviteCode={model.inviteCode}
        />
      ) : null}

      {!model.launchConsent.gateActive && isHostedOnboardingAccessibleStage(status.stage) ? (
        <JoinInviteActivePanel
          launchLegalConsentSatisfied={model.launchConsent.status === "granted" || model.preview}
          murphPhoneNumber={status.murphPhoneNumber ?? null}
          stage={status.stage}
          telegramStartLink={
            status.telegramStartRequired ? buildHostedTelegramBotLink() : null
          }
        />
      ) : null}
    </>
  );
}

export function isJoinInviteAutoPulseTrialReady(
  status: HostedInviteStatusPayload,
  familyBillingRecovery: HostedFamilyBillingRecoveryState | null = null,
): boolean {
  return isHostedAutoPulseTrialEnabled() &&
    familyBillingRecovery === null &&
    status.capabilities.billingReady &&
    !status.messagingSetupRequired &&
    status.billing.plans.some((plan) => plan.code === "launch_monthly");
}

function JoinInviteSignedInMismatchAlert() {
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
        <JoinInviteSignOutButtonIsland />
      </div>
    </Alert>
  );
}

function JoinInvitePanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-border bg-card/80 p-6">
        {children}
      </div>
    </div>
  );
}

function JoinInvitePhoneVerificationPanel({
  awaitingInviteSessionResolution,
  emailAuthTarget,
  inviteCode,
  phoneAuthTarget,
  phoneHint,
  verificationMode,
}: {
  awaitingInviteSessionResolution: boolean;
  emailAuthTarget: NonNullable<HostedInviteStatusPayload["invite"]>["emailAuthTarget"] | null;
  inviteCode: string;
  phoneAuthTarget: NonNullable<HostedInviteStatusPayload["invite"]>["phoneAuthTarget"] | null;
  phoneHint: string | null;
  verificationMode: NonNullable<HostedInviteStatusPayload["invite"]>["verificationMode"];
}) {
  if (awaitingInviteSessionResolution) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className="rounded-2xl border border-border bg-card p-6"
      >
        <ConsentSkeleton />
      </div>
    );
  }

  return (
    <JoinInvitePanelCard>
      <JoinInvitePhoneVerificationIsland
        emailAuthTarget={emailAuthTarget}
        inviteCode={inviteCode}
        phoneAuthTarget={phoneAuthTarget}
        phoneHint={phoneHint}
        verificationMode={verificationMode}
      />
    </JoinInvitePanelCard>
  );
}

function JoinInviteLaunchLegalConsentPanel({
  model,
}: {
  model: JoinInvitePageModel;
}) {
  if (model.launchConsent.status === "error") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Unable to load Murph legal consent</AlertTitle>
          <AlertDescription>
            {model.launchConsent.errorMessage ?? "Could not load Murph legal consent right now."}
          </AlertDescription>
        </Alert>
        <JoinInviteRefreshButtonIsland />
      </div>
    );
  }

  return (
    <JoinInviteLegalConsentIsland initialStatus={model.launchConsent.initialStatus} />
  );
}

function JoinInviteMessagingSetupPanel({
  authenticated,
  expectedPrivyUserId,
  initialTelegramAccount,
  privySessionMatchesAppSession,
}: {
  authenticated: boolean;
  expectedPrivyUserId: string | null;
  initialTelegramAccount: JoinInviteTelegramAccountSeed | null;
  privySessionMatchesAppSession: boolean;
}) {
  return (
    <JoinInvitePanelCard>
      <JoinInviteMessagingSetupIsland
        authenticated={authenticated}
        expectedPrivyUserId={expectedPrivyUserId}
        initialTelegramAccount={initialTelegramAccount}
        privySessionMatchesAppSession={privySessionMatchesAppSession}
      />
    </JoinInvitePanelCard>
  );
}

export function JoinInviteCheckoutPanel({
  billingReady,
  billingPlans,
  familyBillingRecovery = null,
  inviteCode,
}: {
  billingReady: boolean;
  billingPlans: HostedInviteStatusPayload["billing"]["plans"];
  familyBillingRecovery?: HostedFamilyBillingRecoveryState | null;
  inviteCode: string;
}) {
  const pulsePlan = billingPlans.find((p) => p.code === "launch_monthly") ?? null;
  const edgePlan = billingPlans.find((p) => p.code === "launch_edge_monthly") ?? null;
  const pulseTrialCheckoutEnabled = isHostedPulseTrialCheckoutEnabled();
  const buttonClassName =
    "h-12 w-full rounded-full bg-foreground text-sm font-semibold text-background hover:bg-foreground/90";

  return (
    <div className="space-y-6">
      <div
        className={
          familyBillingRecovery === "available"
            ? "grid gap-4 sm:grid-cols-2"
            : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4"
        }
      >
        <PricingTierCard
          tier="free"
          name="Pulse Trial"
          description={`Try Murph for ${HOSTED_PULSE_TRIAL_DAYS} days, no charge.`}
          price="$0"
          priceUnit={`for ${HOSTED_PULSE_TRIAL_DAYS} days`}
          features={PULSE_TRIAL_FEATURES}
          cta={
            <JoinInviteCheckoutPlanButtonIsland
              billingReady={billingReady && pulseTrialCheckoutEnabled}
              checkoutOffer="pulse_trial_7d"
              className={buttonClassName}
              disabledLabel="Trial unavailable"
              idleLabel={`Start ${HOSTED_PULSE_TRIAL_DAYS}-day trial`}
              inviteCode={inviteCode}
              planCode={pulsePlan?.code ?? null}
            />
          }
        />

        <PricingTierCard
          tier="go"
          name="Pulse"
          description="Your private personal health assistant."
          price={pulsePlan ? `$${Math.round(pulsePlan.recurringAmountUsdCents / 100)}` : "$8"}
          priceUnit="/ month"
          features={JOIN_PULSE_FEATURES}
          cta={
            <JoinInviteCheckoutPlanButtonIsland
              billingReady={billingReady}
              className={buttonClassName}
              idleLabel="Get Pulse"
              inviteCode={inviteCode}
              planCode={pulsePlan?.code ?? null}
            />
          }
        />

        <PricingTierCard
          tier="plus"
          name="Edge"
          description="More guidance and deeper research."
          price={edgePlan ? `$${Math.round(edgePlan.recurringAmountUsdCents / 100)}` : "$20"}
          priceUnit="/ month"
          features={JOIN_EDGE_FEATURES}
          cta={
            <JoinInviteCheckoutPlanButtonIsland
              billingReady={billingReady}
              className={buttonClassName}
              disabledLabel="Coming soon"
              idleLabel="Get Edge"
              inviteCode={inviteCode}
              planCode={edgePlan?.code ?? null}
            />
          }
        />

        {familyBillingRecovery === "available" ? (
          <PricingTierCard
            tier="family"
            name="Family"
            description="Private Murph accounts for the people closest to you."
            price={`$${Math.round(
              HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat / 100,
            )}`}
            priceUnit="/ person / month"
            features={JOIN_FAMILY_FEATURES}
            cta={
              <HostedFamilyStartButton
                block
                label="Restart Family"
              />
            }
          />
        ) : null}
      </div>

      <div className="text-center text-sm text-muted-foreground">
        Want to self-host?{" "}
        <Link
          href={MURPH_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-foreground underline-offset-4 hover:underline"
        >
          View Murph on GitHub.
        </Link>
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

export function JoinInviteFamilyBillingSyncPanel() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="rounded-xl border border-border bg-card px-6 py-7 sm:px-8"
      role="status"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <RefreshCwIcon className="size-4" />
        </span>
        <div className="max-w-xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Family billing
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Your Family plan is syncing
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Stripe is confirming the plan. This page checks automatically and
            will continue when Family access is ready.
          </p>
        </div>
      </div>
    </div>
  );
}

export function JoinInviteFamilyCheckoutContinuationPanel() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-7 sm:px-8">
      <div className="flex items-start gap-4">
        <PlanVisual tier="pulse" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Family checkout
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Your Family checkout is still open
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Continue to Stripe using the same secure checkout. Individual plans
            stay unavailable while this Family checkout is open.
          </p>
          <div className="mt-5">
            <HostedFamilyStartButton
              block
              label="Continue Family checkout"
            />
          </div>
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
  cta: ReactNode;
  tier: "family" | "free" | "go" | "plus";
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-background px-7 pt-6 pb-8">
      <div className="flex items-center gap-3">
        <PlanVisual
          tier={tier === "plus" ? "edge" : tier === "free" ? "free" : "pulse"}
        />
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

function JoinInviteActivePanel({
  launchLegalConsentSatisfied,
  murphPhoneNumber,
  stage,
  telegramStartLink,
}: {
  launchLegalConsentSatisfied: boolean;
  murphPhoneNumber: string | null;
  stage: HostedAccessibleOnboardingStage;
  telegramStartLink: string | null;
}) {
  const activationPending = stage === "activating";

  return (
    <div className="flex flex-col gap-8">
      {activationPending ? (
        <div className="space-y-1 text-sm text-olive">
          <p className="font-semibold">
            {JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelTitle}
          </p>
          <p className="leading-relaxed text-olive/85">
            {JOIN_INVITE_ACTIVATION_PENDING_COPY.activePanelDescription}
          </p>
        </div>
      ) : telegramStartLink ? (
        <div className="space-y-1 text-sm text-olive">
          <p className="font-semibold">One last step</p>
          <p className="leading-relaxed text-olive/85">
            Your Telegram is linked. Open Murph in Telegram and send a message
            so Murph can reply. Telegram only lets Murph message you after you
            go first.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 text-sm text-olive">
          <CheckCircleIcon className="size-4 shrink-0" />
          <p className="leading-relaxed">
            Murph is ready whenever you are.
          </p>
        </div>
      )}

      {launchLegalConsentSatisfied ? (
        <JoinInviteMurphContactActions
          murphPhoneNumber={murphPhoneNumber}
          telegramStartLink={telegramStartLink}
        />
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
  telegramStartLink,
}: {
  murphPhoneNumber: string | null;
  telegramStartLink: string | null;
}) {
  if (telegramStartLink) {
    return (
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
        <Button
          render={
            <a href={telegramStartLink} rel="noreferrer" target="_blank" />
          }
          nativeButton={false}
          size="lg"
        >
          Message Murph on Telegram
        </Button>
      </div>
    );
  }

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
      <MurphAddToContactsButton />
    </div>
  );
}

function buildMurphSmsHref(phoneNumber: string): string {
  return `sms:${phoneNumber}`;
}
