import type { HostedPhoneCall } from "@prisma/client";
import type { HostedPhoneCallStartResponse } from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperationAndDrain } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import {
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";
import {
  finalizePreparedRetellCallResult,
  finalizeStoredHostedPhoneCallResult,
} from "./result";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import {
  prepareRetellCallResult,
} from "./retell-result-lifecycle";
import type {
  HostedPhoneCallProviderUsage,
  PhoneCallRuntime,
} from "./types";
import { recordRetellPhoneCallProviderUsage } from "./usage";

export interface HostedPhoneCallReconciliationStore {
  markCleanupEnded(input: {
    id: string;
    providerCallId: string;
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
  finalizeStoredResult?: typeof finalizeStoredHostedPhoneCallResult;
  phoneCallId: string;
  prisma?: HostedPhoneCallReconciliationStore;
  runtime?: PhoneCallRuntime;
  signal: AbortSignal;
}): Promise<"complete" | "missing" | "pending"> {
  const store = input.prisma ?? resolveHostedPhoneCallReconciliationStore();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const finalizeResult = input.finalizeResult ?? finalizePreparedRetellCallResult;
  const finalizeStoredResult = input.finalizeStoredResult
    ?? finalizeStoredHostedPhoneCallResult;
  let call = await waitForAbortableOperationAndDrain(input.signal, () =>
    store.hostedPhoneCall.findUnique({
      where: { id: input.phoneCallId },
    }));
  if (!call) {
    return "missing";
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

    const current = await waitForAbortableOperationAndDrain(input.signal, () =>
      store.hostedPhoneCall.findUnique({
        where: { id: input.phoneCallId },
      }));
    if (!current) {
      return "missing";
    }
    call = current;
    if (
      result.status === "failed"
      && isHostedPhoneCallProviderCleanupPending(current)
      && current.providerCallId
    ) {
      const stopped = await stopHostedPhoneCallCleanupAuthority({
        call: {
          id: current.id,
          providerCallId: current.providerCallId,
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
  const hasStoredResult = hasStoredHostedPhoneCallResult(call);
  const [usageSettlement, resultSettlement] = await Promise.allSettled([
    settleHostedPhoneCallTerminalUsage({
      call,
      finalizeResult,
      providerCallId,
      recordTerminalUsage,
      resolveTerminalUsage,
      runtime,
      signal: input.signal,
      synthesizeTerminalTransfer: !hasStoredResult,
    }),
    hasStoredResult
      ? finalizeStoredResult(call, { abortSignal: input.signal })
      : Promise.resolve("complete" as const),
  ]);
  // Both siblings have settled or drained their own bounded work before an
  // outer abort escapes the Workflow step.
  input.signal.throwIfAborted();
  if (
    isHostedPhoneCallRecoverySettlementPending(usageSettlement)
    || isHostedPhoneCallRecoverySettlementPending(resultSettlement)
  ) {
    return "pending";
  }
  if (isHostedPhoneCallTrackedResultOutstanding(call)) {
    return "pending";
  }
  if (providerCallId && resolveTerminalUsage && recordTerminalUsage) {
    return "complete";
  }
  return hasPhoneCallAdvancedBeyondStart(call)
    ? "complete"
    : "pending";
}

type HostedPhoneCallRecoverySettlement = "complete" | "pending";

function isHostedPhoneCallRecoverySettlementPending(
  settlement: PromiseSettledResult<HostedPhoneCallRecoverySettlement>,
): boolean {
  return settlement.status === "rejected" || settlement.value === "pending";
}

async function settleHostedPhoneCallTerminalUsage(input: {
  call: HostedPhoneCall;
  finalizeResult: typeof finalizePreparedRetellCallResult;
  providerCallId: string | null;
  recordTerminalUsage: HostedPhoneCallReconciliationStore["recordTerminalUsage"];
  resolveTerminalUsage: PhoneCallRuntime["resolveTerminalUsage"];
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  synthesizeTerminalTransfer: boolean;
}): Promise<HostedPhoneCallRecoverySettlement> {
  const providerCallId = input.providerCallId;
  const recordTerminalUsage = input.recordTerminalUsage;
  const resolveTerminalUsage = input.resolveTerminalUsage;
  if (
    !providerCallId
    || !resolveTerminalUsage
    || !recordTerminalUsage
  ) {
    return "complete";
  }

  let resolution: Awaited<ReturnType<NonNullable<
    PhoneCallRuntime["resolveTerminalUsage"]
  >>>;
  try {
    resolution = await waitForAbortableOperationAndDrain(input.signal, () =>
      resolveTerminalUsage.call(input.runtime, providerCallId, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return "pending";
  }
  if (resolution.state === "pending") {
    return "pending";
  }

  const usageWrite = async () => {
    await waitForAbortableOperationAndDrain(input.signal, () =>
      recordTerminalUsage({
        call: input.call,
        usage: resolution.usage,
      }));
  };
  const terminalTransfer = async () => {
    if (!input.synthesizeTerminalTransfer || !resolution.terminalTransfer) {
      return;
    }
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
    await input.finalizeResult(prepared, { abortSignal: input.signal });
  };
  const settlements = await Promise.allSettled([
    usageWrite(),
    terminalTransfer(),
  ]);
  input.signal.throwIfAborted();
  return settlements.some((settlement) => settlement.status === "rejected")
    ? "pending"
    : "complete";
}

function isHostedPhoneCallTrackedResultOutstanding(
  call: HostedPhoneCall,
): boolean {
  if (call.resultNotificationChannel !== "telegram") {
    return false;
  }
  if (call.resultDeliveryStatus !== null) {
    return ![
      "ambiguous",
      "delivered",
    ].includes(call.resultDeliveryStatus);
  }
  return call.status === "calling"
    || call.status === "ended"
    || (
      call.status === "failed"
      && call.endedAt !== null
      && call.providerCallId !== null
    );
}

function hasStoredHostedPhoneCallResult(call: HostedPhoneCall): boolean {
  return call.analyzedAt !== null
    && (call.resultEncrypted !== null || call.resultJson !== null);
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
    await waitForAbortableOperationAndDrain(input.signal, () =>
      input.runtime.stopIfActive(input.call.providerCallId, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return false;
  }
  await waitForAbortableOperationAndDrain(input.signal, () =>
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
    resolution = await waitForAbortableOperationAndDrain(input.signal, () =>
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
    updated = await waitForAbortableOperationAndDrain(input.signal, () =>
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
    const current = await waitForAbortableOperationAndDrain(input.signal, () =>
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
