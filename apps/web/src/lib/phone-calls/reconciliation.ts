import type { HostedPhoneCall } from "@prisma/client";
import type { HostedPhoneCallStartResponse } from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import {
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import type { PhoneCallRuntime } from "./types";

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
      };
    }): Promise<{ count: number }>;
  };
}

export async function processHostedPhoneCallRecoveryById(input: {
  phoneCallId: string;
  prisma?: HostedPhoneCallReconciliationStore;
  runtime?: PhoneCallRuntime;
  signal: AbortSignal;
}): Promise<"complete" | "missing" | "pending"> {
  const store = input.prisma ?? resolveHostedPhoneCallReconciliationStore();
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const call = await store.hostedPhoneCall.findUnique({
    where: { id: input.phoneCallId },
  });
  if (!call) {
    return "missing";
  }
  if (isHostedPhoneCallProviderCleanupPending(call) && call.providerCallId) {
    return await stopHostedPhoneCallCleanupAuthority({
      call: {
        id: call.id,
        providerCallId: call.providerCallId,
      },
      runtime,
      signal: input.signal,
      store,
    }) ? "complete" : "pending";
  }
  if (hasPhoneCallAdvancedBeyondStart(call)) {
    return "complete";
  }
  if (!isHostedPhoneCallReadyForProviderReconciliation(call)) {
    return "pending";
  }
  const result = await reconcileHostedPhoneCallProviderAuthority({
    call,
    runtime,
    signal: input.signal,
    store,
  });
  if (result.status === "starting") {
    return "pending";
  }
  if (result.status === "failed") {
    const current = await store.hostedPhoneCall.findUnique({
      where: { id: input.phoneCallId },
    });
    if (
      current
      && isHostedPhoneCallProviderCleanupPending(current)
      && current.providerCallId
    ) {
      return await stopHostedPhoneCallCleanupAuthority({
        call: {
          id: current.id,
          providerCallId: current.providerCallId,
        },
        runtime,
        signal: input.signal,
        store,
      }) ? "complete" : "pending";
    }
  }
  return "complete";
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
    input.signal.throwIfAborted();
    await input.runtime.stopIfActive(input.call.providerCallId, {
      signal: input.signal,
    });
  } catch {
    input.signal.throwIfAborted();
    return false;
  }
  await input.store.markCleanupEnded(input.call);
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
    resolution = await input.runtime.resolveProviderCall(input.call.id, {
      signal: input.signal,
    });
  } catch {
    input.signal.throwIfAborted();
    return {
      phoneCallId: input.call.id,
      status: "starting",
    };
  }

  const updated = await input.store.hostedPhoneCall.updateMany({
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
    },
  });
  if (updated.count > 0) {
    return {
      phoneCallId: input.call.id,
      status: resolution.state === "found" ? "calling" : "failed",
    };
  }

  const current = await input.store.hostedPhoneCall.findUniqueOrThrow({
    where: { id: input.call.id },
  });
  return toHostedPhoneCallStartResponse(current);
}

export function toHostedPhoneCallStartResponse(
  call: HostedPhoneCall,
): HostedPhoneCallStartResponse {
  return {
    phoneCallId: call.id,
    status: toHostedPhoneCallStartResponseStatus(call.status),
  };
}

export function hasPhoneCallAdvancedBeyondStart(call: HostedPhoneCall): boolean {
  return call.status !== "starting"
    || call.providerCallId !== null
    || call.endedAt !== null
    || call.analyzedAt !== null;
}

function toHostedPhoneCallStartResponseStatus(
  status: HostedPhoneCall["status"],
): HostedPhoneCallStartResponse["status"] {
  switch (status) {
    case "calling":
      return "calling";
    case "failed":
      return "failed";
    default:
      return "starting";
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
  };
}
