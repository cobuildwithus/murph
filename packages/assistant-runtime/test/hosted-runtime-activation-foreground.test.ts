import { describe, expect, it } from "vitest";
import {
  createMemberActivationSignupWelcomeSystemMailboxItem,
  createPhaseInput,
  mocks,
  runHostedWorkspaceAssistantPhase,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";

describe("activation foreground priority", () => {
  it("lets a second reply run before activation resumes after post-reply setup yields", async () => {
    const sequence: string[] = [];
    const activation = createMemberActivationSignupWelcomeSystemMailboxItem();
    let foregroundArrived = false;
    let activationAttempts = 0;
    let replies = 0;
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      if (!input.allowedRouteActions?.includes("apply-member-activation")
        || !input.allowedWakeKinds?.includes("member.activated")) return null;
      activationAttempts += 1;
      if (activationAttempts === 1) {
        foregroundArrived = true;
        expect(input.shouldYieldBackgroundMaintenance?.()).toBe(true);
        sequence.push("activation-yielded");
        return { item: activation, itemId: activation.itemId, status: "preempted" };
      }
      sequence.push("activation-resumed");
      return {
        item: activation,
        itemId: activation.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-activated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementation(async () => {
      replies += 1;
      sequence.push(`reply-${replies}`);
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        progressed: true,
        redactedLogEntries: [],
      };
    });

    const first = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance: () => foregroundArrived,
    }));
    expect(sequence).toEqual(["reply-1"]);
    await first.afterCheckpoint?.();
    expect(sequence).toEqual(["reply-1", "activation-yielded"]);
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();

    foregroundArrived = false;
    const second = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance: () => foregroundArrived,
    }));
    expect(sequence).toEqual(["reply-1", "activation-yielded", "reply-2"]);
    await second.afterCheckpoint?.();
    expect(sequence).toEqual([
      "reply-1", "activation-yielded", "reply-2", "activation-resumed",
    ]);
  });
});
