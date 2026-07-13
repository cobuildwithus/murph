import {
  reconcileHostedPhoneCallStep,
} from "./reconciliation-workflow-steps";
import type {
  HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";

export async function hostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<void> {
  "use workflow";

  await reconcileHostedPhoneCallStep(input);
}
