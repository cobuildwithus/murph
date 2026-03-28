import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import { prepareHostedDispatchContext } from "../src/hosted-runtime/context.ts";
import { runHostedMaintenanceLoop } from "../src/hosted-runtime/maintenance.ts";

test("hosted maintenance loop preserves the empty-vault no-op baseline after activation bootstrap", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-maintenance-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

  try {
    await prepareHostedDispatchContext(
      vaultRoot,
      {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      {},
    );

    const metrics = await runHostedMaintenanceLoop({
      requestId: "evt_activation",
      runtimeEnv: {},
      vaultRoot,
    });

    assert.deepEqual(metrics, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
