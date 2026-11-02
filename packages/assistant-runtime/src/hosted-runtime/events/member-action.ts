import type { MealNameRepairInput } from "../meal-name-repair.ts";
import { createHostedBackgroundMaintenanceCancellation } from "../background-maintenance-cancellation.ts";
import type {
  HostedExecutionMemberActionRequestedWake,
} from "@murphai/hosted-execution";
import { deleteMealRecord } from "@murphai/vault-usecases/records";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  applyLiveWorkoutMemberAction,
  readLiveWorkoutCardSnapshot,
  setWorkoutUnitPreferences,
} from "@murphai/vault-usecases/workouts";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedMemberActionWake(input: {
  vaultRoot: string;
  mealNameRepair?: Omit<MealNameRepairInput, "vaultRoot" | "batch" | "memberId">;
  shouldYield?: (() => boolean) | null;
  wake: HostedExecutionMemberActionRequestedWake;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.request.action.kind) {
    case "meal.names.repair": {
      return executeMealNameRepairWake(input);
    }
    case "meal.delete": {
      let reason: "meal_not_found" | "meal_changed" | null = null;
      try {
        await deleteMealRecord({ vault: input.vaultRoot, lookup: input.wake.request.action.mealId });
      } catch (error) {
        if (!(error instanceof VaultCliError)) throw error;
        if (error.code === "not_found") reason = "meal_not_found";
        else if (error.code === "conflict") reason = "meal_changed";
        else throw error;
      }
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: input.wake.request.actionId,
            completedAt: new Date().toISOString(),
            schemaVersion: 1,
            status: reason === null ? "applied" : "rejected",
            reason,
          },
        },
      });
    }
    case "workout.live.apply": {
      const action = input.wake.request.action;
      const result = await applyLiveWorkoutMemberAction({
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
            ...(result.status !== "rejected" && result.result !== undefined
              ? { result: result.result }
              : {}),
            schemaVersion: 1,
            status: result.status,
          },
        },
      });
    }
    case "workout.live.snapshot": {
      const result = await readLiveWorkoutCardSnapshot({
        action: input.wake.request.action,
        vault: input.vaultRoot,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: input.wake.request.actionId,
            completedAt: new Date().toISOString(),
            reason: result.status === "rejected" ? result.reason : null,
            ...(result.status === "unchanged"
              ? { result: result.result }
              : {}),
            schemaVersion: 1,
            status: result.status,
          },
        },
      });
    }
  }
}

async function executeMealNameRepairWake(input: Parameters<typeof executeHostedMemberActionWake>[0]): Promise<HostedMailboxOutcome> {
  const action = input.wake.request.action;
  if (action.kind !== "meal.names.repair") throw new Error("Invalid repair action.");
  if (!input.mealNameRepair) throw new Error("Meal name repair runtime is unavailable.");
  const cancellation = createHostedBackgroundMaintenanceCancellation({
    signal: input.mealNameRepair.signal ?? null, shouldYield: input.shouldYield ?? null, timeoutMs: 180_000,
  });
  try {
    const { repairLegacyMealNames } = await import("../meal-name-repair.ts");
    const result = await repairLegacyMealNames({ ...input.mealNameRepair,
      signal: cancellation.signal ?? undefined, vaultRoot: input.vaultRoot,
      memberId: input.wake.userId, batch: action.batch });
    return createNoopMailboxEffect({ conversationMetrics: null, mailboxLane: "member-action",
      postCheckpointRecord: { kind: "member-action.outcome-recorded", outcome: {
        actionId: input.wake.request.actionId, completedAt: new Date().toISOString(),
        schemaVersion: 1, status: "applied", reason: null, result,
      } },
    });
  } finally {
    // Abort/failure must reach the mailbox owner, which retains the request and
    // retry deadline. A successful no-op would consume the accepted action.
    cancellation.dispose();
  }
}
