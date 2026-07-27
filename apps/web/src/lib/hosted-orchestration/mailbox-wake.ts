import { after } from "next/server";

import {
  startHostedDirectRuntimeWakeBestEffort,
  type HostedDirectRuntimeWakeSource,
} from "../hosted-execution/direct-runtime-wake";
import { signalHostedMailboxAppendRuntime } from "./signal-runtime";

export async function handoffHostedMailboxWake(input: {
  directWakeSource: HostedDirectRuntimeWakeSource;
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  await signalHostedMailboxAppendRuntime({
    expectedUserId: input.expectedUserId,
    mailboxItemId: input.mailboxItemId,
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
