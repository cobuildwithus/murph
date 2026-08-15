import type { PrismaClient } from "@prisma/client";

import { startHostedPointerWorkflow } from "../hosted-onboarding/workflow-start";
import { getPrisma } from "../prisma";
import type {
  HostedPhoneCallReconciliationWorkflowInput,
  HostedPhoneCallReconciliationWorkflowStartResult,
} from "./reconciliation-workflow-types";
import { hostedPhoneCallReconciliationWorkflow } from "./reconciliation-workflows";

export async function startHostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
  options: { signal: AbortSignal },
): Promise<HostedPhoneCallReconciliationWorkflowStartResult> {
  return startHostedPointerWorkflow({
    error: {
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      message: "Phone call start reconciliation is temporarily unavailable.",
    },
    payload: input,
    signal: options.signal,
    workflow: hostedPhoneCallReconciliationWorkflow,
  });
}

export async function rearmHostedPhoneCallResultNotificationRecovery(input: {
  memberId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
  workflowStarter?: typeof startHostedPhoneCallReconciliationWorkflow;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  // Start one existing pointer workflow. A terminal outcome callback re-arms
  // the next member-local obligation, so restoration never fans out work or
  // treats transport-retention artifacts as delivery truth.
  const call = await prisma.hostedPhoneCall.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
    where: {
      analyzedAt: { not: null },
      memberId: input.memberId,
      resultDeliveryStatus: {
        in: ["pending", "queued", "sending"],
      },
      resultNotificationChannel: "telegram",
    },
  });
  if (!call) {
    return false;
  }

  await (input.workflowStarter ?? startHostedPhoneCallReconciliationWorkflow)(
    { phoneCallId: call.id },
    { signal: input.signal ?? new AbortController().signal },
  );
  return true;
}

export async function rearmHostedPhoneCallResultNotificationRecoveryBestEffort(
  input: Parameters<typeof rearmHostedPhoneCallResultNotificationRecovery>[0],
): Promise<void> {
  try {
    await rearmHostedPhoneCallResultNotificationRecovery(input);
  } catch {
    // A Telegram route bind remains valid even when Workflow is temporarily
    // unavailable. The next bind, inbound, or delivery callback retries rearm.
    console.warn("Hosted phone-call result recovery rearm failed.");
  }
}
