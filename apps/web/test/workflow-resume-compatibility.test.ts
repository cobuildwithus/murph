import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { HookSchema, WorkflowRunSchema } from "@workflow/world";
import { createWorld } from "@workflow/world-local";
import { expect, it, vi } from "vitest";
import { resumeHook } from "workflow/api";
import { setWorld } from "workflow/runtime";

it("v5 resumes a v4 hook using its run's protocol and original deployment", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "workflow-compatibility-"));
  const world = createWorld({ dataDir: directory, recoverActiveRuns: false });
  const now = new Date("2026-10-30T00:00:00.000Z");
  const run = WorkflowRunSchema.parse({
    runId: "wrun_synthetic_legacy",
    workflowName: "synthetic-reconciliation",
    deploymentId: "dpl_synthetic_v4",
    status: "running",
    specVersion: 2,
    executionContext: { workflowCoreVersion: "4.2.4" },
    createdAt: now,
    updatedAt: now,
  });
  const hook = HookSchema.parse({
    runId: run.runId,
    hookId: "hook_synthetic_legacy",
    token: "synthetic-legacy-token",
    ownerId: "synthetic-owner",
    projectId: "synthetic-project",
    environment: "development",
    specVersion: 2,
    createdAt: now,
  });
  const readRun = vi.spyOn(world.runs, "get").mockResolvedValue(run);
  vi.spyOn(world.hooks, "getByToken").mockResolvedValue(hook);
  const write = vi.spyOn(world.events, "create").mockResolvedValue({});
  const queue = vi.spyOn(world, "queue").mockResolvedValue({ messageId: null });
  setWorld(world);
  try {
    expect((await resumeHook(hook.token, { reason: "reconcile" })).runId).toBe(run.runId);
    expect(readRun).toHaveBeenCalledWith(run.runId, { resolveData: "none" });
    expect(write).toHaveBeenCalledWith(run.runId, expect.objectContaining({
      eventType: "hook_received",
      specVersion: 2,
      correlationId: hook.hookId,
      eventData: { token: hook.token, payload: expect.any(Uint8Array) },
    }), expect.any(Object));
    expect(queue).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      runId: run.runId,
    }), expect.objectContaining({ deploymentId: run.deploymentId, specVersion: 2 }));
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(queue.mock.invocationCallOrder[0]!);
  } finally {
    await world.close?.();
    setWorld(undefined);
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
