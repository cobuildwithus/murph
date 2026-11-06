import { after } from "next/server";

import {
  startHostedDirectRuntimeWakeBestEffort,
  type HostedDirectRuntimeWakeSource,
} from "../hosted-execution/direct-runtime-wake";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import {
  signalHostedMailboxAppendRuntime,
  type HostedRuntimeSignalResult,
  type SignalHostedMailboxAppendInput,
} from "./signal-runtime";

/** Temporal owns recovery; the payloadless direct hint only overlaps its ack. */
export async function handoffHostedMailboxWake(input: {
  directWakeSource: HostedDirectRuntimeWakeSource;
  expectedUserId: string;
  knownCheckpoint?: SignalHostedMailboxAppendInput["knownCheckpoint"];
  mailboxItemId: string;
  onDirectWakeTiming?: Parameters<
    typeof startHostedDirectRuntimeWakeBestEffort
  >[0]["onTiming"];
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HostedRuntimeSignalResult> {
  let directWake: Promise<void> | null = null;
  try {
    return await waitForHostedPostCommitOperation({
      deadlineMs: createHostedPostCommitDeadline(input.timeoutMs),
      operation: (abortSignal) => signalHostedMailboxAppendRuntime({
        abortSignal,
        expectedUserId: input.expectedUserId,
        ...(input.knownCheckpoint ? { knownCheckpoint: input.knownCheckpoint } : {}),
        mailboxItemId: input.mailboxItemId,
        // Called only after pointer/workspace admission and signal dispatch.
        onSignalStarted: () => {
          directWake = startHostedDirectRuntimeWakeBestEffort({
            onTiming: input.onDirectWakeTiming,
            source: input.directWakeSource,
            userId: input.expectedUserId,
          });
        },
      }),
      signal: input.signal,
    });
  } finally {
    // Keep an admitted hint alive even if the Temporal acknowledgement fails.
    // The failure still propagates; an ephemeral hint is never durable success.
    const wake = directWake;
    if (wake) {
      try {
        (input.scheduleAfterResponse ?? after)(() => wake);
      } catch {
        void wake;
      }
    }
  }
}
