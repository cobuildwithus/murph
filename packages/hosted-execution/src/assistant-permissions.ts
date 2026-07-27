export const MURPH_HOSTED_ROOT_PERMISSION_PROFILE = "murph-hosted-root" as const;
export const MURPH_HOSTED_READ_ONLY_PERMISSION_PROFILE =
  "murph-hosted-read-only" as const;
export const MURPH_HOSTED_WORKSPACE_PERMISSION_PROFILE =
  "murph-hosted-workspace" as const;
export const MURPH_GROUP_READ_PERMISSION_PROFILE = "murph-group-read" as const;
export const MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE =
  "murph-group-room-model-maintenance" as const;

export const MURPH_HOSTED_PERMISSION_PROFILES = {
  "read-only": {
    extends: ":read-only",
    id: MURPH_HOSTED_READ_ONLY_PERMISSION_PROFILE,
  },
  "workspace-write": {
    extends: ":workspace",
    id: MURPH_HOSTED_WORKSPACE_PERMISSION_PROFILE,
  },
  "danger-full-access": {
    extends: null,
    id: MURPH_HOSTED_ROOT_PERMISSION_PROFILE,
  },
} as const;

export type MurphHostedSandbox = keyof typeof MURPH_HOSTED_PERMISSION_PROFILES;
export type MurphHostedPermissionProfile =
  (typeof MURPH_HOSTED_PERMISSION_PROFILES)[MurphHostedSandbox];

const murphHostedPermissionProfiles = Object.values(
  MURPH_HOSTED_PERMISSION_PROFILES,
);

export function resolveMurphHostedPermissionProfile(
  sandbox: MurphHostedSandbox | null | undefined,
): MurphHostedPermissionProfile {
  return MURPH_HOSTED_PERMISSION_PROFILES[sandbox ?? "danger-full-access"];
}

export function readMurphHostedPermissionProfile(
  id: string | null | undefined,
): MurphHostedPermissionProfile | null {
  return murphHostedPermissionProfiles.find((profile) => profile.id === id) ?? null;
}

export function buildMurphHostedPermissionProfileTomlLines(input: {
  managedCodexHome: string;
}): readonly string[] {
  return [
    "# Ordinary hosted turns retain their selected authority while child tools cannot access the managed Codex home.",
    `[permissions.${MURPH_HOSTED_READ_ONLY_PERMISSION_PROFILE}]`,
    'extends = ":read-only"',
    "",
    `[permissions.${MURPH_HOSTED_READ_ONLY_PERMISSION_PROFILE}.filesystem]`,
    `${JSON.stringify(input.managedCodexHome)} = "deny"`,
    "",
    `[permissions.${MURPH_HOSTED_WORKSPACE_PERMISSION_PROFILE}]`,
    'extends = ":workspace"',
    "",
    `[permissions.${MURPH_HOSTED_WORKSPACE_PERMISSION_PROFILE}.filesystem]`,
    `${JSON.stringify(input.managedCodexHome)} = "deny"`,
    "",
    `[permissions.${MURPH_HOSTED_ROOT_PERMISSION_PROFILE}.filesystem]`,
    '":root" = "write"',
    // Preserve danger-full-access semantics for Codex's protected top-level
    // metadata names. Without explicit writes, Linux sandbox setup tries to
    // create missing mount targets under the container's immutable `/`.
    '"/.git" = "write"',
    '"/.agents" = "write"',
    '"/.codex" = "write"',
    `${JSON.stringify(input.managedCodexHome)} = "deny"`,
    "",
    `[permissions.${MURPH_HOSTED_ROOT_PERMISSION_PROFILE}.network]`,
    "enabled = true",
    "",
  ];
}

export function buildMurphGroupReadPermissionProfileTomlLines(): readonly string[] {
  return [
    "# Read-only, ephemeral consultations initiated by a current group member.",
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    "glob_scan_max_depth = 64",
    "",
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "read"',
    '".runtime" = "deny"',
    '".codex" = "deny"',
    '"vault-share" = "deny"',
    '"derived/vault-share" = "deny"',
    '"**/.env" = "deny"',
    '"**/.env.*" = "deny"',
    "",
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.network]`,
    "enabled = false",
    "",
  ];
}

export function buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines(): readonly string[] {
  return [
    "# Silent group room-model consolidation uses only its host-owned dynamic tool.",
    `[permissions.${MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    "glob_scan_max_depth = 1",
    "",
    `[permissions.${MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "deny"',
    "",
    `[permissions.${MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE}.network]`,
    "enabled = false",
    "",
  ];
}
