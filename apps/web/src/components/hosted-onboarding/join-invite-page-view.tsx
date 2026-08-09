import { PageHeader } from "@/src/components/ui/page-header";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { JoinInviteEyebrow, type JoinInviteEyebrowTone } from "./join-invite-eyebrow";
import {
  buildJoinInviteStatusRefreshSnapshot,
  resolveJoinInviteSubtitle,
  resolveJoinInviteTitle,
} from "./join-invite-state";
import type { JoinInvitePageModel } from "./join-invite-page-model";
import {
  JoinInviteSignOutButtonIsland,
  JoinInviteStatusRefreshIsland,
} from "./join-invite-islands";
import { JoinInviteCenteredShell, JoinInviteShell } from "./join-invite-shell";
import { JoinInviteSignedInMismatchView } from "./join-invite-signed-in-mismatch-view";
import {
  isJoinInviteAutoPulseTrialReady,
  JoinInviteStageServer,
} from "./join-invite-stage-server";

export function JoinInvitePageView({ model }: { model: JoinInvitePageModel }) {
  const signedInWithDifferentAccount = model.status.stage === "verify"
    && model.status.session.authenticated
    && !model.status.session.matchesInvite;

  if (signedInWithDifferentAccount) {
    return (
      <JoinInviteSignedInMismatchView
        signOutAction={
          <JoinInviteSignOutButtonIsland idleLabel="Sign out and use invite" />
        }
      />
    );
  }

  const autoPulseTrialStarting = !model.launchConsent.gateActive
    && model.status.stage === "checkout"
    && isJoinInviteAutoPulseTrialReady(
      model.status,
      model.familyBillingRecovery,
    );
  const messagingSetupCheckout = model.status.stage === "checkout"
    && model.status.messagingSetupRequired;
  const familyBillingRecoveryVisible =
    !model.launchConsent.gateActive
    && model.status.stage === "checkout"
    && !messagingSetupCheckout
    && model.familyBillingRecovery !== null;
  const familyBillingRecoveryHeader =
    familyBillingRecoveryVisible && model.familyBillingRecovery !== null
      ? resolveFamilyBillingRecoveryHeader(model.familyBillingRecovery)
      : null;
  const focusedFamilyBillingRecovery =
    model.familyBillingRecovery === "checkout"
    || model.familyBillingRecovery === "syncing";
  const useCenteredShell = model.launchConsent.gateActive
    || model.status.stage === "verify"
    || autoPulseTrialStarting
    || messagingSetupCheckout
    || focusedFamilyBillingRecovery;
  const Shell = useCenteredShell ? JoinInviteCenteredShell : JoinInviteShell;
  const eyebrow = model.launchConsent.gateActive
    ? { label: "Murph", tone: "default" as const }
    : resolveJoinInviteEyebrow(model.status.stage);
  const title = model.launchConsent.gateActive
    ? "One quick step"
    : familyBillingRecoveryHeader?.title ?? resolveJoinInviteTitle(model.status);
  const subtitle = model.launchConsent.gateActive
    ? "Review and accept the legal agreements below to get started."
    : familyBillingRecoveryHeader?.subtitle ?? resolveJoinInviteSubtitle(model.status);

  return (
    <Shell>
      <div className={[
        "flex w-full flex-col gap-6",
        useCenteredShell
          ? messagingSetupCheckout
            ? "max-w-md"
            : "max-w-lg"
          : model.status.stage === "checkout"
            ? "max-w-5xl"
            : "max-w-md",
      ].join(" ")}>
        {autoPulseTrialStarting ? null : (
          <PageHeader
            eyebrow={<JoinInviteEyebrow label={eyebrow.label} tone={eyebrow.tone} />}
            title={title}
            description={subtitle}
          />
        )}

        <div className="flex flex-col gap-4">
          <JoinInviteStageServer model={model} />
        </div>
      </div>

      <JoinInviteStatusRefreshIsland
        current={buildJoinInviteStatusRefreshSnapshot(
          model.status,
          model.familyBillingRecovery,
        )}
        disabled={model.preview}
        inviteCode={model.inviteCode}
        legalGateActive={model.launchConsent.gateActive}
      />
    </Shell>
  );
}

function resolveFamilyBillingRecoveryHeader(
  state: NonNullable<JoinInvitePageModel["familyBillingRecovery"]>,
): { subtitle: string; title: string } {
  switch (state) {
    case "available":
      return {
        subtitle: "Restart Family or choose an individual plan.",
        title: "Choose how to continue",
      };
    case "checkout":
      return {
        subtitle: "Your existing Stripe checkout is ready to resume.",
        title: "Continue Family checkout",
      };
    case "syncing":
      return {
        subtitle: "Stripe is confirming your Family plan.",
        title: "Family billing is in progress",
      };
  }
}

function resolveJoinInviteEyebrow(
  stage: HostedInviteStatusPayload["stage"],
): { label: string; tone: JoinInviteEyebrowTone } {
  switch (stage) {
    case "invalid":
    case "expired":
      return { label: "Link no longer works", tone: "danger" };
    case "blocked":
      return { label: "Needs support", tone: "danger" };
    case "verify":
      return { label: "Chat with Murph", tone: "default" };
    default:
      return { label: "Murph", tone: "default" };
  }
}
