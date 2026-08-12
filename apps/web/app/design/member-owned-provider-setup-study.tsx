"use client";

import { MemberOwnedProviderSetup } from "@/src/components/device-sync/member-owned-provider-setup";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "@/src/lib/device-sync/provider-setup/presentation";
import type {
  MemberOwnedProviderSetupStatus,
  MemberOwnedProviderSetupView,
} from "@/src/lib/device-sync/provider-setup/types";

const STUDY_UPDATED_AT = "2026-08-11T12:00:00.000Z";

const STUDY_STATES: readonly {
  label: string;
  setup: MemberOwnedProviderSetupView;
}[] = [
  {
    label: "Start",
    setup: buildStudySetup("pending", "start"),
  },
  {
    label: "Working",
    setup: buildStudySetup("working", "none"),
  },
  {
    label: "Provider sign-in or challenge",
    setup: buildStudySetup("waiting_for_user", "continue_sign_in"),
  },
  {
    label: "Provider prerequisite",
    setup: buildStudySetup("provider_prerequisite", "continue_provider"),
  },
  {
    label: "Canceling safely",
    setup: buildStudySetup("canceling", "none"),
  },
  {
    label: "Ambiguous create recovery",
    setup: buildStudySetup("inspection_required", "retry"),
  },
  {
    label: "Continue OAuth",
    setup: buildStudySetup("oauth_ready", "continue_oauth", 3),
  },
  {
    label: "OAuth consent in progress",
    setup: buildStudySetup("oauth_in_progress", "continue_oauth", 3),
  },
  {
    label: "Connected",
    setup: buildStudySetup("connected", "none", 3, true),
  },
  {
    label: "Repair credentials/application",
    setup: buildStudySetup("repair_required", "retry", 3),
  },
  {
    label: "Transient retry",
    setup: buildStudySetup("retryable_failure", "retry", 3),
  },
  {
    label: "Disconnect first",
    setup: buildStudySetup("disconnect_first", "disconnect_first", 3),
  },
  {
    label: "Unrelated application protected",
    setup: buildStudySetup("provider_conflict", "retry"),
  },
  {
    label: "Canceled, ready to restart",
    setup: buildStudySetup("canceled", "start"),
  },
  {
    label: "Account deletion cleanup",
    setup: buildStudySetup("deletion_pending", "none", 3),
  },
  {
    label: "Private application deleted",
    setup: buildStudySetup("deleted", "none", 3),
  },
];

export function MemberOwnedProviderSetupComponentStudy() {
  return (
    <div className="grid gap-4 md:grid-cols-2" inert>
      {STUDY_STATES.slice(0, 2).map((state) => (
        <StudyCard key={state.label} label={state.label} setup={state.setup} />
      ))}
    </div>
  );
}

export function MemberOwnedProviderSetupFlowStudy() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      data-design-section="member-owned-provider-setup-flow"
      inert
    >
      {STUDY_STATES.map((state) => (
        <StudyCard key={state.label} label={state.label} setup={state.setup} />
      ))}
    </div>
  );
}

function StudyCard({
  label,
  setup,
}: {
  label: string;
  setup: MemberOwnedProviderSetupView;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <MemberOwnedProviderSetup
        actionAvailable
        connected={setup.connected}
        controlsInert
        pending={setup.status === "working"}
        presentation={STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION}
        setup={setup}
        onAction={() => undefined}
        onCancel={() => undefined}
      />
    </article>
  );
}

function buildStudySetup(
  status: MemberOwnedProviderSetupStatus,
  action: MemberOwnedProviderSetupView["action"],
  applicationRevision: number | null = null,
  connected = false,
): MemberOwnedProviderSetupView {
  return {
    action,
    applicationRevision,
    connected,
    message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages[status],
    provider: "strava",
    setupId: "dps_design_study",
    status,
    updatedAt: STUDY_UPDATED_AT,
  };
}
