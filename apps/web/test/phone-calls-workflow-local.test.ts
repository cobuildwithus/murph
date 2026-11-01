import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BaseBuilder, type WorkflowManifest } from "@workflow/builders";
import { createWorld } from "@workflow/world-local";
import { expect, it, vi } from "vitest";
import { getHookByToken, getRun, resumeHook, start } from "workflow/api";
import { setWorld } from "workflow/runtime";

import { buildHostedPhoneCallReconciliationHookToken } from "../src/lib/phone-calls/reconciliation-workflow-types";

const appDir = fileURLToPath(new URL("../", import.meta.url));

class HookTestBuilder extends BaseBuilder {
  manifest: WorkflowManifest = {};

  async build(): Promise<void> {
    const result = await this.createCombinedBundle({
      inputFiles: [path.join(appDir, "test/fixtures/workflow-v5/hook.ts")],
      stepsOutfile: this.config.stepsBundlePath,
      flowOutfile: this.config.workflowsBundlePath,
      bundleFinalOutput: false,
    });
    this.manifest = result.manifest;
  }
}

it("v5 local world conflicts on the per-call token and resumes the same reusable hook", async () => {
  const directory = await mkdtemp(path.join(appDir, ".workflow-test-"));
  const world = createWorld({ dataDir: path.join(directory, "data"), recoverActiveRuns: false });
  vi.stubEnv("WORKFLOW_TARGET_WORLD", "local");
  setWorld(world);
  try {
    const builder = new HookTestBuilder({
      buildTarget: "standalone",
      workingDir: appDir,
      dirs: [],
      stepsBundlePath: path.join(directory, "steps.mjs"),
      workflowsBundlePath: path.join(directory, "flow.mjs"),
      webhookBundlePath: path.join(directory, "webhook.mjs"),
      sourcemap: false,
    });
    await builder.build();
    const { POST } = await import(/* @vite-ignore */ pathToFileURL(path.join(directory, "flow.mjs")).href);
    world.registerHandler("__wkf_workflow_", POST);
    const workflows = Object.values(builder.manifest.workflows ?? {}).flatMap(Object.values);
    expect(workflows).toHaveLength(1);
    const workflow = workflows[0]!;
    const token = buildHostedPhoneCallReconciliationHookToken("synthetic-call");
    const run = await start(workflow, ["synthetic-call"]);
    await expect.poll(async () => (await getHookByToken(token)).runId, { timeout: 10_000 })
      .toBe(run.runId);

    const duplicate = await start(workflow, ["synthetic-call"]);
    await expect.poll(() => duplicate.status, { timeout: 10_000 }).toBe("failed");
    await expect(duplicate.returnValue).rejects.toMatchObject({
      cause: { name: "HookConflictError" },
    });
    expect((await getHookByToken(token)).runId).toBe(run.runId);

    expect((await resumeHook(token, "activation")).runId).toBe(run.runId);
    await expect.poll(async () => {
      const events = await world.events.list({ runId: run.runId });
      return events.data.some((event) => event.eventType === "wait_completed");
    }, { timeout: 10_000 }).toBe(true);
    expect(await run.status).toBe("running");
    expect((await resumeHook(token, "recovery-hint")).runId).toBe(run.runId);
    await expect(run.returnValue).resolves.toEqual(["activation", "recovery-hint"]);
    // Read the persisted terminal result again through a fresh handle.
    await expect(getRun(run.runId).returnValue).resolves.toEqual(["activation", "recovery-hint"]);
    await expect(getHookByToken(token)).rejects.toMatchObject({ name: "HookNotFoundError" });
    const steps = await world.steps.list({ runId: run.runId });
    expect(steps.data).toHaveLength(1);
    expect(steps.data[0]?.status).toBe("completed");
  } finally {
    await world.close?.();
    setWorld(undefined);
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 30_000);
