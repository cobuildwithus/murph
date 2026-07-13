export const HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER = "30s";
export const HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES = 120;

export type HostedPhoneCallReconciliationWorkflowInput = {
  phoneCallId: string;
};

export type HostedPhoneCallReconciliationWorkflowStartResult = {
  runId: string;
};
