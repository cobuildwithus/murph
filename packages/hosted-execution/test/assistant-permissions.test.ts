import { describe, expect, it } from "vitest";

import {
  buildMurphGroupReadPermissionProfileTomlLines,
  buildMurphGroupRoomModelMaintenancePermissionProfileTomlLines,
  buildMurphHostedPermissionProfileTomlLines,
  MURPH_HOSTED_PERMISSION_PROFILES,
  readMurphHostedPermissionProfile,
  resolveMurphHostedPermissionProfile,
} from "../src/assistant-permissions.ts";

describe("ordinary hosted Codex permissions", () => {
  it("preserves each sandbox authority while denying the managed Codex home", () => {
    expect(
      buildMurphHostedPermissionProfileTomlLines({
        managedCodexHome: "/var/lib/murph/.codex-hosted",
      }),
    ).toEqual([
      "# Ordinary hosted turns retain their selected authority while child tools cannot access the managed Codex home.",
      "[permissions.murph-hosted-read-only]",
      'extends = ":read-only"',
      "",
      "[permissions.murph-hosted-read-only.filesystem]",
      '"/var/lib/murph/.codex-hosted" = "deny"',
      "",
      "[permissions.murph-hosted-workspace]",
      'extends = ":workspace"',
      "",
      "[permissions.murph-hosted-workspace.filesystem]",
      '"/var/lib/murph/.codex-hosted" = "deny"',
      "",
      "[permissions.murph-hosted-root.filesystem]",
      '":root" = "write"',
      '"/.git" = "write"',
      '"/.agents" = "write"',
      '"/.codex" = "write"',
      '"/var/lib/murph/.codex-hosted" = "deny"',
      "",
      "[permissions.murph-hosted-root.network]",
      "enabled = true",
      "",
    ]);
  });

  it("resolves every supported hosted sandbox and rejects unrelated profiles", () => {
    for (const [sandbox, expected] of Object.entries(
      MURPH_HOSTED_PERMISSION_PROFILES,
    )) {
      expect(
        resolveMurphHostedPermissionProfile(
          sandbox as keyof typeof MURPH_HOSTED_PERMISSION_PROFILES,
        ),
      ).toBe(expected);
      expect(readMurphHostedPermissionProfile(expected.id)).toBe(expected);
    }

    expect(resolveMurphHostedPermissionProfile(null)).toBe(
      MURPH_HOSTED_PERMISSION_PROFILES["danger-full-access"],
    );
    expect(readMurphHostedPermissionProfile("murph-group-read")).toBeNull();
    expect(readMurphHostedPermissionProfile(null)).toBeNull();
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
