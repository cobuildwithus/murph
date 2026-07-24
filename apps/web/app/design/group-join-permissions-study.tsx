"use client";

import type {
  HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import {
  GroupJoinAcceptForm,
  type GroupJoinPermissionDisplay,
} from "@/src/components/hosted-groups/group-join-client";

const DESIGN_GROUP_JOIN_PERMISSION_KINDS =
  new Set<HostedVaultShareProjectionKind>([
    "sleep-duration-days.v0",
    "workout-days.v0",
    "steps-days.v0",
    "protein-days.v0",
  ]);

const DESIGN_GROUP_JOIN_SELECTED_PERMISSION_KINDS =
  new Set<HostedVaultShareProjectionKind>(["protein-days.v0"]);

const DESIGN_GROUP_JOIN_FORM_PROPS = {
  alreadyActiveMember: true,
  expectedMembershipId: "hid_000000000000000000000001",
  groupName: "Four-week strength challenge",
  joinCode: "design-group-join",
  postJoinDestination: "/home",
} as const;

export interface GroupJoinPermissionsStudyProps {
  registryPermissions: readonly GroupJoinPermissionDisplay[];
}

export default function GroupJoinPermissionsStudy({
  registryPermissions,
}: GroupJoinPermissionsStudyProps) {
  const permissions = registryPermissions.filter((permission) =>
    DESIGN_GROUP_JOIN_PERMISSION_KINDS.has(
      permission.projectionScope.projectionKind,
    )
  );
  const activeVaultShareProjectionScopes = permissions
    .filter((permission) =>
      DESIGN_GROUP_JOIN_SELECTED_PERMISSION_KINDS.has(
        permission.projectionScope.projectionKind,
      )
    )
    .map((permission) => permission.projectionScope);

  return (
    <div
      className="flex min-h-[42rem] items-center justify-center rounded-3xl border border-border bg-background px-4 py-12 sm:px-8"
      data-design-study="group-join-sharing-permissions"
      id="group-join-sharing-permissions"
    >
      <div className="w-full max-w-md" inert>
        <GroupJoinAcceptForm
          {...DESIGN_GROUP_JOIN_FORM_PROPS}
          activeVaultShareProjectionScopes={activeVaultShareProjectionScopes}
          permissions={permissions}
        />
      </div>
    </div>
  );
}
