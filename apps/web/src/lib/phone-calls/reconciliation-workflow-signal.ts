import { HookNotFoundError } from "workflow/errors";

import { waitForAbortableSettlement } from "../hosted-onboarding/abortable-settlement";
import type {
  HostedPhoneCallReconciliationHookPayload,
} from "./reconciliation-workflow-types";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_HOOK_REGISTRATION_TIMEOUT_MS,
  HOSTED_PHONE_CALL_RECONCILIATION_HOOK_RETRY_MS,
} from "./reconciliation-workflow-types";

export type HostedPhoneCallReconciliationHookResumer = (
  token: string,
  payload: HostedPhoneCallReconciliationHookPayload,
) => Promise<unknown>;

export async function signalHostedPhoneCallReconciliation(input: {
  hookResumer?: HostedPhoneCallReconciliationHookResumer;
  phoneCallId: string;
  signal: AbortSignal;
  waitForRegistration?: boolean;
}): Promise<void> {
  // Load the large Workflow client SDK only when a hook is actually resumed.
  const hookResumer = input.hookResumer
    ?? (await import("workflow/api")).resumeHook<HostedPhoneCallReconciliationHookPayload>;
  const token = buildHostedPhoneCallReconciliationHookToken(input.phoneCallId);
  const registrationDeadline = Date.now()
    + HOSTED_PHONE_CALL_RECONCILIATION_HOOK_REGISTRATION_TIMEOUT_MS;

  while (true) {
    input.signal.throwIfAborted();
    try {
      await waitForAbortableSettlement(
        hookResumer(token, { reason: "reconcile" }),
        input.signal,
      );
      return;
    } catch (error) {
      if (
        !input.waitForRegistration
        || !HookNotFoundError.is(error)
        || Date.now() >= registrationDeadline
      ) {
        throw error;
      }
      await waitForAbortableSettlement(
        new Promise<void>((resolve) => {
          setTimeout(resolve, HOSTED_PHONE_CALL_RECONCILIATION_HOOK_RETRY_MS);
        }),
        input.signal,
      );
    }
  }
}
