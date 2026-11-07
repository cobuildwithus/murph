import { createPhaseInput, mocks } from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { initializeVault, listAutomations, patchAutomation, showAutomation } from "@murphai/core";
import { buildOnboardingFirstPersonalReadAutomationSaveRequest, completeAssistantOnboarding, listAssistantCronJobs, MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID } from "@murphai/assistant-engine";
import type {
  AssistantAutomationOperationScope,
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";

type AssistantHostedAutomationTool = NonNullable<NonNullable<AssistantExecutionContext["hosted"]>["automationTool"]>;

const inputId = "ain_44444444444444444444444444444444";
const saveRequest = {
  action: "save",
  title: "Daily stretch",
  instructions: "Remind me to stretch for five minutes.",
  schedule: { kind: "dailyLocal", localTime: "09:00", timeZone: "UTC" },
} as const;

async function withAutomationRuns(
  operation: (fixture: {
    vaultRoot: string;
    run: <T>(operation: (tool: AssistantHostedAutomationTool) => Promise<T>, inputIds?: string[]) => Promise<T>;
  }) => Promise<void>,
) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "automation-replay-"));
  try {
    await initializeVault({ createdAt: "2026-08-01T12:00:00.000Z", timezone: "UTC", vaultRoot });
    mocks.readAssistantInputEvent.mockResolvedValue({
      conversation: { accountId: "synthetic-account", actorId: "synthetic-actor", actorIsSelf: false,
        source: "linq", threadId: "synthetic-thread", threadIsDirect: true },
      replyTarget: { channel: "linq", messageId: "synthetic-message", threadId: "synthetic-thread" },
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({ assistantInputIds: [inputId], importedCount: 1, vaultRoot }));
    const lane = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const scope = lane?.operationScope as AssistantAutomationOperationScope | undefined;
    if (!lane?.executionContext || !scope) throw new Error("Expected automation scope.");
    await operation({
      vaultRoot,
      run: (operation, inputIds = [inputId]) => scope.runAutoReplyGroup({
        executionContext: lane.executionContext,
        inputIds,
        turnEnvironment: null,
        operation: async context => {
          if (!context.hosted?.automationTool) throw new Error("Expected automation port.");
          return operation(context.hosted.automationTool);
        },
      }),
    });
  } finally {
    await drainHostedRuntimeLogWritesBestEffort();
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

it("replays an ordinary save in a fresh run without creating a second reminder", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    await run(tool => tool.request(saveRequest, { acceptedInputIds: [inputId] }));
    await run(tool => tool.request(saveRequest, { acceptedInputIds: [inputId] }));
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(1);
  });
});

const otherInputId = "ain_55555555555555555555555555555555";
const accepted = { acceptedInputIds: [inputId] };

it("replays stored purpose despite a different title, instructions and schedule shape", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const first = await run(tool => tool.request(saveRequest, accepted));
    const replay = await run(tool => tool.request({ ...saveRequest, title: "Evening walk",
      instructions: "Remind me to walk.", schedule: { kind: "cron", expression: "0 18 * * *", timeZone: "UTC" } }, accepted));
    expect(replay).toMatchObject({ action: "save", created: false, title: saveRequest.title,
      instructions: saveRequest.instructions, routeBinding: "preserved" });
    expect(replay).toMatchObject({ automationId: first.action === "save" ? first.automationId : "missing" });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(1);
  });
});

it("preserves stored replay purpose after an unavailable timing projection recovers on readback", async () => {
  await withAutomationRuns(async ({ run }) => {
    const request = { ...saveRequest, schedule: { kind: "dailyLocal", localTime: "09:00" } } as const;
    await run(tool => tool.request(request, accepted));
    mocks.resolveAssistantCronDefaultTimeZoneProjection.mockClear();
    mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValueOnce({
      timeZone: "UTC",
      vaultTimeZoneVerified: false,
    });

    const replay = await run(tool => tool.request(request, accepted));

    expect(mocks.resolveAssistantCronDefaultTimeZoneProjection).toHaveBeenCalledTimes(2);
    expect(replay).toMatchObject({
      created: false,
      routeBinding: "preserved",
      title: saveRequest.title,
      instructions: saveRequest.instructions,
      occurrenceProjection: { status: "resolved" },
    });
  });
});

it("returns fresh replay purpose when the stored record changes before timing readback", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const request = { ...saveRequest, schedule: { kind: "dailyLocal", localTime: "09:00" } } as const;
    const saved = await run(tool => tool.request(request, accepted));
    if (saved.action !== "save") throw new Error("Expected save.");
    const purpose = { title: "Updated stretch", instructions: "Remind me to stretch gently." };
    mocks.resolveAssistantCronDefaultTimeZoneProjection.mockClear();
    mocks.resolveAssistantCronDefaultTimeZoneProjection.mockImplementationOnce(async () => {
      await patchAutomation({
        vaultRoot,
        lookup: saved.automationId,
        expectedUpdatedAt: saved.updatedAt,
        now: new Date(Date.parse(saved.updatedAt) + 1_000),
        ...purpose,
      });
      return { timeZone: "UTC", vaultTimeZoneVerified: false };
    });

    const replay = await run(tool => tool.request(request, accepted));

    expect(mocks.resolveAssistantCronDefaultTimeZoneProjection).toHaveBeenCalledTimes(2);
    expect(await showAutomation({ vaultRoot, automationId: saved.automationId })).toMatchObject(purpose);
    expect(replay).toMatchObject({
      created: false,
      routeBinding: "preserved",
      ...purpose,
      occurrenceProjection: {
        status: "unavailable",
        issues: expect.arrayContaining(["record_readback_mismatch"]),
      },
    });
  });
});

it.each(["active", "archived"] as const)("replays the current %s edited record without changing bytes or updatedAt", async status => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const saved = await run(tool => tool.request(saveRequest, accepted));
    if (saved.action !== "save") throw new Error("Expected save.");
    const edited = await patchAutomation({ vaultRoot, lookup: saved.automationId,
      expectedUpdatedAt: saved.updatedAt, title: "Edited stretch", instructions: "Stretch gently.", status });
    const file = path.join(vaultRoot, edited.record.relativePath);
    const before = await readFile(file, "utf8");
    const replay = await run(tool => tool.request(saveRequest, accepted));
    expect(replay).toMatchObject({ created: false, title: edited.record.title, instructions: edited.record.instructions,
      status, updatedAt: edited.record.updatedAt, routeBinding: "preserved" });
    expect(await showAutomation({ vaultRoot, automationId: saved.automationId })).toEqual(edited.record);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});

it("does not consume a slot for a real rejected create before correction and cold replay", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const saved = await run(async tool => {
      await expect(tool.request({ ...saveRequest, instructions: "" }, accepted)).rejects.toThrow();
      expect((await listAutomations({ vaultRoot })).items).toHaveLength(0);
      return tool.request(saveRequest, accepted);
    });
    const replay = await run(tool => tool.request(saveRequest, accepted));
    expect(replay).toMatchObject({ created: false, automationId: saved.action === "save" ? saved.automationId : "missing" });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(1);
  });
});

it("replays two slots in order before a third save allocates another slot", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const originals = await run(async tool => [await tool.request(saveRequest, accepted),
      await tool.request({ ...saveRequest, instructions: "Second stretch." }, accepted)]);
    const replays = await run(async tool => [await tool.request(saveRequest, accepted),
      await tool.request(saveRequest, accepted), await tool.request(saveRequest, accepted)]);
    for (let index = 0; index < 2; index++) {
      const original = originals[index];
      expect(replays[index]).toMatchObject({ created: false, automationId: original?.action === "save" ? original.automationId : "missing" });
    }
    expect(replays[2]).toMatchObject({ created: true });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(3);
  });
});

it("replays separately saved inputs in accepted scope order", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const originals: Awaited<ReturnType<AssistantHostedAutomationTool["request"]>>[] = [];
    for (const id of [inputId, otherInputId]) originals.push(await run(tool => tool.request(saveRequest, { acceptedInputIds: [id] }), [id]));
    const results = await run(async tool => [await tool.request(saveRequest, { acceptedInputIds: [inputId, otherInputId] }),
      await tool.request(saveRequest, { acceptedInputIds: [inputId, otherInputId] })], [inputId, otherInputId]);
    results.forEach((result, index) => {
      const original = originals[index];
      expect(result).toMatchObject({ created: false, automationId: original?.action === "save" ? original.automationId : "missing" });
    });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(2);
  });
});

it("admits another input mid-run without returning the run's own write", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    await run(async tool => {
      const first = await tool.request(saveRequest, accepted);
      const second = await tool.request(saveRequest, { acceptedInputIds: [inputId, otherInputId] });
      expect(first).toMatchObject({ created: true });
      expect(second).toMatchObject({ created: true });
      if (first.action !== "save" || second.action !== "save") throw new Error("Expected saves.");
      expect(second.automationId).not.toBe(first.automationId);
    });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(2);
    const replay = await run(tool => tool.request(saveRequest, { acceptedInputIds: [otherInputId] }), [otherInputId]);
    expect(replay).toMatchObject({ created: false });
  });
});

it("creates a distinct record for another input with identical title and schedule", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    await run(tool => tool.request(saveRequest, accepted));
    await run(tool => tool.request(saveRequest, { acceptedInputIds: [otherInputId] }), [otherInputId]);
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(2);
  });
});

it("preserves recipe conflicts and the unscoped random-id path", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    const recipe = { ...saveRequest, slug: "synthetic-stretch-recipe" };
    await run(tool => tool.request(recipe, accepted));
    await expect(run(tool => tool.request(recipe, accepted))).rejects.toMatchObject({ code: "VAULT_AUTOMATION_CONFLICT" });
    await run(tool => tool.request(saveRequest));
    await run(tool => tool.request(saveRequest));
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(3);
  });
});

it("preserves the fixed onboarding first read and its once-only transition", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    await completeAssistantOnboarding({ completedAt: "2026-08-06T21:00:00.000Z", reason: "user_answered", vault: vaultRoot });
    await run(async tool => {
      const context = { ...accepted, onboardingFirstReadCompletionTransition: true as const };
      const request = buildOnboardingFirstPersonalReadAutomationSaveRequest({ now: new Date("2026-08-06T21:00:00.000Z") });
      expect(await tool.request(request, context)).toMatchObject({ created: true, automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID });
      await expect(tool.request(request, context)).rejects.toThrow("only once");
    });
    expect((await listAutomations({ vaultRoot })).items).toHaveLength(1);
  });
});

it("projects one cron job and one next occurrence after a replay", async () => {
  await withAutomationRuns(async ({ vaultRoot, run }) => {
    await run(tool => tool.request(saveRequest, accepted));
    await run(tool => tool.request(saveRequest, accepted));
    const jobs = await listAssistantCronJobs(vaultRoot);
    expect(jobs).toHaveLength(1);
    expect(jobs.map(job => job.state.nextRunAt).filter(Boolean)).toHaveLength(1);
    expect(jobs[0]?.enabled).toBe(true);
  });
});
