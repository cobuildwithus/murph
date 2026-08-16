import type { PrismaClient } from "@prisma/client";
import { HookNotFoundError } from "workflow/errors";
import { resumeHook } from "workflow/api";

import { waitForAbortableSettlement } from "../hosted-onboarding/abortable-settlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { startHostedPointerWorkflow } from "../hosted-onboarding/workflow-start";
import { getPrisma } from "../prisma";
import type {
  HostedPhoneCallReconciliationHookPayload,
  HostedPhoneCallReconciliationWorkflowInput,
  HostedPhoneCallReconciliationWorkflowStartResult,
} from "./reconciliation-workflow-types";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_HOOK_REGISTRATION_TIMEOUT_MS,
  HOSTED_PHONE_CALL_RECONCILIATION_HOOK_RETRY_MS,
} from "./reconciliation-workflow-types";
import { hostedPhoneCallReconciliationWorkflow } from "./reconciliation-workflows";

type HostedPhoneCallReconciliationHookResumer = (
  token: string,
  payload: HostedPhoneCallReconciliationHookPayload,
) => Promise<unknown>;

export async function startHostedPhoneCallReconciliationWorkflow(
  input: HostedPhoneCallReconciliationWorkflowInput,
  options: { signal: AbortSignal },
): Promise<HostedPhoneCallReconciliationWorkflowStartResult> {
  const started = await startHostedPointerWorkflow({
    error: {
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      message: "Phone call start reconciliation is temporarily unavailable.",
    },
    payload: input,
    signal: options.signal,
    workflow: hostedPhoneCallReconciliationWorkflow,
  });
  try {
    await signalHostedPhoneCallReconciliation({
      phoneCallId: input.phoneCallId,
      signal: options.signal,
      waitForRegistration: true,
    });
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Phone call start reconciliation is temporarily unavailable.",
      retryable: true,
    });
  }
  return started;
}

export async function signalHostedPhoneCallResultNotificationRecovery(input: {
  hookResumer?: HostedPhoneCallReconciliationHookResumer;
  memberId: string;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  // Signal one existing per-call Workflow. A terminal outcome callback signals
  // the next member-local obligation, so restoration never fans out work or
  // treats transport-retention artifacts as delivery truth.
  const call = await prisma.hostedPhoneCall.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      resultDeliveryStatus: true,
    },
    where: {
      analyzedAt: { not: null },
      memberId: input.memberId,
      resultDeliveryStatus: {
        in: ["pending", "queued", "sending"],
      },
      resultNotificationChannel: "telegram",
    },
  });
  if (!call) {
    return false;
  }
  if (call.resultDeliveryStatus !== "pending") {
    return false;
  }

  await signalHostedPhoneCallReconciliation({
    ...(input.hookResumer ? { hookResumer: input.hookResumer } : {}),
    phoneCallId: call.id,
    signal: input.signal ?? new AbortController().signal,
  });
  return true;
}

async function signalHostedPhoneCallReconciliation(input: {
  hookResumer?: HostedPhoneCallReconciliationHookResumer;
  phoneCallId: string;
  signal: AbortSignal;
  waitForRegistration?: boolean;
}): Promise<void> {
  const hookResumer = input.hookResumer ?? resumeHook<
    HostedPhoneCallReconciliationHookPayload
  >;
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
