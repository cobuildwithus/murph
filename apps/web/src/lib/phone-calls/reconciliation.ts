import type { HostedPhoneCall } from "@prisma/client";
import type { HostedPhoneCallStartResponse } from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperationAndDrain } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import {
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";
import {
  finalizeHostedPhoneCallStartFailure,
  finalizeHostedPhoneCallStopSettlement,
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
  finalizeStartFailure?: typeof finalizeHostedPhoneCallStartFailure;
  finalizeStopSettlement?: typeof finalizeHostedPhoneCallStopSettlement;
  finalizeStoredResult?: typeof finalizeStoredHostedPhoneCallResult;
  phoneCallId: string;
  prisma?: HostedPhoneCallReconciliationStore;
  runtime?: PhoneCallRuntime;
  signal: AbortSignal;
}): Promise<"complete" | "missing" | "pending"> {
  const store = input.prisma ?? resolveHostedPhoneCallReconciliationStore();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const finalizeResult = input.finalizeResult ?? finalizePreparedRetellCallResult;
  const finalizeStartFailure = input.finalizeStartFailure
    ?? finalizeHostedPhoneCallStartFailure;
  const finalizeStopSettlement = input.finalizeStopSettlement
    ?? finalizeHostedPhoneCallStopSettlement;
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
    const cleanupCall = call;
    const providerCallId = call.providerCallId;
    const stopped = await stopHostedPhoneCallCleanupAuthority({
      call: {
        id: cleanupCall.id,
        providerCallId,
      },
      finalizeBeforeEnd: () => finalizeStartFailure(cleanupCall, {
        abortSignal: input.signal,
      }),
      runtime,
      signal: input.signal,
      store,
    });
    if (!stopped) {
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
  } else if (call.stopRequestedAt && call.providerCallId && !call.endedAt) {
    const disposition = await stopHostedPhoneCallRequestedAuthority({
      call,
      runtime,
      signal: input.signal,
      store,
    });
    if (!disposition) {
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
      && isHostedPhoneCallProviderCleanupPending(call)
      && call.providerCallId
    ) {
      const cleanupCall = call;
      const providerCallId = call.providerCallId;
      const stopped = await stopHostedPhoneCallCleanupAuthority({
        call: {
          id: cleanupCall.id,
          providerCallId,
        },
        finalizeBeforeEnd: () => finalizeStartFailure(cleanupCall, {
          abortSignal: input.signal,
        }),
        runtime,
        signal: input.signal,
        store,
      });
      if (!stopped) {
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
    } else if (call.stopRequestedAt && call.providerCallId && !call.endedAt) {
      const disposition = await stopHostedPhoneCallRequestedAuthority({
        call,
        runtime,
        signal: input.signal,
        store,
      });
      if (!disposition) {
        return "pending";
      }
      const stopped = await waitForAbortableOperationAndDrain(input.signal, () =>
        store.hostedPhoneCall.findUnique({
          where: { id: input.phoneCallId },
        }));
      if (!stopped) {
        return "missing";
      }
      call = stopped;
    }
  }

  if (
    call.status === "failed"
    && call.providerCallId === null
    && call.analyzedAt === null
  ) {
    const failedCall = call;
    try {
      await waitForAbortableOperationAndDrain(input.signal, () =>
        finalizeStartFailure(failedCall, {
          abortSignal: input.signal,
          notifyResult: failedCall.stopRequestedAt === null,
        }));
    } catch {
      input.signal.throwIfAborted();
      const current = await waitForAbortableOperationAndDrain(input.signal, () =>
        store.hostedPhoneCall.findUnique({
          where: { id: input.phoneCallId },
        }));
      return current ? "pending" : "missing";
    }
    const current = await waitForAbortableOperationAndDrain(input.signal, () =>
      store.hostedPhoneCall.findUnique({
        where: { id: input.phoneCallId },
      }));
    if (!current) {
      return "missing";
    }
    call = current;
  }

  if (isHostedPhoneCallStopSettled(call)) {
    try {
      await waitForAbortableOperationAndDrain(input.signal, () =>
        finalizeStopSettlement(call, {
          abortSignal: input.signal,
        }));
    } catch {
      input.signal.throwIfAborted();
      const current = await waitForAbortableOperationAndDrain(input.signal, () =>
        store.hostedPhoneCall.findUnique({
          where: { id: input.phoneCallId },
        }));
      return current ? "pending" : "missing";
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
    disposition = await waitForAbortableOperationAndDrain(input.signal, () =>
      input.runtime.stopIfActive(input.call.providerCallId!, {
        signal: input.signal,
      }));
  } catch {
    input.signal.throwIfAborted();
    return null;
  }
  const updated = await waitForAbortableOperationAndDrain(input.signal, () =>
    input.store.markRequestedStopEnded({
      id: input.call.id,
      providerCallId: input.call.providerCallId!,
      status: input.call.status === "failed" ? "failed" : "ended",
    }));
  return updated.count > 0 ? disposition : null;
}

export async function stopHostedPhoneCallCleanupAuthority(input: {
  call: {
    id: string;
    providerCallId: string;
  };
  finalizeBeforeEnd?: () => Promise<void>;
  runtime: Pick<PhoneCallRuntime, "stopIfActive">;
  signal: AbortSignal;
  store: Pick<HostedPhoneCallReconciliationStore, "markCleanupEnded">;
}): Promise<boolean> {
  try {
    await waitForAbortableOperationAndDrain(input.signal, () =>
      input.runtime.stopIfActive(input.call.providerCallId, {
        signal: input.signal,
      }));
    if (input.finalizeBeforeEnd) {
      await waitForAbortableOperationAndDrain(
        input.signal,
        input.finalizeBeforeEnd,
      );
    }
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

export function isHostedPhoneCallStopSettled(call: HostedPhoneCall): boolean {
  return call.stopRequestedAt !== null
    && (
      call.endedAt !== null
      || (call.status === "failed" && call.providerCallId === null)
    );
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
