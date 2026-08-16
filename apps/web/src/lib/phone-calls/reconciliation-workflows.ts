import { createHook, sleep } from "workflow";

import {
  reconcileHostedPhoneCallStep,
} from "./reconciliation-workflow-steps";
import type {
  HostedPhoneCallReconciliationHookPayload,
  HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_ACTIVATION_TIMEOUT,
} from "./reconciliation-workflow-types";

export async function hostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<void> {
  "use workflow";

  const hook = createHook<HostedPhoneCallReconciliationHookPayload>({
    token: buildHostedPhoneCallReconciliationHookToken(input.phoneCallId),
  });
  try {
    const activation = await Promise.race([
      hook.then(() => "activated" as const),
      sleep(HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_ACTIVATION_TIMEOUT)
        .then(() => "expired" as const),
    ]);
    if (activation === "expired") {
      return;
    }

    while (true) {
      try {
        await reconcileHostedPhoneCallStep(input);
        return;
      } catch {
        // The bounded step window exhausted. Keep this same per-call Workflow
        // dormant until an idempotent route or callback hint asks it to retry.
        await hook;
      }
    }
  } finally {
    hook.dispose();
  }
}
