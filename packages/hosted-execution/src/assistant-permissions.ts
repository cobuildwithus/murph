export const MURPH_HOSTED_ROOT_PERMISSION_PROFILE = "murph-hosted-root" as const;
export const MURPH_GROUP_READ_PERMISSION_PROFILE = "murph-group-read" as const;
export const MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE =
  "murph-group-room-model-maintenance" as const;

export function buildMurphHostedRootPermissionProfileTomlLines(input: {
  managedCodexAuthPath: string;
}): readonly string[] {
  return [
    "# Ordinary hosted root turns retain current filesystem and network authority while child tools cannot read the managed Codex credential file.",
    `[permissions.${MURPH_HOSTED_ROOT_PERMISSION_PROFILE}.filesystem]`,
    '":root" = "write"',
    `${JSON.stringify(input.managedCodexAuthPath)} = "deny"`,
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
