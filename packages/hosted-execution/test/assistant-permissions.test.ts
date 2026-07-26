import { describe, expect, it } from "vitest";

import {
  buildMurphGroupReadPermissionProfileTomlLines,
  buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines,
  buildMurphHostedRootPermissionProfileTomlLines,
} from "../src/assistant-permissions.ts";

describe("ordinary hosted root Codex permissions", () => {
  it("preserves root and network authority while denying the managed auth file", () => {
    expect(
      buildMurphHostedRootPermissionProfileTomlLines({
        managedCodexAuthPath: "/var/lib/murph/.codex-hosted/auth.json",
      }),
    ).toEqual([
      "# Ordinary hosted root turns retain current filesystem and network authority while child tools cannot read the managed Codex credential file.",
      "[permissions.murph-hosted-root.filesystem]",
      '":root" = "write"',
      '"/.git" = "write"',
      '"/.agents" = "write"',
      '"/.codex" = "write"',
      '"/var/lib/murph/.codex-hosted/auth.json" = "deny"',
      "",
      "[permissions.murph-hosted-root.network]",
      "enabled = true",
      "",
    ]);
  });
});

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
});
