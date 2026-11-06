"use client";
import { useState } from "react";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  GroupJoinAcceptForm,
  GroupJoinDetailsDrawer,
  GroupJoinInviteMismatchRecovery,
  GroupJoinLeaveButton,
  GroupJoinLeaveDrawer,
  GroupJoinLegalConsentGate,
  GroupJoinSignIn,
  GroupJoinSuccess,
  type GroupJoinPermissionDisplay,
} from "@/src/components/hosted-groups/group-join-client";
import { groupJoinPermissionsForDisplay } from "@/src/components/hosted-groups/group-join-permission-groups";
import { LinkPageSurface } from "@/src/components/link-page/link-page-shell";
import { Button } from "@/src/components/ui/button";
import { HOSTED_VAULT_SHARE_TIME_ZONE_DESCRIPTION } from "@/src/lib/hosted-groups/projection-display-copy";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { cn } from "@/src/lib/utils";

const DESIGN_GROUP_NAME = "Sunday sleep crew";
const DESIGN_JOIN_CODE = "DESIGN_JOIN";
const DESIGN_MEMBER_COUNT = 4;
const DESIGN_DETAIL = "4 people. They’ll see your name, and anything you choose to share.";
const DESIGN_CONSENT_DOCUMENTS: HostedConsentStatus["documents"] = [
  {
    href: "/legal/terms",
    id: "terms-of-service",
    pdfHref: "/legal/terms.pdf",
    title: "Murph Terms of Service",
    version: "2026-04-29",
  },
  {
    href: "/legal/privacy",
    id: "privacy-policy",
    pdfHref: "/legal/privacy.pdf",
    title: "Murph Privacy Policy",
    version: "2026-06-24",
  },
];
const DESIGN_CONSENT_STATUS: HostedConsentStatus = {
  documents: DESIGN_CONSENT_DOCUMENTS,
  generatedAt: "2026-07-23T12:00:00.000Z",
  launchGranted: false,
  launchScopes: [{
    granted: false,
    missingDocuments: DESIGN_CONSENT_DOCUMENTS,
    scope: "launch.legal",
  }],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [{
    current: false,
    documents: DESIGN_CONSENT_DOCUMENTS,
    grant: null,
    granted: false,
    label: "Terms",
    missingDocuments: DESIGN_CONSENT_DOCUMENTS,
    revocable: false,
    scope: "launch.legal",
  }],
};

const DESIGN_ACTIVITY_SCOPE: HostedVaultShareProjectionScope = {
  projectionKind: "activity-days.v0",
};

const DESIGN_SLEEP_SOURCE_PERMISSIONS: GroupJoinPermissionDisplay[] = [
  {
    description: "Shares 90 days of deep sleep minutes and recorded times by source.",
    label: "Deep sleep",
    legacyProjectionScope: { projectionKind: "deep-sleep-days.v0" },
    projectionScope: { projectionKind: "deep-sleep-sources-days.v1" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "deep-sleep-sources-days.v1",
    }),
  },
  {
    description: "Shares 90 days of REM sleep minutes and recorded times by source.",
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
    description: "Shares 90 days of active minutes by source.",
    label: "Activity minutes",
    projectionScope: DESIGN_ACTIVITY_SCOPE,
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey(DESIGN_ACTIVITY_SCOPE),
  },
  ...DESIGN_SLEEP_SOURCE_PERMISSIONS,
  // The four gram-macro scopes render as a single "Daily macros" card; dietary
  // calories stay a separate "Daily calories" card.
  {
    description: "Shares 90 days of meal protein totals, including imports, with Murph as the source.",
    label: "Daily protein",
    projectionScope: { projectionKind: "protein-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "protein-days.v0",
    }),
  },
  {
    description: "Shares 90 days of meal carbohydrate totals, including imports, with Murph as the source.",
    label: "Daily carbs",
    projectionScope: { projectionKind: "carbs-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "carbs-days.v0",
    }),
  },
  {
    description: "Shares 90 days of meal fat totals, including imports, with Murph as the source.",
    label: "Daily fat",
    projectionScope: { projectionKind: "fat-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "fat-days.v0",
    }),
  },
  {
    description: "Shares 90 days of meal fiber totals, including imports, with Murph as the source.",
    label: "Daily fiber",
    projectionScope: { projectionKind: "fiber-days.v0" },
    projectionScopeKey: buildHostedVaultShareProjectionScopeKey({
      projectionKind: "fiber-days.v0",
    }),
  },
  {
    description: "Shares 90 days of meal calorie totals, including imports, with Murph as the source.",
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
  const selectorPermissions = comprehensivePermissions.filter(({ projectionScope }) => (
    projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND
      ? projectionScope.selector.activityKind === "walking"
      : projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND
        && projectionScope.selector.activityKind === "bike"
  ));

  return (
    <div
      className="grid gap-6 md:grid-cols-2 xl:grid-cols-3"
      data-design-study="group-join"
      id="group-join"
      inert
    >
      <GroupJoinVariant
        caption="A signed-out invitee who arrived from a group text sees only the phone-bound account path. The invite code stays attached through authentication so Murph can return them to this group."
        title="Message invite · signed out"
      >
        <GroupJoinPageMock>
          <GroupJoinSignIn
            detail={DESIGN_DETAIL}
            inviteCode="hinv_design_group_message"
            memberCount={DESIGN_MEMBER_COUNT}
            title={`Join ${DESIGN_GROUP_NAME}.`}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A signed-in invitee who hasn't accepted Murph's terms sees the consent card first. The join form stays behind it, and Not now is the way out."
        title="Legal consent gate"
      >
        <GroupJoinPageMock fit={false}>
          <GroupJoinLegalConsentGate
            detail={DESIGN_DETAIL}
            initialStatus={DESIGN_CONSENT_STATUS}
            notNowHref="/home"
            title={`Join ${DESIGN_GROUP_NAME}.`}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Names only, with the exact wording one tap away in Details. Every choice stays selected until the invitee unchecks it, and Clear all makes joining with no sharing one action. Nothing is shared until they join."
        title="New invitee · pick what to share"
      >
        <GroupJoinPageMock designState="group-join-new-invitee">
          <DesignForm alreadyActiveMember={false} permissions={DESIGN_PERMISSIONS} />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A new member sees every available sharing choice selected. The list stays a bounded scroll region, so Join group stays in view however long the catalog is."
        title="New invitee · comprehensive default"
      >
        <GroupJoinPageMock designState="group-join-comprehensive-default">
          <DesignForm alreadyActiveMember={false} permissions={comprehensivePermissions} />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Selector-based activity choices name the same 90-day history window as every other recent-data permission in Details, so approval is informed before sharing starts."
        title="Recent activity · exact consent window"
      >
        <GroupJoinPageMock designState="group-join-selector-permissions">
          <DesignForm alreadyActiveMember={false} permissions={selectorPermissions} />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Deep sleep is one exact consent choice that includes source names, each source's recorded time, and every available value across both stored scope versions."
        title="Sleep sources · exact consent"
      >
        <GroupJoinPageMock>
          <DesignForm alreadyActiveMember={false} permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS} />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="An existing member reopens the link with only their active shares selected. Save changes is the pill and Leave group is the quiet link."
        title="Existing member"
      >
        <GroupJoinPageMock>
          <DesignForm
            activeScopes={[DESIGN_ACTIVITY_SCOPE]}
            alreadyActiveMember
            canLeave
            permissions={DESIGN_PERMISSIONS}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="An existing activity permission now shares 90 days automatically and remains selected. Unchecking it stops sharing."
        title="History · existing permission"
      >
        <GroupJoinPageMock designState="group-join-history-existing">
          <DesignForm
            activeScopes={[DESIGN_ACTIVITY_SCOPE]}
            alreadyActiveMember
            permissions={comprehensivePermissions.filter(({ projectionScope }) => projectionScope.projectionKind === "activity-days.v0")}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="An existing v0 grant remains visible under the same source-labelled sleep permission. Saving preserves its scope key, and unchecking still stops every stored version of that share."
        title="Sleep sources · existing sharing active"
      >
        <GroupJoinPageMock>
          <DesignForm
            activeScopes={[
              { projectionKind: "deep-sleep-days.v0" },
              { projectionKind: "rem-sleep-days.v0" },
            ]}
            alreadyActiveMember
            permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Existing member sharing only protein while the group also requests carbs, fat, and fiber. A mixed macro grant expands to per-nutrient rows so the active grant stays visible and revocable instead of hiding behind an unchecked group."
        title="Existing member · mixed macros"
      >
        <GroupJoinPageMock>
          <DesignForm
            activeScopes={[
              DESIGN_ACTIVITY_SCOPE,
              { projectionKind: "protein-days.v0" },
            ]}
            alreadyActiveMember
            canLeave
            permissions={DESIGN_PERMISSIONS}
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="A first-checkout member who reloads after joining keeps the same sharing controls, while every secondary action names the setup destination truthfully."
        title="Existing member · setup recovery"
      >
        <GroupJoinPageMock>
          <DesignForm
            alreadyActiveMember
            permissions={DESIGN_SLEEP_SOURCE_PERMISSIONS}
            postJoinDestination="/join"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Your circle fills in, and the one action goes back to the chat."
        title="Joined"
      >
        <GroupJoinPageMock>
          <GroupJoinSuccess
            alreadyActiveMember={false}
            groupName={DESIGN_GROUP_NAME}
            memberCount={DESIGN_MEMBER_COUNT}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="Nothing else to do."
        title="Saved"
      >
        <GroupJoinPageMock>
          <GroupJoinSuccess
            alreadyActiveMember
            groupName={DESIGN_GROUP_NAME}
            memberCount={DESIGN_MEMBER_COUNT}
            postJoinContactOption={null}
            postJoinDestination="/home"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="After the membership and explicit sharing save succeed, Murph continues into the existing account setup route. If navigation stalls, this real success state keeps one direct setup action."
        title="New invitee · setup success fallback"
      >
        <GroupJoinPageMock>
          <GroupJoinSuccess
            alreadyActiveMember={false}
            groupName={DESIGN_GROUP_NAME}
            memberCount={DESIGN_MEMBER_COUNT}
            postJoinContactOption={null}
            postJoinDestination="/join"
          />
        </GroupJoinPageMock>
      </GroupJoinVariant>

      <GroupJoinVariant
        caption="The phone-bound invite belongs to a different account than the current browser session. The unsafe join stays blocked, and one existing sign-out action preserves this group link for phone verification."
        title="Different account · recovery"
      >
        <GroupJoinPageMock>
          <GroupJoinInviteMismatchRecovery />
        </GroupJoinPageMock>
      </GroupJoinVariant>
    </div>
  );
}

export function GroupJoinDrawerStudy() {
  const [drawer, setDrawer] = useState<"details" | "leave" | "leave-error" | null>(null);
  const close = (open: boolean) => {
    if (!open) {
      setDrawer(null);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3" data-design-component="group-join-drawers">
      <p className="max-w-[48ch] text-sm/6 text-muted-foreground">
        Preview the night drawers: the exact wording of every choice, and the
        confirmation that replaced the browser pop-up on Leave group.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDrawer("details")} variant="outline">
          Preview Details
        </Button>
        <Button onClick={() => setDrawer("leave")} variant="outline">
          Preview Leave group
        </Button>
        <Button onClick={() => setDrawer("leave-error")} variant="outline">
          Preview Leave group error
        </Button>
      </div>
      <GroupJoinDetailsDrawer
        choices={groupJoinPermissionsForDisplay(
          DESIGN_PERMISSIONS,
          new Set(DESIGN_PERMISSIONS.map((permission) => permission.projectionScopeKey)),
        )}
        onOpenChange={close}
        open={drawer === "details"}
      />
      <GroupJoinLeaveDrawer
        errorMessage={drawer === "leave-error" ? "Could not leave this group right now." : null}
        groupName={DESIGN_GROUP_NAME}
        onConfirm={() => undefined}
        onOpenChange={close}
        open={drawer === "leave" || drawer === "leave-error"}
      />
    </div>
  );
}

function DesignForm({
  activeScopes = [],
  alreadyActiveMember,
  canLeave = false,
  permissions,
  postJoinDestination = "/home",
}: {
  activeScopes?: readonly HostedVaultShareProjectionScope[];
  alreadyActiveMember: boolean;
  canLeave?: boolean;
  permissions: readonly GroupJoinPermissionDisplay[];
  postJoinDestination?: "/home" | "/join";
}) {
  return (
    <GroupJoinAcceptForm
      activeVaultShareProjectionScopes={activeScopes}
      alreadyActiveMember={alreadyActiveMember}
      detail={DESIGN_DETAIL}
      expectedMembershipId={alreadyActiveMember ? "membership_design" : null}
      groupName={DESIGN_GROUP_NAME}
      joinCode={DESIGN_JOIN_CODE}
      leaveAction={canLeave ? (
        <GroupJoinLeaveButton groupName={DESIGN_GROUP_NAME} joinCode={DESIGN_JOIN_CODE} />
      ) : null}
      memberCount={DESIGN_MEMBER_COUNT}
      permissions={permissions}
      postJoinContactOption={null}
      postJoinDestination={postJoinDestination}
    />
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <p className="max-w-md text-sm text-muted-foreground">{caption}</p>
      </div>
      {children}
    </div>
  );
}

function GroupJoinPageMock({
  children,
  designState,
  fit = true,
}: {
  children: React.ReactNode;
  designState?: string;
  fit?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex max-w-[402px] flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]",
        fit ? "h-[46rem]" : "min-h-[46rem]",
      )}
      data-design-state={designState}
    >
      <LinkPageSurface fit={fit}>{children}</LinkPageSurface>
    </div>
  );
}
