import assert from "node:assert/strict";
import { access, mkdtemp, rm, rm as remove } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  appendProfileSnapshot,
  initializeVault,
  readCurrentProfile,
  rebuildCurrentProfile,
} from "../src/index.js";

test("rebuildCurrentProfile removes stale current profile markdown when no snapshots remain", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-profile-"));
  const currentProfilePath = path.join(vaultRoot, "bank/profile/current.md");

  try {
    await initializeVault({ vaultRoot });
    await appendProfileSnapshot({
      vaultRoot,
      recordedAt: "2026-03-12T10:00:00.000Z",
      source: "manual",
      profile: {
        topGoalIds: ["goal_sleep"],
        sleep: {
          averageHours: 7,
        },
      },
    });

    await access(currentProfilePath);
    await remove(path.join(vaultRoot, "ledger/profile-snapshots"), {
      recursive: true,
      force: true,
    });

    const rebuilt = await rebuildCurrentProfile({ vaultRoot });
    const current = await readCurrentProfile({ vaultRoot });

    assert.equal(rebuilt.exists, false);
    assert.equal(rebuilt.snapshot, null);
    assert.equal(rebuilt.updated, true);
    assert.equal(current.exists, false);
    assert.equal(current.markdown, null);
    await assert.rejects(access(currentProfilePath));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
