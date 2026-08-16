import type { PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { startHostedPointerWorkflow } from "../hosted-onboarding/workflow-start";
import { getPrisma } from "../prisma";
import {
  HOSTED_PHONE_CALL_RECONCILIATION_SIGNAL_TIMEOUT_MS,
  type HostedPhoneCallReconciliationWorkflowInput,
  type HostedPhoneCallReconciliationWorkflowStartResult,
} from "./reconciliation-workflow-types";
import type {
  HostedPhoneCallReconciliationHookResumer,
} from "./reconciliation-workflow-signal";
import { signalHostedPhoneCallReconciliation } from "./reconciliation-workflow-signal";
import { hostedPhoneCallReconciliationWorkflow } from "./reconciliation-workflows";

export async function startHostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
  options: { signal: AbortSignal },
): Promise<HostedPhoneCallReconciliationWorkflowStartResult> {
  const started = await startHostedPointerWorkflow({
    error: {
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      message: "Phone call start reconciliation is temporarily unavailable.",
    },
    payload: input,
    signal: options.signal,
    workflow: hostedPhoneCallReconciliationWorkflow,
  });
  try {
    await signalHostedPhoneCallReconciliation({
      phoneCallId: input.phoneCallId,
      signal: options.signal,
      waitForRegistration: true,
    });
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Phone call start reconciliation is temporarily unavailable.",
      retryable: true,
    });
  }
  return started;
}

export async function signalHostedPhoneCallResultNotificationRecovery(input: {
  hookResumer?: HostedPhoneCallReconciliationHookResumer;
  memberId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const timeoutSignal = AbortSignal.timeout(
    HOSTED_PHONE_CALL_RECONCILIATION_SIGNAL_TIMEOUT_MS,
  );
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;
  signal.throwIfAborted();
  // Signal one existing per-call Workflow. A terminal outcome callback signals
  // the next member-local obligation, so restoration never fans out work or
  // treats transport-retention artifacts as delivery truth.
  const call = await prisma.hostedPhoneCall.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      resultDeliveryStatus: true,
    },
    where: {
      analyzedAt: { not: null },
      memberId: input.memberId,
      resultDeliveryStatus: {
        in: ["pending", "queued", "sending"],
      },
      resultNotificationChannel: "telegram",
    },
  });
  signal.throwIfAborted();
  if (!call) {
    return false;
  }
  if (call.resultDeliveryStatus !== "pending") {
    return false;
  }

  await signalHostedPhoneCallReconciliation({
    ...(input.hookResumer ? { hookResumer: input.hookResumer } : {}),
    phoneCallId: call.id,
    signal,
  });
  return true;
}
