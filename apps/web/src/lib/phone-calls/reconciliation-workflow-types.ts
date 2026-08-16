export const HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_RETRY_AFTER = "30s";
export const HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES = 120;
export const HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_ACTIVATION_TIMEOUT = "30s";
export const HOSTED_PHONE_CALL_RECONCILIATION_HOOK_REGISTRATION_TIMEOUT_MS = 5_000;
export const HOSTED_PHONE_CALL_RECONCILIATION_HOOK_RETRY_MS = 50;

export type HostedPhoneCallReconciliationWorkflowInput = {
  phoneCallId: string;
};

export type HostedPhoneCallReconciliationWorkflowStartResult = {
  runId: string;
};

export type HostedPhoneCallReconciliationHookPayload = {
  reason: "reconcile";
};

export function buildHostedPhoneCallReconciliationHookToken(
  phoneCallId: string,
): string {
  return `hosted-phone-call-reconciliation:${phoneCallId}`;
}
