import { createHook, sleep } from "workflow";

import {
  reconcileHostedPhoneCallDurableStep,
  reconcileHostedPhoneCallStep,
} from "./reconciliation-workflow-steps";
import type {
  HostedPhoneCallReconciliationHookPayload,
  HostedPhoneCallReconciliationWorkflowInput,
} from "./reconciliation-workflow-types";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_ACTIVATION_TIMEOUT,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK,
} from "./reconciliation-workflow-types";

export async function hostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
): Promise<void> {
  "use workflow";

  const hook = createHook<HostedPhoneCallReconciliationHookPayload>({
    token: buildHostedPhoneCallReconciliationHookToken(input.phoneCallId),
  });
  try {
    let nextHookSignal = hook.then(() => "activated" as const);
    const activation = await Promise.race([
      nextHookSignal,
      sleep(HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_ACTIVATION_TIMEOUT)
        .then(() => "expired" as const),
    ]);
    if (activation === "expired") {
      return;
    }
    nextHookSignal = hook.then(() => "activated" as const);
    let durableRecheckAfter:
      | typeof HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK
      | typeof HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK =
      HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK;

    while (true) {
      try {
        await reconcileHostedPhoneCallStep(input);
        return;
      } catch {
        // The bounded active window exhausted. A hook remains the fast path,
        // while a durable timer makes the HostedPhoneCall row independently
        // discoverable if that operational hint is dropped.
        while (true) {
          const wake = await Promise.race([
            nextHookSignal,
            sleep(durableRecheckAfter).then(() => "recheck" as const),
          ]);
          if (wake === "activated") {
            nextHookSignal = hook.then(() => "activated" as const);
            break;
          }

          let result: Awaited<
            ReturnType<typeof reconcileHostedPhoneCallDurableStep>
          >;
          try {
            result = await reconcileHostedPhoneCallDurableStep(input);
          } catch {
            // The row remains the durable owner. A durable-pass outage cannot
            // end its sole Workflow, manufacture another recovery owner, or
            // advance the first successful classification to the daily cadence.
            continue;
          }
          if (result !== "pending") {
            return;
          }
          durableRecheckAfter =
            HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK;
        }
      }
    }
  } finally {
    hook.dispose();
  }
}
