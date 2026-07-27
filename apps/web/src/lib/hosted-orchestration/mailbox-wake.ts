import { after } from "next/server";

import {
  startHostedDirectRuntimeWakeBestEffort,
  type HostedDirectRuntimeWakeSource,
} from "../hosted-execution/direct-runtime-wake";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import { signalHostedMailboxAppendRuntime } from "./signal-runtime";

export async function handoffHostedMailboxWake(input: {
  directWakeSource: HostedDirectRuntimeWakeSource;
  expectedUserId: string;
  mailboxItemId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  const deadlineMs = createHostedPostCommitDeadline(input.timeoutMs);
  await waitForHostedPostCommitOperation({
    deadlineMs,
    operation: (abortSignal) => signalHostedMailboxAppendRuntime({
      abortSignal,
      expectedUserId: input.expectedUserId,
      mailboxItemId: input.mailboxItemId,
    }),
    signal: input.signal,
  });

  const directWake = startHostedDirectRuntimeWakeBestEffort({
    source: input.directWakeSource,
    userId: input.expectedUserId,
  });
  try {
    after(() => directWake);
  } catch {
    void directWake;
  }
}
