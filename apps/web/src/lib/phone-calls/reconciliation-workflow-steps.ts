import { RetryableError } from "workflow";

import { withHostedWorkflowStepMaxRetries } from "../hosted-onboarding/workflow-step-options";
import { processHostedPhoneCallRecoveryById } from "./reconciliation";
import {
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";

// stopIfActive may perform two serial Retell requests at 15 seconds each, and
// terminal usage can require one final 15-second retrieve. Leave 30 seconds for
// bounded database work, notification routing/encryption, and response
// settlement owned by this same workflow.
export const HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS = 75_000;

export async function reconcileHostedPhoneCallStep(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<void> {
  "use step";

  const result = await processHostedPhoneCallRecoveryById({
    phoneCallId: input.phoneCallId,
    signal: AbortSignal.timeout(HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS),
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
