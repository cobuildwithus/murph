import type {
  HostedExecutionMemberActionRequestedWake,
} from "@murphai/hosted-execution";
import { deleteMealRecord } from "@murphai/vault-usecases/records";
import { resolveMetricDefinition } from "@murphai/query";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { addMeasurement, deterministicContractId, ID_PREFIXES, setMemoryDemographics, setMemoryDisplayName } from "@murphai/core";
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
  wake: HostedExecutionMemberActionRequestedWake;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.request.action.kind) {
    case "measurement.add": {
      const { actionId, requestedAt } = input.wake.request;
      const definition = resolveMetricDefinition(input.wake.request.action.metric)!;
      const result = await addMeasurement({
        vaultRoot: input.vaultRoot,
        onExisting: "keep",
        draft: {
          id: deterministicContractId(ID_PREFIXES.event, `member-action:${actionId}`),
          occurredAt: requestedAt,
          source: "manual",
          title: definition.displayName,
          measurements: [{
            metric: input.wake.request.action.metric,
            value: input.wake.request.action.value,
            unit: definition.canonicalUnit!,
          }],
        },
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId, completedAt: new Date().toISOString(),
            schemaVersion: 1, status: result.created ? "applied" : "unchanged", reason: null,
          },
        },
      });
    }
    case "display-name.set": {
      const request = input.wake.request;
      const result = await setMemoryDisplayName(input.vaultRoot, {
        displayName: input.wake.request.action.displayName,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: request.actionId, completedAt: new Date().toISOString(),
            schemaVersion: 1, status: result.changed ? "applied" : "unchanged", reason: null,
          },
        },
      });
    }
    case "demographics.set": {
      const request = input.wake.request;
      const result = await setMemoryDemographics(input.vaultRoot, {
        ...input.wake.request.action.patch,
        memberAction: { actionId: request.actionId, requestedAt: request.requestedAt },
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: request.actionId, completedAt: new Date().toISOString(),
            schemaVersion: 1, status: result.status, reason: result.reason,
          },
        },
      });
    }
    case "meal.names.repair": {
      // Retired operator action: drain old Web dispatches and restored requests
      // through the ordinary checkpoint owner without model, meal, or usage work.
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
        postCheckpointRecord: {
          kind: "member-action.outcome-recorded",
          outcome: {
            actionId: input.wake.request.actionId,
            completedAt: new Date().toISOString(),
            schemaVersion: 1,
            status: "unchanged",
            reason: null,
          },
        },
      });
    }
    case "meal.delete": {
      const reason = await removeMeal(input.vaultRoot, input.wake.request.action.mealId);
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

async function removeMeal(vaultRoot: string, mealId: string): Promise<"meal_not_found" | "meal_changed" | null> {
  try {
    await deleteMealRecord({ vault: vaultRoot, lookup: mealId });
    return null;
  } catch (error) {
    if (!(error instanceof VaultCliError)) throw error;
    if (error.code === "not_found") return "meal_not_found";
    if (error.code === "conflict") return "meal_changed";
    throw error;
  }
}
