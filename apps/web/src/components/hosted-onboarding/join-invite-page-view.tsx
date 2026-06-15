import { PageHeader } from "@/src/components/ui/page-header";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { JoinInviteEyebrow, type JoinInviteEyebrowTone } from "./join-invite-eyebrow";
import {
  buildJoinInviteStatusRefreshSnapshot,
  resolveJoinInviteSubtitle,
  resolveJoinInviteTitle,
} from "./join-invite-state";
import type { JoinInvitePageModel } from "./join-invite-page-model";
import { JoinInviteStatusRefreshIsland } from "./join-invite-islands";
import { JoinInviteCenteredShell, JoinInviteShell } from "./join-invite-shell";
import {
  isJoinInviteAutoPulseTrialReady,
  JoinInviteStageServer,
} from "./join-invite-stage-server";

export function JoinInvitePageView({ model }: { model: JoinInvitePageModel }) {
  const autoPulseTrialStarting = !model.launchConsent.gateActive
    && model.status.stage === "checkout"
    && isJoinInviteAutoPulseTrialReady(model.status);
  const useCenteredShell = model.launchConsent.gateActive
    || model.status.stage === "verify"
    || autoPulseTrialStarting;
  const Shell = useCenteredShell ? JoinInviteCenteredShell : JoinInviteShell;
  const eyebrow = model.launchConsent.gateActive
    ? { label: "Murph", tone: "default" as const }
    : resolveJoinInviteEyebrow(model.status.stage);
  const title = model.launchConsent.gateActive
    ? "One quick step"
    : resolveJoinInviteTitle(model.status);
  const subtitle = model.launchConsent.gateActive
    ? "Review and accept the legal agreements below to get started."
    : resolveJoinInviteSubtitle(model.status);

  return (
    <Shell>
      <div className={[
        "flex w-full flex-col gap-6",
        useCenteredShell
          ? "max-w-lg"
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
        current={buildJoinInviteStatusRefreshSnapshot(model.status)}
        disabled={model.preview}
        inviteCode={model.inviteCode}
        legalGateActive={model.launchConsent.gateActive}
      />
    </Shell>
  );
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
