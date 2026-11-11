import { MessageCircleIcon } from "lucide-react";

import { ConsentSkeleton } from "@/src/components/legal/hosted-legal-consent-card";
import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_NIGHT_TOKENS,
  LINK_PAGE_PILL_CLASS,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { MurphAddToContactsButton } from "@/src/components/murph/murph-contact-card-picker";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
import { HostedFamilyStartButton } from "@/src/components/settings/hosted-family-start-button";
import { buildContactSupportMailto } from "@/src/components/support/contact-support-action";
import { HOSTED_FAMILY_PLAN_DISPLAY } from "@/src/lib/hosted-onboarding/billing-plans";
import { JOIN_FAMILY_FEATURES } from "@/src/lib/hosted-onboarding/plan-features";
import type { HostedFamilyBillingRecoveryState } from "@/src/lib/hosted-onboarding/family-plan";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";
import { cn } from "@/src/lib/utils";

import { JoinInviteStarterUsageIsland } from "./join-invite-starter-usage-island";
import type {
  JoinInvitePageModel,
} from "./join-invite-page-model";
import {
  JoinInviteLegalConsentIsland,
  JoinInviteMessagingSetupIsland,
  JoinInvitePhoneVerificationIsland,
  JoinInviteRefreshButtonIsland,
  JoinInviteSignOutButtonIsland,
} from "./join-invite-islands";
import { JoinInvitePlanChoice } from "./join-invite-plan-choice";
import {
  resolveJoinInviteSubtitle,
  resolveJoinInviteTitle,
} from "./join-invite-state";

// The billing buttons carry their own variant's hover color, which the pill replaces.
const JOIN_INVITE_BILLING_PILL_CLASS = cn(LINK_PAGE_PILL_CLASS, "hover:bg-[#FFFCF6]");

export function JoinInviteStageServer({ model }: { model: JoinInvitePageModel }) {
  const { status } = model;

  if (model.launchConsent.gateActive) {
    return <JoinInviteLaunchLegalConsentScreen model={model} />;
  }

  switch (status.stage) {
    case "invalid":
    case "expired":
      return <JoinInviteDeadLinkScreen status={status} />;
    case "verify":
      return <JoinInviteVerifyScreen model={model} />;
    case "blocked":
      return <JoinInviteBlockedScreen status={status} />;
    case "checkout":
      return <JoinInviteCheckoutStage model={model} />;
    case "active":
      return (
        <JoinInviteActiveScreen
          launchLegalConsentSatisfied={model.launchConsent.status === "granted" || model.preview}
          status={status}
        />
      );
  }
}

function isJoinInviteStarterUsageReady(
  status: HostedInviteStatusPayload,
  familyBillingRecovery: HostedFamilyBillingRecoveryState | null,
): boolean {
  return familyBillingRecovery === null
    && status.session.authenticated
    && status.session.matchesInvite
    && !status.messagingSetupRequired;
}

function JoinInviteCheckoutStage({ model }: { model: JoinInvitePageModel }) {
  const { familyBillingRecovery, inviteCode, status } = model;

  switch (familyBillingRecovery) {
    case "checkout":
      return <JoinInviteFamilyCheckoutScreen />;
    case "manage":
      return <JoinInviteFamilyManagementScreen />;
    case "syncing":
      return <JoinInviteFamilySyncScreen />;
  }

  if (isJoinInviteStarterUsageReady(status, familyBillingRecovery)) {
    return <JoinInviteStarterUsageIsland inviteCode={inviteCode} />;
  }

  if (status.messagingSetupRequired) {
    return (
      <LinkPageScreen
        actions={<JoinInviteMessagingSetupIsland />}
        announceDetail={false}
        detail={resolveJoinInviteSubtitle(status)}
        title={resolveJoinInviteTitle(status)}
      />
    );
  }

  return (
    <JoinInvitePlanScreen
      familyBillingRecovery={familyBillingRecovery}
      inviteCode={inviteCode}
      status={status}
    />
  );
}

function JoinInviteDeadLinkScreen({
  status,
}: {
  status: HostedInviteStatusPayload;
}) {
  // Every other stage needs a session that matches the invite, so this is the
  // only screen a member of another account can reach without the mismatch view.
  const signedInElsewhere = status.session.authenticated && !status.session.matchesInvite;

  return (
    <LinkPageScreen
      actions={signedInElsewhere ? (
        <JoinInviteSignOutButtonIsland appearance="link" idleLabel="Sign out" />
      ) : undefined}
      announceDetail={false}
      detail={resolveJoinInviteSubtitle(status)}
      title={resolveJoinInviteTitle(status)}
    />
  );
}

function JoinInviteVerifyScreen({ model }: { model: JoinInvitePageModel }) {
  const { status } = model;
  const title = resolveJoinInviteTitle(status);
  const detail = resolveJoinInviteSubtitle(status);

  if (model.awaitingInviteSessionResolution) {
    return (
      <LinkPageScreen
        actions={
          <div
            aria-busy="true"
            aria-live="polite"
            className="w-full"
            role="status"
            style={LINK_PAGE_NIGHT_TOKENS}
          >
            <ConsentSkeleton />
          </div>
        }
        announceDetail={false}
        detail={detail}
        title={title}
      />
    );
  }

  return (
    <JoinInvitePhoneVerificationIsland
      detail={detail}
      emailAuthTarget={status.invite?.emailAuthTarget ?? null}
      inviteCode={model.inviteCode}
      phoneAuthTarget={status.invite?.phoneAuthTarget ?? null}
      phoneHint={status.invite?.phoneHint ?? null}
      title={title}
      verificationMode={status.invite?.verificationMode ?? "manual_phone"}
    />
  );
}

function JoinInviteBlockedScreen({
  status,
}: {
  status: HostedInviteStatusPayload;
}) {
  return (
    <LinkPageScreen
      actions={
        <a
          className={LINK_PAGE_PILL_CLASS}
          href={buildContactSupportMailto({
            body: [
              "Hi Murph support,",
              "",
              "I need help restoring access to my Murph account.",
              "",
              "Context: Invite or hosted account is blocked.",
            ].join("\n"),
            subject: "Murph account support",
          })}
        >
          Contact support
        </a>
      }
      announceDetail={false}
      detail={resolveJoinInviteSubtitle(status)}
      title={resolveJoinInviteTitle(status)}
    />
  );
}

function JoinInviteLaunchLegalConsentScreen({
  model,
}: {
  model: JoinInvitePageModel;
}) {
  if (model.launchConsent.status === "error") {
    return (
      <LinkPageScreen
        actions={<JoinInviteRefreshButtonIsland />}
        detail={model.launchConsent.errorMessage ?? "Could not load Murph legal consent right now."}
        title="Unable to load Murph legal consent."
      />
    );
  }

  return (
    <LinkPageScreen
      actions={
        <JoinInviteLegalConsentIsland
          initialStatus={model.launchConsent.initialStatus}
          inviteCode={model.inviteCode}
        />
      }
      title="One quick step."
    />
  );
}

function JoinInvitePlanScreen({
  familyBillingRecovery,
  inviteCode,
  status,
}: {
  familyBillingRecovery: HostedFamilyBillingRecoveryState | null;
  inviteCode: string;
  status: HostedInviteStatusPayload;
}) {
  const billingPlans = status.billing.plans;
  const pulsePlan = billingPlans.find((plan) => plan.code === "launch_monthly") ?? null;
  const edgePlan = billingPlans.find((plan) => plan.code === "launch_edge_monthly") ?? null;
  const familyAvailable = familyBillingRecovery === "available";

  return (
    <LinkPageScreen
      actions={
        <JoinInvitePlanChoice
          billingReady={status.capabilities.billingReady}
          family={familyAvailable ? {
            description: JOIN_FAMILY_FEATURES[0],
            features: JOIN_FAMILY_FEATURES.slice(1),
            price: formatPlanPrice(HOSTED_FAMILY_PLAN_DISPLAY.recurringAmountUsdCentsPerSeat),
          } : null}
          inviteCode={inviteCode}
          plans={[
            {
              description: "Questions, decisions, plans, and follow-through.",
              idleLabel: "Get Pulse",
              name: "Pulse",
              planCode: pulsePlan?.code ?? null,
              price: pulsePlan ? formatPlanPrice(pulsePlan.recurringAmountUsdCents) : "$8",
            },
            {
              description: "More guidance and deeper research.",
              disabledLabel: "Coming soon",
              idleLabel: "Get Edge",
              name: "Edge",
              planCode: edgePlan?.code ?? null,
              price: edgePlan ? formatPlanPrice(edgePlan.recurringAmountUsdCents) : "$20",
            },
          ]}
        />
      }
      announceDetail={false}
      detail={familyAvailable
        ? "Restart Family or choose an individual plan."
        : resolveJoinInviteSubtitle(status)}
      title={familyAvailable ? "Choose how to continue." : resolveJoinInviteTitle(status)}
    />
  );
}

function formatPlanPrice(recurringAmountUsdCents: number): string {
  return `$${Math.round(recurringAmountUsdCents / 100)}`;
}

function JoinInviteFamilySyncScreen() {
  return (
    <LinkPageScreen
      detail="This page checks automatically and will continue when Family access is ready."
      title="Family billing is in progress."
    >
      <LinkPageDots />
    </LinkPageScreen>
  );
}

function JoinInviteFamilyManagementScreen() {
  return (
    <LinkPageScreen
      actions={
        <div className="w-full" style={LINK_PAGE_NIGHT_TOKENS}>
          <BillingPortalButton
            billingScope="family"
            block
            className={JOIN_INVITE_BILLING_PILL_CLASS}
            label="Open Family billing"
            variant="secondary"
          />
        </div>
      }
      announceDetail={false}
      detail="Update payment details, review invoices, or cancel the plan."
      title="Resolve Family billing."
    />
  );
}

function JoinInviteFamilyCheckoutScreen() {
  return (
    <LinkPageScreen
      actions={
        <div className="w-full" style={LINK_PAGE_NIGHT_TOKENS}>
          <HostedFamilyStartButton
            block
            className={JOIN_INVITE_BILLING_PILL_CLASS}
            label="Continue Family checkout"
          />
        </div>
      }
      announceDetail={false}
      detail="Individual plans stay unavailable while this Family checkout is open."
      title="Continue Family checkout."
    />
  );
}

function JoinInviteActiveScreen({
  launchLegalConsentSatisfied,
  status,
}: {
  launchLegalConsentSatisfied: boolean;
  status: HostedInviteStatusPayload;
}) {
  const telegramStartLink = status.telegramStartRequired ? buildHostedTelegramBotLink() : null;
  const murphPhoneNumber = status.murphPhoneNumber ?? null;
  const canContactMurph = launchLegalConsentSatisfied
    && (telegramStartLink !== null || murphPhoneNumber !== null);

  return (
    <LinkPageScreen
      actions={canContactMurph ? (
        <JoinInviteMurphContactActions
          murphPhoneNumber={murphPhoneNumber}
          telegramStartLink={telegramStartLink}
        />
      ) : undefined}
      announceDetail={false}
      detail={resolveJoinInviteSubtitle(status)}
      title={resolveJoinInviteTitle(status)}
    >
      {status.stage === "active" && canContactMurph ? <JoinInviteFirstMessage /> : null}
    </LinkPageScreen>
  );
}

function JoinInviteFirstMessage() {
  return (
    <p
      aria-hidden="true"
      className="max-w-[280px] self-end rounded-[22px] bg-[#FFFCF6] px-[18px] py-3 text-lg font-medium leading-6 text-[#2D3436]"
    >
      Hey Murph
    </p>
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
      <a
        className={LINK_PAGE_PILL_CLASS}
        href={telegramStartLink}
        rel="noreferrer"
        target="_blank"
      >
        Message Murph on Telegram
      </a>
    );
  }

  if (!murphPhoneNumber) {
    return null;
  }

  return (
    <>
      <a className={LINK_PAGE_PILL_CLASS} href={buildMurphSmsHref(murphPhoneNumber)}>
        <MessageCircleIcon aria-hidden="true" className="size-5" />
        Text Murph
      </a>
      <MurphAddToContactsButton
        className={LINK_PAGE_LINK_CLASS}
        size="unstyled"
        variant="unstyled"
      />
    </>
  );
}

function buildMurphSmsHref(phoneNumber: string): string {
  return `sms:${phoneNumber}`;
}
