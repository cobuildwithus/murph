export const MURPH_GROUP_READ_PERMISSION_PROFILE = "murph-group-read" as const;
export const MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE =
  "murph-group-room-model-maintenance" as const;
export const MURPH_MEMBER_READ_PERMISSION_PROFILE =
  "murph-member-read" as const;
export const MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE =
  "murph-member-workspace" as const;

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

export function buildMurphMemberReadPermissionProfileTomlLines(): readonly string[] {
  return [
    "# Read-only scheduled member reflection using the current private vault.",
    `[permissions.${MURPH_MEMBER_READ_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    "glob_scan_max_depth = 64",
    "",
    `[permissions.${MURPH_MEMBER_READ_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "read"',
    '".runtime" = "deny"',
    '".codex" = "deny"',
    '"**/.env" = "deny"',
    '"**/.env.*" = "deny"',
    "",
    `[permissions.${MURPH_MEMBER_READ_PERMISSION_PROFILE}.network]`,
    "enabled = false",
    "",
  ];
}

export function buildMurphMemberWorkspacePermissionProfileTomlLines(): readonly string[] {
  return [
    "# Ordinary hosted member turns may mutate the vault except canonical automations.",
    `[permissions.${MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    '"/app" = "read"',
    '":tmpdir" = "write"',
    '":slash_tmp" = "write"',
    "glob_scan_max_depth = 64",
    "",
    `[permissions.${MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "write"',
    '"bank/automations" = "read"',
    "",
    `[permissions.${MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE}.network]`,
    "enabled = true",
    "",
  ];
}
