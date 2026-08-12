import type {
  HostedExecutionMemberActionRequestedWake,
} from "@murphai/hosted-execution";
import {
  applyLiveWorkoutMemberAction,
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
      await applyLiveWorkoutMemberAction({
        acceptedAt: input.wake.occurredAt,
        action: input.wake.request.action,
        vault: input.vaultRoot,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-action",
      });
  }
}
