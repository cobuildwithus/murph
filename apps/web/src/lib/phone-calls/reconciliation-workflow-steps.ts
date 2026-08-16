import { RetryableError } from "workflow";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { withHostedWorkflowStepMaxRetries } from "../hosted-onboarding/workflow-step-options";
import { getPrisma } from "../prisma";
import { processHostedPhoneCallRecoveryById } from "./reconciliation";
import {
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";

const HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS = 25_000;

export type HostedPhoneCallReconciliationProbeResult =
  | { status: "missing" }
  | { status: "pending" }
  | { analyzedAt: string; status: "stored-result" };

export async function reconcileHostedPhoneCallStep(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<void> {
  "use step";

  const signal = AbortSignal.timeout(
    HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS,
  );
  const result = await processHostedPhoneCallRecoveryById({
    phoneCallId: input.phoneCallId,
    signal,
  });
  if (result === "pending") {
    throw new RetryableError(
      "Phone call provider authority is still pending.",
      {
        retryAfter: HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

withHostedWorkflowStepMaxRetries(
  reconcileHostedPhoneCallStep,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
);

export async function probeHostedPhoneCallReconciliationStep(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<HostedPhoneCallReconciliationProbeResult> {
  "use step";

  const signal = AbortSignal.timeout(
    HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS,
  );
  const call = await waitForAbortableOperation(signal, () =>
    getPrisma().hostedPhoneCall.findUnique({
      select: {
        analyzedAt: true,
        resultEncrypted: true,
        resultJson: true,
      },
      where: { id: input.phoneCallId },
    }));
  if (!call) {
    return { status: "missing" };
  }
  return call.analyzedAt
      && (call.resultEncrypted !== null || call.resultJson !== null)
    ? { analyzedAt: call.analyzedAt.toISOString(), status: "stored-result" }
    : { status: "pending" };
}
