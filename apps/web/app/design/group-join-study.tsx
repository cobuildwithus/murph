"use client";
import {
  buildHostedVaultShareProjectionScopeKey,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  GroupJoinAcceptForm,
  GroupJoinInviteMismatchRecovery,
  GroupJoinLeaveButton,
  GroupJoinSuccess,
  type GroupJoinPermissionDisplay,
} from "@/src/components/hosted-groups/group-join-client";
import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";
import { HOSTED_VAULT_SHARE_TIME_ZONE_DESCRIPTION } from "@/src/lib/hosted-groups/projection-display-copy";

const DESIGN_GROUP_NAME = "Sunday Sleep Crew";
const DESIGN_JOIN_CODE = "DESIGN_JOIN";

const DESIGN_ACTIVITY_SCOPE: HostedVaultShareProjectionScope = {
  projectionKind: "activity-days.v0",
};

const DESIGN_SLEEP_SOURCE_PERMISSIONS: GroupJoinPermissionDisplay[] = [
  {
    description:
      "Shares 7 days of each source’s name, deep sleep minutes, and recorded time.",
    label: "Deep sleep",
    legacyProjectionScope: { projectionKind: "deep-sleep-days.v0" },
    projectionScope: { projectionKind: "deep-sleep-sources-days.v1" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "deep-sleep-sources-days.v1",
    }),
  },
  {
    description:
      "Shares 7 days of each source’s name, REM sleep minutes, and recorded time.",
    label: "REM sleep",
    legacyProjectionScope: { projectionKind: "rem-sleep-days.v0" },
    projectionScope: { projectionKind: "rem-sleep-sources-days.v1" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "rem-sleep-sources-days.v1",
    }),
  },
];

const DESIGN_PERMISSIONS: GroupJoinPermissionDisplay[] = [
  {
    description: "Shares your last 7 days of active minutes.",
    label: "Activity minutes",
    projectionScope: DESIGN_ACTIVITY_SCOPE,
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey(DESIGN_ACTIVITY_SCOPE),
  },
  ...DESIGN_SLEEP_SOURCE_PERMISSIONS,
  // The four gram-macro scopes render as a single "Daily macros" card; dietary
  // calories stay a separate "Daily calories" card.
  {
    description:
      "Shares your last 7 days of daily protein totals from meals in Murph, including meals imported from connected apps.",
    label: "Daily protein",
    projectionScope: { projectionKind: "protein-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "protein-days.v0",
    }),
  },
  {
    description:
      "Shares your last 7 days of daily carbohydrate totals from meals in Murph, including meals imported from connected apps.",
    label: "Daily carbs",
    projectionScope: { projectionKind: "carbs-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "carbs-days.v0",
    }),
  },
  {
    description:
      "Shares your last 7 days of daily fat totals from meals in Murph, including meals imported from connected apps.",
    label: "Daily fat",
    projectionScope: { projectionKind: "fat-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "fat-days.v0",
    }),
  },
  {
    description:
      "Shares your last 7 days of daily fiber totals from meals in Murph, including meals imported from connected apps.",
    label: "Daily fiber",
    projectionScope: { projectionKind: "fiber-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "fiber-days.v0",
    }),
  },
  {
    description:
      "Shares your last 7 days of daily calorie totals from meals in Murph, including meals imported from connected apps.",
    label: "Daily calories",
    projectionScope: { projectionKind: "calories-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "calories-days.v0",
    }),
  },
  {
    description: HOSTED_VAULT_SHARE_TIME_ZONE_DESCRIPTION,
    label: "Time zone",
    projectionScope: { projectionKind: "time-zone.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "time-zone.v0",
    }),
  },
];

export function GroupJoinStudy({
  comprehensivePermissions,
}: {
  comprehensivePermissions: readonly GroupJoinPermissionDisplay[];
}) {
  return (
    <div
      className="grid gap-6 rounded-3xl border border-border bg-background px-4 py-12 sm:px-8 lg:grid-cols-2"
      data-design-study="group-join"
      id="group-join"
      inert
    >
      <GroupJoinVariant
        caption="Deep sleep is one exact consent choice that includes source names, each source's recorded time, and every available value. Existing provider-neutral grants keep their original narrower meaning without becoming a second choice."
        title="Sleep sources · exact consent"
      >
        <GroupJoinPageMock alreadyActiveMember={false}>
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[]}
            alreadyActiveMember={false}
            expectedMembershipId={null}
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="An existing narrow grant remains visible as the same single sleep permission. Saving keeps it narrow, Include source details explicitly upgrades it, and unchecking stops all versions of that sleep share."
        title="Sleep sources · legacy sharing active"
      >
        <GroupJoinPageMock alreadyActiveMember>
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[
              { projectionKind: "deep-sleep-days.v0" },
              { projectionKind: "rem-sleep-days.v0" },
            ]}
            alreadyActiveMember
            expectedMembershipId="membership_design"
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A signed-out invitee who arrived from a group text sees only the phone-bound account path. The invite code stays attached through authentication so Murph can return them to this group."
        title="Message invite · signed out"
      >
        <GroupJoinPageMock alreadyActiveMember={false}>
          <HostedAuthPanel
            inviteCode="hinv_design_group_message"
            methods={["phone"]}
            requireLaunchConsentOnCompletion
            size="compact"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Existing member re-opens the invite link. Save changes and Leave group stay as buttons; Back to Murph is the new quiet exit."
        title="Existing member"
      >
        <GroupJoinPageMock alreadyActiveMember>
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[DESIGN_ACTIVITY_SCOPE]}
            alreadyActiveMember
            expectedMembershipId="membership_design"
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={DESIGN_PERMISSIONS}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
          <GroupJoinLeaveButton groupName={DESIGN_GROUP_NAME} joinCode={DESIGN_JOIN_CODE} />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A new member sees every available sharing choice selected, can clear optional sharing in one action, and can still re-enable exact choices before joining. Nothing is shared until they join."
        title="New invitee · comprehensive default"
      >
        <GroupJoinPageMock
          alreadyActiveMember={false}
          designState="group-join-comprehensive-default"
        >
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[]}
            alreadyActiveMember={false}
            expectedMembershipId={null}
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={comprehensivePermissions}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="After the membership and explicit sharing save succeed, Murph continues into the existing account setup route. If navigation stalls, this real success state keeps one direct setup action."
        title="New invitee · setup success fallback"
      >
        <GroupJoinPageMock alreadyActiveMember={false}>
          <GroupJoinSuccess
            alreadyActiveMember={false}
            groupName={DESIGN_GROUP_NAME}
            postJoinContactOption={null}
            postJoinDestination="/join"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A first-checkout member who reloads after joining keeps the same sharing controls, while every secondary action names the setup destination truthfully."
        title="Existing member · setup recovery"
      >
        <GroupJoinPageMock alreadyActiveMember>
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[]}
            alreadyActiveMember
            expectedMembershipId="membership_design"
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS}
            postJoinContactOption={null}
            postJoinDestination="/join"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="The phone-bound invite belongs to a different account than the current browser session. The unsafe join stays blocked, and one existing sign-out action preserves this group link for phone verification."
        title="Different account · recovery"
      >
        <GroupJoinPageMock alreadyActiveMember={false}>
          <GroupJoinInviteMismatchRecovery />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Existing member sharing only protein while the group also requests carbs, fat, and fiber. A mixed macro grant expands to per-nutrient rows so the active grant stays visible and revocable instead of hiding behind an unchecked group."
        title="Existing member · mixed macros"
      >
        <GroupJoinPageMock alreadyActiveMember>
          <GroupJoinAcceptForm
            activeVaultShareProjectionScopes={[
              DESIGN_ACTIVITY_SCOPE,
              { projectionKind: "protein-days.v0" },
            ]}
            alreadyActiveMember
            expectedMembershipId="membership_design"
            groupName={DESIGN_GROUP_NAME}
            joinCode={DESIGN_JOIN_CODE}
            permissions={DESIGN_PERMISSIONS}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
          <GroupJoinLeaveButton groupName={DESIGN_GROUP_NAME} joinCode={DESIGN_JOIN_CODE} />
        </GroupJoinPageMock>
      </GroupJoinVariant>
    </div>
  );
}

function GroupJoinVariant({
  caption,
  children,
  title,
}: {
  caption: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <p className="max-w-md text-sm text-muted-foreground">{caption}</p>
      </div>
      <div className="rounded-2xl border border-dashed border-border px-6 py-10">
        {children}
      </div>
    </div>
  );
}

function GroupJoinPageMock({
  alreadyActiveMember,
  children,
  designState,
}: {
  alreadyActiveMember: boolean;
  children: React.ReactNode;
  designState?: string;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-8"
      data-design-state={designState}
    >
      <header className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-[76px] items-center justify-center rounded-full bg-[#d4c4a8] font-serif text-[2rem] font-semibold text-[#2d3436]">
          S
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
            Family · 4 members
          </span>
          <h1 className="font-serif text-[2rem] leading-[1.05] font-semibold tracking-tight text-balance text-foreground">
            {alreadyActiveMember
              ? `You're in ${DESIGN_GROUP_NAME}`
              : `Join ${DESIGN_GROUP_NAME}`}
          </h1>
          <p className="max-w-[20rem] text-pretty text-[15px] leading-relaxed text-muted-foreground">
            Get healthier with people you trust. You choose exactly what you share.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex gap-4">
          <span className="w-[74px] shrink-0 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Shared
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            Your name, plus what you choose below.
          </p>
        </div>
        <div className="h-px bg-border" />
        <div className="flex gap-4">
          <span className="w-[74px] shrink-0 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Private
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            Your chats and vault. Anything you don&apos;t choose to share stays private.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
