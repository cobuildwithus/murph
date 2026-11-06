import { createPhaseInput, mocks } from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { initializeVault, upsertAutomation } from "@murphai/core";
import {
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  MURPH_MANAGED_AUTOMATIONS,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";

it("projects model reviews without timing reads, preserving ordinary instructions and host-owned pins", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "automation-model-review-"));
  const inputId = "ain_44444444444444444444444444444444";
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
    const request = (request: Parameters<NonNullable<NonNullable<AssistantExecutionContext["hosted"]>["automationTool"]>["request"]>[0]) => scope.runAutoReplyGroup({
      executionContext: lane.executionContext,
      inputIds: [inputId],
      turnEnvironment: null,
      operation: async context => {
        if (!context.hosted?.automationTool) throw new Error("Expected automation port.");
        return context.hosted.automationTool.request(request);
      },
    });
    for (const managed of [false, true]) {
      const instructions = managed
        ? MURPH_MANAGED_AUTOMATIONS.find(seed => seed.automationId === MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID)!.instructions
        : "Retain this complete synthetic instruction. ".repeat(800).trim();
      const { record } = await upsertAutomation({
        vaultRoot, status: "active", continuityPolicy: "fresh",
        ...(managed ? { automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID } : {}),
        slug: managed ? "synthetic-managed" : "synthetic-ordinary",
        title: "Synthetic review",
        instructions,
        assistantTargetOverride: { model: "gpt-6.1-sol", reasoningEffort: "medium" },
        contextReferences: [{ entityKind: "workout_format", entityId: "wfmt_synthetic" }],
        schedule: { kind: "dailyLocal", localTime: "09:00", timeZone: "UTC" },
        route: { channel: "linq", deliveryTarget: "synthetic-thread", threadIsDirect: true,
          identityId: "synthetic-account", participantId: "synthetic-actor", threadId: "synthetic-thread" },
        tags: managed ? [] : ["murph-managed:weekly-usage-optimizer"],
      });
      const recordPath = path.join(vaultRoot, record.relativePath);
      const before = await readFile(recordPath, "utf8");
      mocks.resolveAssistantCronDefaultTimeZoneProjection.mockClear();
      const compact = await request({ action: "inspect", lookup: record.automationId, view: "model_review" });
      expect(mocks.resolveAssistantCronDefaultTimeZoneProjection).not.toHaveBeenCalled();
      expect(compact).toEqual({
        action: "inspect", view: "model_review", automationId: record.automationId,
        lookupId: record.slug, managed, assistantTargetOverride: record.assistantTargetOverride,
        contextReferences: record.contextReferences, title: record.title,
        schedule: record.schedule, status: record.status, updatedAt: record.updatedAt,
        deliveryChannel: "linq", routeBinding: "preserved",
        ...(managed ? { instructionsOmitted: "managed_model_preserved" } : { instructions }),
      });
      const full = await request({ action: "inspect", lookup: record.automationId });
      expect(full).toMatchObject({ action: "inspect", instructions, managed,
        executionInspection: { status: "available" }, occurrenceProjection: expect.any(Object) });
      expect(await request({ action: "inspect", lookup: record.automationId, view: "full" })).toEqual(full);
      expect(await readFile(recordPath, "utf8")).toBe(before);
      const compactBytes = Buffer.byteLength(JSON.stringify(compact));
      const fullBytes = Buffer.byteLength(JSON.stringify(full));
      expect(compactBytes).toBeLessThan(managed ? fullBytes / 10 : fullBytes - 500);
      process.stdout.write(JSON.stringify({ automationReviewBytes: { managed, fullBytes, compactBytes } }) + "\n");
    }
  } finally {
    await drainHostedRuntimeLogWritesBestEffort();
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
