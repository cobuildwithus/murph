import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  HostedPhoneCallResultNotificationChannel,
} from "@murphai/hosted-execution/phone-calls";

import { readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { startHostedPointerWorkflow } from "../hosted-onboarding/workflow-start";
import { getPrisma } from "../prisma";
import { buildPhoneCallResultNotificationEventId } from "./result";
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
  readMailboxItem?: typeof readHostedMailboxItemByDedupeKey;
  resultNotificationChannel: HostedPhoneCallResultNotificationChannel;
  signal?: AbortSignal;
  workflowStarter?: typeof startHostedPhoneCallReconciliationWorkflow;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  // A new direct call requires this live route, and one member may have only
  // one provider start in flight. Route loss can therefore strand only the
  // newest analyzed call on that channel; keep restoration work to one indexed
  // member-local candidate plus one mailbox dedupe read.
  const call = await prisma.hostedPhoneCall.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
    where: {
      OR: [
        { resultEncrypted: { not: null } },
        { resultJson: { not: Prisma.AnyNull } },
      ],
      analyzedAt: { not: null },
      memberId: input.memberId,
      resultNotificationChannel: input.resultNotificationChannel,
    },
  });
  if (!call) {
    return false;
  }

  const readMailboxItem = input.readMailboxItem
    ?? readHostedMailboxItemByDedupeKey;
  const existing = await readMailboxItem({
    dedupeKey: buildPhoneCallResultNotificationEventId(call.id),
    prisma,
    userId: input.memberId,
  });
  if (existing) {
    return false;
  }

  await (input.workflowStarter ?? startHostedPhoneCallReconciliationWorkflow)(
    { phoneCallId: call.id },
    { signal: input.signal ?? new AbortController().signal },
  );
  return true;
}
