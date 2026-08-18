import { RetryableError } from "workflow";

import { withHostedWorkflowStepMaxRetries } from "../hosted-onboarding/workflow-step-options";
import { processHostedPhoneCallRecoveryById } from "./reconciliation";
import {
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";

const HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS = 25_000;

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

export async function reconcileHostedPhoneCallDurableStep(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<"complete" | "missing" | "pending"> {
  "use step";

  const signal = AbortSignal.timeout(
    HOSTED_PHONE_CALL_RECONCILIATION_STEP_TIMEOUT_MS,
  );
  return processHostedPhoneCallRecoveryById({
    phoneCallId: input.phoneCallId,
    signal,
  });
}

withHostedWorkflowStepMaxRetries(reconcileHostedPhoneCallDurableStep, 0);
