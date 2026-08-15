import type { HostedPhoneCall } from "@prisma/client";
import type { HostedPhoneCallStartResponse } from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import {
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";
import {
  finalizePreparedRetellCallResult,
} from "./result";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import {
  prepareRetellCallResult,
} from "./retell-result-lifecycle";
import type {
  HostedPhoneCallProviderUsage,
  PhoneCallRuntime,
  PhoneCallRuntimeStopDisposition,
} from "./types";
import { recordRetellPhoneCallProviderUsage } from "./usage";

export interface HostedPhoneCallReconciliationStore {
  markCleanupEnded(input: {
    id: string;
    providerCallId: string;
  }): Promise<{ count: number }>;
  markRequestedStopEnded(input: {
    id: string;
    providerCallId: string;
    status: HostedPhoneCall["status"];
  }): Promise<{ count: number }>;
  hostedPhoneCall: {
    findUnique(input: {
      where: { id: string };
    }): Promise<HostedPhoneCall | null>;
    findUniqueOrThrow(input: {
      where: { id: string };
    }): Promise<HostedPhoneCall>;
    updateMany(input: {
      data: {
        providerCallId?: string;
        status: HostedPhoneCall["status"];
      };
      where: {
        analyzedAt?: null;
        id: string;
        provider: "retell";
        providerCallId: null;
        status: "starting";
        updatedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
  recordTerminalUsage?(input: {
    call: HostedPhoneCall;
    usage: HostedPhoneCallProviderUsage;
  }): Promise<void>;
}

export async function processHostedPhoneCallRecoveryById(input: {
  finalizeResult?: typeof finalizePreparedRetellCallResult;
  phoneCallId: string;
  prisma?: HostedPhoneCallReconciliationStore;
  runtime?: PhoneCallRuntime;
  signal: AbortSignal;
}): Promise<"complete" | "missing" | "pending"> {
  const store = input.prisma ?? resolveHostedPhoneCallReconciliationStore();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const finalizeResult = input.finalizeResult ?? finalizePreparedRetellCallResult;
  let call = await waitForAbortableOperation(input.signal, () =>
    store.hostedPhoneCall.findUnique({
      where: { id: input.phoneCallId },
    }));
  if (!call) {
    return "missing";
  }
  if (call.stopRequestedAt && call.providerCallId && !call.endedAt) {
    const disposition = await stopHostedPhoneCallRequestedAuthority({
      call,
      runtime,
      signal: input.signal,
      store,
    });
    if (!disposition) {
      return "pending";
    }
    const current = await waitForAbortableOperation(input.signal, () =>
      store.hostedPhoneCall.findUnique({
        where: { id: input.phoneCallId },
      }));
    if (!current) {
      return "missing";
    }
    call = current;
  }
  if (isHostedPhoneCallProviderCleanupPending(call) && call.providerCallId) {
    const stopped = await stopHostedPhoneCallCleanupAuthority({
      call: {
        id: call.id,
        providerCallId: call.providerCallId,
      },
      runtime,
      signal: input.signal,
      store,
    });
    if (!stopped) {
      return "pending";
    }
  }

  if (isHostedPhoneCallReadyForProviderReconciliation(call)) {
    const result = await reconcileHostedPhoneCallProviderAuthority({
      call,
      runtime,
      signal: input.signal,
      store,
    });
    if (result.status === "starting") {
      return "pending";
    }

    const current = await waitForAbortableOperation(input.signal, () =>
      store.hostedPhoneCall.findUnique({
        where: { id: input.phoneCallId },
      }));
    if (!current) {
      return "missing";
    }
    call = current;
    if (call.stopRequestedAt && call.providerCallId && !call.endedAt) {
      const disposition = await stopHostedPhoneCallRequestedAuthority({
        call,
        runtime,
        signal: input.signal,
        store,
      });
      if (!disposition) {
        return "pending";
      }
      const stopped = await waitForAbortableOperation(input.signal, () =>
        store.hostedPhoneCall.findUnique({
          where: { id: input.phoneCallId },
        }));
      if (!stopped) {
        return "missing";
      }
      call = stopped;
    }
    if (
      result.status === "failed"
      && isHostedPhoneCallProviderCleanupPending(call)
      && call.providerCallId
    ) {
      const stopped = await stopHostedPhoneCallCleanupAuthority({
        call: {
          id: call.id,
          providerCallId: call.providerCallId,
        },
        runtime,
        signal: input.signal,
        store,
      });
      if (!stopped) {
        return "pending";
      }
    }
  }

  const providerCallId = call.providerCallId;
  const resolveTerminalUsage = runtime.resolveTerminalUsage;
  const recordTerminalUsage = store.recordTerminalUsage;
  if (providerCallId && resolveTerminalUsage && recordTerminalUsage) {
    let resolution;
    try {
      resolution = await waitForAbortableOperation(input.signal, () =>
        resolveTerminalUsage.call(runtime, providerCallId, {
          signal: input.signal,
        }));
    } catch {
      input.signal.throwIfAborted();
      return "pending";
    }
    if (resolution.state === "pending") {
      return "pending";
    }
    try {
      await waitForAbortableOperation(input.signal, () =>
        recordTerminalUsage({
          call,
          usage: resolution.usage,
        }));
    } catch {
      input.signal.throwIfAborted();
      return "pending";
    }
    if (resolution.terminalTransfer) {
      const prepared = prepareRetellCallResult({
        call: {
          call_id: resolution.terminalTransfer.providerCallId,
          data_storage_setting: "basic_attributes_only",
          disconnection_reason: "call_transfer",
          end_timestamp: resolution.terminalTransfer.endedAt.toISOString(),
          transfer_end_timestamp: resolution.terminalTransfer.endedAt.toISOString(),
        },
        event: "transfer_ended",
      });
      try {
        await waitForAbortableOperation(input.signal, () =>
          finalizeResult(prepared, {
            abortSignal: input.signal,
          }));
      } catch {
        input.signal.throwIfAborted();
        return "pending";
      }
    }
    return "complete";
  }

  return hasPhoneCallAdvancedBeyondStart(call) ? "complete" : "pending";
}

export async function stopHostedPhoneCallRequestedAuthority(input: {
  call: Pick<
    HostedPhoneCall,
    "endedAt" | "id" | "providerCallId" | "status" | "stopRequestedAt"
  >;
  runtime: Pick<PhoneCallRuntime, "stopIfActive">;
  signal: AbortSignal;
  store: Pick<HostedPhoneCallReconciliationStore, "markRequestedStopEnded">;
}): Promise<PhoneCallRuntimeStopDisposition | null> {
  if (
    !input.call.stopRequestedAt
    || !input.call.providerCallId
    || input.call.endedAt
  ) {
    return null;
  }
  let disposition: PhoneCallRuntimeStopDisposition;
  try {
    disposition = await waitForAbortableOperation(input.signal, () =>
      input.runtime.stopIfActive(input.call.providerCallId!, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return null;
  }
  await waitForAbortableOperation(input.signal, () =>
    input.store.markRequestedStopEnded({
      id: input.call.id,
      providerCallId: input.call.providerCallId!,
      status: input.call.status === "failed" ? "failed" : "ended",
    }));
  return disposition;
}

export async function stopHostedPhoneCallCleanupAuthority(input: {
  call: {
    id: string;
    providerCallId: string;
  };
  runtime: Pick<PhoneCallRuntime, "stopIfActive">;
  signal: AbortSignal;
  store: Pick<HostedPhoneCallReconciliationStore, "markCleanupEnded">;
}): Promise<boolean> {
  try {
    await waitForAbortableOperation(input.signal, () =>
      input.runtime.stopIfActive(input.call.providerCallId, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return false;
  }
  await waitForAbortableOperation(input.signal, () =>
    input.store.markCleanupEnded(input.call));
  return true;
}

export async function reconcileHostedPhoneCallProviderAuthority(input: {
  call: HostedPhoneCall;
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  store: HostedPhoneCallReconciliationStore;
}): Promise<HostedPhoneCallStartResponse> {
  let resolution: Awaited<ReturnType<PhoneCallRuntime["resolveProviderCall"]>>;
  try {
    resolution = await waitForAbortableOperation(input.signal, () =>
      input.runtime.resolveProviderCall(input.call.id, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return {
      phoneCallId: input.call.id,
      status: "starting",
    };
  }

  let updated: { count: number };
  try {
    updated = await waitForAbortableOperation(input.signal, () =>
      input.store.hostedPhoneCall.updateMany({
        data: resolution.state === "not_found"
          ? { status: "failed" }
          : {
              providerCallId: resolution.providerCallId,
              status: resolution.state === "found" ? "calling" : "failed",
            },
        where: {
          analyzedAt: null,
          id: input.call.id,
          provider: "retell",
          providerCallId: null,
          status: "starting",
          updatedAt: input.call.updatedAt,
        },
      }));
  } catch {
    return {
      phoneCallId: input.call.id,
      status: "starting",
    };
  }
  if (updated.count > 0) {
    return {
      phoneCallId: input.call.id,
      status: resolution.state === "found" ? "calling" : "failed",
    };
  }

  try {
    const current = await waitForAbortableOperation(input.signal, () =>
      input.store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: input.call.id },
      }));
    return toHostedPhoneCallStartResponse(current);
  } catch {
    return {
      phoneCallId: input.call.id,
      status: "starting",
    };
  }
}

export function toHostedPhoneCallStartResponse(
  call: HostedPhoneCall,
): HostedPhoneCallStartResponse {
  return {
    phoneCallId: call.id,
    status: toHostedPhoneCallStartResponseStatus(call),
  };
}

export function hasPhoneCallAdvancedBeyondStart(call: HostedPhoneCall): boolean {
  return call.status !== "starting"
    || call.providerCallId !== null
    || call.endedAt !== null
    || call.analyzedAt !== null;
}

function toHostedPhoneCallStartResponseStatus(
  call: HostedPhoneCall,
): HostedPhoneCallStartResponse["status"] {
  switch (call.status) {
    case "calling":
    case "ended":
    case "completed":
    case "needs_user":
      return "calling";
    case "failed":
      return "failed";
    case "starting":
      return call.providerCallId !== null
        || call.endedAt !== null
        || call.analyzedAt !== null
        ? "calling"
        : "starting";
  }
}

function resolveHostedPhoneCallReconciliationStore(): HostedPhoneCallReconciliationStore {
  const prisma = getPrisma();
  return {
    markCleanupEnded: async (input) => prisma.hostedPhoneCall.updateMany({
      data: {
        endedAt: new Date(),
        status: "failed",
      },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: input.id,
        provider: "retell",
        providerCallId: input.providerCallId,
        status: "failed",
      },
    }),
    markRequestedStopEnded: async (input) => prisma.hostedPhoneCall.updateMany({
      data: {
        endedAt: new Date(),
        status: input.status,
      },
      where: {
        analyzedAt: null,
        endedAt: null,
        id: input.id,
        provider: "retell",
        providerCallId: input.providerCallId,
        stopRequestedAt: { not: null },
      },
    }),
    hostedPhoneCall: {
      findUnique: async (input) => prisma.hostedPhoneCall.findUnique(input),
      findUniqueOrThrow: async (input) => prisma.hostedPhoneCall.findUniqueOrThrow(input),
      updateMany: async (input) => prisma.hostedPhoneCall.updateMany(input),
    },
    recordTerminalUsage: async ({ call, usage }) =>
      recordRetellPhoneCallProviderUsage({
        call,
        prisma,
        usage,
      }),
  };
}
