export const MURPH_GROUP_READ_PERMISSION_PROFILE = 'murph-group-read' as const

export function buildMurphGroupReadPermissionProfileTomlLines(): readonly string[] {
  return [
    '# Read-only, ephemeral consultations initiated by a current group member.',
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    'glob_scan_max_depth = 64',
    '',
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "read"',
    '".runtime" = "deny"',
    '".codex" = "deny"',
    '"**/.env" = "deny"',
    '"**/.env.*" = "deny"',
    '',
    `[permissions.${MURPH_GROUP_READ_PERMISSION_PROFILE}.network]`,
    'enabled = false',
    '',
  ]
}
