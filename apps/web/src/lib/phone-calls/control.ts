import type {
  HostedPhoneCall,
  HostedPhoneCallStatus,
} from "@prisma/client";
import type {
  HostedPhoneCallStopResponse,
} from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import { startHostedPhoneCallReconciliationWorkflow } from "./reconciliation-workflow-start";

type HostedPhoneCallControlRecord = Pick<
  HostedPhoneCall,
  | "analyzedAt"
  | "endedAt"
  | "id"
  | "memberId"
  | "providerCallId"
  | "status"
  | "stopRequestedAt"
>;

interface HostedPhoneCallControlStore {
  hostedPhoneCall: {
    findFirst(input: {
      select: typeof HOSTED_PHONE_CALL_CONTROL_SELECT;
      where: {
        id: string;
        memberId: string;
      };
    }): Promise<HostedPhoneCallControlRecord | null>;
    updateMany(input: {
      data: {
        stopRequestedAt?: Date;
      };
      where: {
        analyzedAt?: null;
        endedAt?: null;
        id: string;
        memberId: string;
        status?: { in: HostedPhoneCallStatus[] };
        stopRequestedAt?: null;
      };
    }): Promise<{ count: number }>;
  };
}

const HOSTED_PHONE_CALL_CONTROL_SELECT = {
  analyzedAt: true,
  endedAt: true,
  id: true,
  memberId: true,
  providerCallId: true,
  status: true,
  stopRequestedAt: true,
} as const;

type HostedPhoneCallReconciliationWorkflowStarter = (
  input: { phoneCallId: string },
  options: { signal: AbortSignal },
) => Promise<unknown>;

export async function stopHostedPhoneCall(input: {
  memberId: string;
  phoneCallId: string;
  prisma?: HostedPhoneCallControlStore;
  reconciliationWorkflowStarter?: HostedPhoneCallReconciliationWorkflowStarter;
  signal: AbortSignal;
}): Promise<HostedPhoneCallStopResponse> {
  const store = input.prisma ?? resolveHostedPhoneCallControlStore();
  const call = await readOwnedPhoneCall({
    memberId: input.memberId,
    phoneCallId: input.phoneCallId,
    signal: input.signal,
    store,
  });
  if (!call) {
    return {
      phoneCallId: input.phoneCallId,
      state: "not_found",
      status: null,
    };
  }
  if (isHostedPhoneCallTerminalForStop(call)) {
    return toAlreadyTerminalResponse(call);
  }
  let pendingCall = call;
  if (!call.stopRequestedAt) {
    const fenced = await waitForAbortableOperation(input.signal, () =>
      store.hostedPhoneCall.updateMany({
        data: {
          stopRequestedAt: new Date(),
        },
        where: {
          analyzedAt: null,
          endedAt: null,
          id: call.id,
          memberId: input.memberId,
          status: {
            in: ["starting", "calling", "ended", "failed"],
          },
          stopRequestedAt: null,
        },
      })
    );
    if (fenced.count === 0) {
      const current = await readOwnedPhoneCall({
        memberId: input.memberId,
        phoneCallId: input.phoneCallId,
        signal: input.signal,
        store,
      });
      if (!current) {
        return {
          phoneCallId: input.phoneCallId,
          state: "not_found",
          status: null,
        };
      }
      if (isHostedPhoneCallTerminalForStop(current)) {
        return toAlreadyTerminalResponse(current);
      }
      pendingCall = current;
    }
  }
  await wakeHostedPhoneCallStopReconciliation({
    phoneCallId: pendingCall.id,
    reconciliationWorkflowStarter: input.reconciliationWorkflowStarter,
    signal: input.signal,
  });
  // The existing durable reconciliation workflow is the sole provider-stop
  // owner. Foreground control records the member's intent and returns without
  // spending a second, competing Retell deadline.
  return toStopPendingResponse(pendingCall);
}

async function wakeHostedPhoneCallStopReconciliation(input: {
  phoneCallId: string;
  reconciliationWorkflowStarter?: HostedPhoneCallReconciliationWorkflowStarter;
  signal: AbortSignal;
}): Promise<void> {
  await (input.reconciliationWorkflowStarter
    ?? startHostedPhoneCallReconciliationWorkflow)(
      { phoneCallId: input.phoneCallId },
      { signal: input.signal },
    );
}

async function readOwnedPhoneCall(input: {
  memberId: string;
  phoneCallId: string;
  signal: AbortSignal;
  store: HostedPhoneCallControlStore;
}): Promise<HostedPhoneCallControlRecord | null> {
  return waitForAbortableOperation(input.signal, () =>
    input.store.hostedPhoneCall.findFirst({
      select: HOSTED_PHONE_CALL_CONTROL_SELECT,
      where: {
        id: input.phoneCallId,
        memberId: input.memberId,
      },
    })
  );
}

function isHostedPhoneCallTerminalForStop(
  call: HostedPhoneCallControlRecord,
): boolean {
  return call.analyzedAt !== null
    || call.endedAt !== null
    || call.status === "completed"
    || call.status === "needs_user"
    || (call.status === "failed" && call.providerCallId === null);
}

function toAlreadyTerminalResponse(
  call: HostedPhoneCallControlRecord,
): HostedPhoneCallStopResponse {
  return {
    phoneCallId: call.id,
    state: "already_terminal",
    status: call.status,
  };
}

function toStopPendingResponse(
  call: HostedPhoneCallControlRecord,
): HostedPhoneCallStopResponse {
  return {
    phoneCallId: call.id,
    state: "start_pending",
    status: call.status,
  };
}

function resolveHostedPhoneCallControlStore(): HostedPhoneCallControlStore {
  const prisma = getPrisma();
  return {
    hostedPhoneCall: {
      findFirst: (input) => prisma.hostedPhoneCall.findFirst(input),
      updateMany: (input) => prisma.hostedPhoneCall.updateMany(input),
    },
  };
}
