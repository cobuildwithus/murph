import { after } from "next/server";

import {
  startHostedDirectRuntimeWakeBestEffort,
  type HostedDirectRuntimeWakeSource,
} from "../hosted-execution/direct-runtime-wake";
import { signalHostedMailboxAppendRuntime } from "./signal-runtime";

export function scheduleHostedMailboxWakeAfterResponse(input: {
  directWakeSource: HostedDirectRuntimeWakeSource;
  expectedUserId: string;
  mailboxItemId: string;
}): void {
  const task = async () => {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: input.expectedUserId,
        mailboxItemId: input.mailboxItemId,
      });
    } catch {
      // The durable mailbox item remains reconciliation truth when signaling
      // is unavailable. A direct wake must never bypass Temporal acceptance.
      return;
    }

    await startHostedDirectRuntimeWakeBestEffort({
      source: input.directWakeSource,
      userId: input.expectedUserId,
    });
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
