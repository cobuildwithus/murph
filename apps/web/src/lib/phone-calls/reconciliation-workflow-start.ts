import { startHostedPointerWorkflow } from "../hosted-onboarding/workflow-start";
import type {
  HostedPhoneCallReconciliationWorkflowInput,
  HostedPhoneCallReconciliationWorkflowStartResult,
} from "./reconciliation-workflow-types";
import { hostedPhoneCallReconciliationWorkflow } from "./reconciliation-workflows";

export async function startHostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<HostedPhoneCallReconciliationWorkflowStartResult> {
  return startHostedPointerWorkflow({
    error: {
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      message: "Phone call start reconciliation is temporarily unavailable.",
    },
    payload: input,
    workflow: hostedPhoneCallReconciliationWorkflow,
  });
}
