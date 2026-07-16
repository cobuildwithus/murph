import { describe, expect, it } from "vitest";

import {
  buildMurphGroupReadPermissionProfileTomlLines,
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
      '"**/.env" = "deny"',
      '"**/.env.*" = "deny"',
      "",
      "[permissions.murph-group-read.network]",
      "enabled = false",
      "",
    ]);
  });
});
