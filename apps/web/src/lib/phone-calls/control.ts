import type {
  HostedPhoneCall,
  HostedPhoneCallStatus,
} from "@prisma/client";
import type {
  HostedPhoneCallStopResponse,
} from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import type { PhoneCallRuntime } from "./types";

type HostedPhoneCallControlRecord = Pick<
  HostedPhoneCall,
  | "analyzedAt"
  | "endedAt"
  | "id"
  | "memberId"
  | "providerCallId"
  | "status"
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
        endedAt: Date;
        status: HostedPhoneCallStatus;
      };
      where: {
        analyzedAt: null;
        endedAt: null;
        id: string;
        memberId: string;
        provider: "retell";
        providerCallId: string;
        status: { in: HostedPhoneCallStatus[] };
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
} as const;

export async function stopHostedPhoneCall(input: {
  memberId: string;
  phoneCallId: string;
  prisma?: HostedPhoneCallControlStore;
  runtime?: Pick<PhoneCallRuntime, "stopIfActive">;
  signal: AbortSignal;
}): Promise<HostedPhoneCallStopResponse> {
  const store = input.prisma ?? resolveHostedPhoneCallControlStore();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
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
  if (!call.providerCallId) {
    return {
      phoneCallId: call.id,
      state: "start_pending",
      status: call.status,
    };
  }

  try {
    await waitForAbortableOperation(input.signal, () =>
      runtime.stopIfActive(call.providerCallId!, {
        signal: input.signal,
      })
    );
  } catch {
    input.signal.throwIfAborted();
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_STOP_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Phone-call termination could not be confirmed.",
      retryable: true,
    });
  }

  const stoppedStatus = call.status === "failed" ? "failed" : "ended";
  const updated = await waitForAbortableOperation(input.signal, () =>
    store.hostedPhoneCall.updateMany({
      data: {
        endedAt: new Date(),
        status: stoppedStatus,
      },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: call.id,
        memberId: input.memberId,
        provider: "retell",
        providerCallId: call.providerCallId!,
        status: {
          in: ["starting", "calling", "ended", "failed"],
        },
      },
    })
  );
  if (updated.count > 0) {
    return {
      phoneCallId: call.id,
      state: "stopped",
      status: stoppedStatus,
    };
  }

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
  return isHostedPhoneCallTerminalForStop(current)
    ? toAlreadyTerminalResponse(current)
    : {
        phoneCallId: current.id,
        state: "start_pending",
        status: current.status,
      };
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

function resolveHostedPhoneCallControlStore(): HostedPhoneCallControlStore {
  const prisma = getPrisma();
  return {
    hostedPhoneCall: {
      findFirst: (input) => prisma.hostedPhoneCall.findFirst(input),
      updateMany: (input) => prisma.hostedPhoneCall.updateMany(input),
    },
  };
}
