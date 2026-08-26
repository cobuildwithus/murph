import type {
  HostedExecutionMemberActionRequestedWake,
} from "@murphai/hosted-execution";
import {
  applyLiveWorkoutMemberAction,
  setWorkoutUnitPreferences,
} from "@murphai/vault-usecases/workouts";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedMemberActionWake(input: {
  vaultRoot: string;
  wake: HostedExecutionMemberActionRequestedWake;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.request.action.kind) {
    case "workout.live.apply":
      const action = input.wake.request.action;
      const result = action.mutations.length === 0
        ? { status: "applied" as const }
        : await applyLiveWorkoutMemberAction({
            acceptedAt: input.wake.occurredAt,
            action,
            actionId: input.wake.request.actionId,
            vault: input.vaultRoot,
          });
      if (
        result.status !== "rejected"
        && action.weightUnitPreference !== undefined
      ) {
        await setWorkoutUnitPreferences({
          recordedAt: input.wake.occurredAt,
          vault: input.vaultRoot,
          weight: action.weightUnitPreference,
        });
      }
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: input.wake.request.actionId,
            completedAt: new Date().toISOString(),
            reason: result.status === "rejected" ? result.reason : null,
            schemaVersion: 1,
            status: result.status,
          },
        },
      });
  }
}
