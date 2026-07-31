import "server-only";

import { after } from "next/server";

import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import {
  signalHostedRuntimeWakeRuntime,
} from "../hosted-orchestration/signal-runtime";

export function scheduleHostedInferenceRuntimeWake(memberId: string): void {
  const task = async () => {
    const deadlineMs = createHostedPostCommitDeadline(undefined);
    try {
      await waitForHostedPostCommitOperation({
        deadlineMs,
        operation: (abortSignal) =>
          signalHostedRuntimeWakeRuntime({
            abortSignal,
            userId: memberId,
          }),
      });
    } catch {
      // Durable settings remain authoritative. The next invocation re-reads
      // the selected route even when this best-effort wake is unavailable.
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
