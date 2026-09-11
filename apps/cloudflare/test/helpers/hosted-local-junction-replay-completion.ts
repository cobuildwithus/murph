import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";

import type { HostedLocalFullStackScenario } from "./hosted-local-full-stack-scenario.js";

type ReplayScenario = Pick<HostedLocalFullStackScenario,
  "buildFailureMessage" | "readJunctionDeviceSyncReplayDrainStatus" | "waitForHostedCompletion"
>;

export async function waitForHostedJunctionReplayCompletion(input: {
  assertNoJobFailures: (status: HostedRunnerStatusResponse) => Promise<void>;
  connectionId: string;
  deadlineAtMs: number;
  memberId: string;
  scenario: ReplayScenario;
}): Promise<HostedRunnerStatusResponse> {
  let lastDrain: Awaited<ReturnType<ReplayScenario["readJunctionDeviceSyncReplayDrainStatus"]>> | null = null;

  while (Date.now() < input.deadlineAtMs) {
    const status = await input.scenario.waitForHostedCompletion(input.memberId, {
      requireProgress: lastDrain === null,
      timeoutMs: input.deadlineAtMs - Date.now(),
    });
    await input.assertNoJobFailures(status);
    lastDrain = await input.scenario.readJunctionDeviceSyncReplayDrainStatus({
      connectionId: input.connectionId,
      memberId: input.memberId,
    });
    if (Date.now() >= input.deadlineAtMs) break;

    // Mailbox handoff can settle while its connection owner retains future work.
    // Dirty zero alone can also mean terminal failure, so keep the job checks.
    if (
      !lastDrain.hasPendingDirtyConnection
      && !lastDrain.hasPendingDirtyConnectionForUser
      && lastDrain.pendingDirtyResourceCount === 0
    ) {
      // The first status may precede the final acknowledgment. Return a current
      // settled status so replica assertions cannot read that earlier checkpoint.
      const completed = await input.scenario.waitForHostedCompletion(input.memberId, {
        requireProgress: false,
        timeoutMs: input.deadlineAtMs - Date.now(),
      });
      await input.assertNoJobFailures(completed);
      if (Date.now() < input.deadlineAtMs) return completed;
      break;
    }
    await new Promise<void>((resolve) => setTimeout(
      resolve,
      Math.min(250, input.deadlineAtMs - Date.now()),
    ));
  }

  throw new Error(await input.scenario.buildFailureMessage(input.memberId, [
    "Timed out waiting for the complete hosted Junction replay to drain.",
    `dirty drain status: ${JSON.stringify(lastDrain && {
      hasPendingDirtyConnection: lastDrain.hasPendingDirtyConnection,
      hasPendingDirtyConnectionForUser: lastDrain.hasPendingDirtyConnectionForUser,
      pendingDirtyResourceCount: lastDrain.pendingDirtyResourceCount,
    })}`,
  ]));
}
