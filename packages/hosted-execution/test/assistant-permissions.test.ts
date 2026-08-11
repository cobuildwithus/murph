import { describe, expect, it } from "vitest";

import {
  buildMurphGroupReadPermissionProfileTomlLines,
  buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines,
  buildMurphMemberMemoryMaintenancePermissionProfileTomlLines,
  buildMurphMemberWorkspacePermissionProfileTomlLines,
} from "../src/assistant-permissions.ts";

describe("group-read Codex permissions", () => {
  it("grants read-only workspace access with non-overlapping secret carve-outs", () => {
    expect(buildMurphGroupReadPermissionProfileTomlLines()).toEqual([
      "# Read-only, ephemeral consultations initiated by a current group member.",
      "[permissions.murph-group-read.filesystem]",
      '":minimal" = "read"',
      "glob_scan_max_depth = 64",
      "",
      '[permissions.murph-group-read.filesystem.":workspace_roots"]',
      '"." = "read"',
      '".runtime" = "deny"',
      '".codex" = "deny"',
      '"vault-share" = "deny"',
      '"derived/vault-share" = "deny"',
      '"**/.env" = "deny"',
      '"**/.env.*" = "deny"',
      "",
      "[permissions.murph-group-read.network]",
      "enabled = false",
      "",
    ]);
  });

  it("denies workspace and network access to silent room-model maintenance", () => {
    expect(
      buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines(),
    ).toEqual([
      "# Silent group room-model consolidation uses only its host-owned dynamic tool.",
      "[permissions.murph-group-room-model-maintenance.filesystem]",
      '":minimal" = "read"',
      "glob_scan_max_depth = 1",
      "",
      '[permissions.murph-group-room-model-maintenance.filesystem.":workspace_roots"]',
      '"." = "deny"',
      "",
      "[permissions.murph-group-room-model-maintenance.network]",
      "enabled = false",
      "",
    ]);
  });

  it("confines silent member maintenance writes to canonical memory infrastructure", () => {
    expect(
      buildMurphMemberMemoryMaintenancePermissionProfileTomlLines(),
    ).toEqual([
      "# Silent member maintenance may read the vault and write only canonical memory infrastructure.",
      "[permissions.murph-member-memory-maintenance.filesystem]",
      '":minimal" = "read"',
      "glob_scan_max_depth = 64",
      "",
      '[permissions.murph-member-memory-maintenance.filesystem.":workspace_roots"]',
      '"." = "read"',
      '"bank/memory.md" = "write"',
      '"audit" = "write"',
      '".runtime/locks/canonical-write" = "write"',
      '".runtime/locks/canonical-resources" = "write"',
      '".runtime/operations" = "write"',
      '".codex" = "deny"',
      '"**/.env" = "deny"',
      '"**/.env.*" = "deny"',
      "",
      "[permissions.murph-member-memory-maintenance.network]",
      "enabled = false",
      "",
    ]);
  });

  it("keeps ordinary hosted vault writes while making canonical automations read-only", () => {
    expect(buildMurphMemberWorkspacePermissionProfileTomlLines()).toEqual([
      "# Ordinary hosted member turns may mutate the vault except canonical automations.",
      "[permissions.murph-member-workspace.filesystem]",
      '":minimal" = "read"',
      '":tmpdir" = "write"',
      '":slash_tmp" = "write"',
      "glob_scan_max_depth = 64",
      "",
      '[permissions.murph-member-workspace.filesystem.":workspace_roots"]',
      '"." = "write"',
      '"bank/automations" = "read"',
      "",
      "[permissions.murph-member-workspace.network]",
      "enabled = true",
      "",
    ]);
  });

});
