"use client";

import { MemberOwnedProviderSetup } from "@/src/components/device-sync/member-owned-provider-setup";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "@/src/lib/device-sync/provider-setup/registry";
import type {
  MemberOwnedProviderSetupStatus,
  MemberOwnedProviderSetupView,
} from "@/src/lib/device-sync/provider-setup/types";

const STUDY_UPDATED_AT = "2026-08-11T12:00:00.000Z";

const STUDY_STATES: readonly {
  label: string;
  setup: MemberOwnedProviderSetupView;
}[] = [
  { label: "Ready", setup: buildStudySetup("pending", "authorize") },
  { label: "Authorized", setup: buildStudySetup("authorized", "none") },
  { label: "Browser setup", setup: buildStudySetup("browser_setup", "none") },
  { label: "Sealing credentials", setup: buildStudySetup("capturing", "none") },
  { label: "Canceling safely", setup: buildStudySetup("canceling", "none") },
  { label: "Continue OAuth", setup: buildStudySetup("oauth_ready", "continue_oauth", 3) },
  { label: "OAuth consent", setup: buildStudySetup("oauth_in_progress", "continue_oauth", 3) },
  { label: "Connected", setup: buildStudySetup("connected", "none", 3, true) },
  { label: "Disconnect first", setup: buildStudySetup("disconnect_first", "disconnect_first", 3) },
  { label: "Canceled", setup: buildStudySetup("canceled", "authorize") },
  { label: "Removing private app", setup: buildStudySetup("deletion_pending", "none", 3) },
  { label: "Private app deleted", setup: buildStudySetup("deleted", "none") },
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
        pending={false}
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
