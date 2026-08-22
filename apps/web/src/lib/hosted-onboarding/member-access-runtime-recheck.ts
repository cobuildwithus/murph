import type { PrismaClient } from "@prisma/client";

import {
  describeHostedExecutionSafeLogErrorCode,
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  signalHostedRuntimeRecheckRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "./bounded-post-commit";

export async function signalHostedAccessGrantRuntimeRecheckBestEffort(input: {
  memberId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: createHostedPostCommitDeadline(input.timeoutMs),
      operation: (abortSignal) => signalHostedRuntimeRecheckRuntime({
        abortSignal,
        prisma,
        userId: input.memberId,
      }),
      signal: input.signal,
    });
  } catch (error) {
    const errorCode = describeHostedExecutionSafeLogErrorCode(error);
    console.error("Hosted access-grant runtime recheck failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code: errorCode }),
    });
  }
}
