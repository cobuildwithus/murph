import { randomUUID } from "node:crypto";

import {
  type HostedPhoneCall,
} from "@prisma/client";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallStartResponse,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS,
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  hostedPhoneCallCrypto,
  readHostedPhoneCallBrief,
  type HostedPhoneCallCrypto,
} from "./crypto";
import {
  hostedPhoneCallNewRequestBlockerWhere,
  isHostedPhoneCallNewRequestBlocker,
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";
import {
  requireHostedPhoneCallResultNotificationRoute,
} from "./notification-route";
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import {
  hasPhoneCallAdvancedBeyondStart,
  reconcileHostedPhoneCallProviderAuthority,
  stopHostedPhoneCallCleanupAuthority,
  toHostedPhoneCallStartResponse,
  type HostedPhoneCallReconciliationStore,
} from "./reconciliation";
import {
  startHostedPhoneCallReconciliationWorkflow,
} from "./reconciliation-workflow-start";
import { resolveVerifiedMemberTransferNumber } from "./transfer";
import {
  hasPhoneCallRuntimeNoActiveEffect,
  markPhoneCallRuntimeNoActiveEffect,
  type PhoneCallRuntime,
} from "./types";

interface HostedPhoneCallReservationData {
  briefEncrypted: string;
  id: string;
  memberId: string;
  provider: "retell";
  requestKey: string;
  status: "starting";
}

interface HostedPhoneCallStore extends HostedPhoneCallReconciliationStore {
  reserve(input: {
    data: HostedPhoneCallReservationData;
  }): Promise<{
    call: HostedPhoneCall;
    created: boolean;
  }>;
  hostedPhoneCall: HostedPhoneCallReconciliationStore["hostedPhoneCall"] & {
    findFirst(input: {
      where: ReturnType<typeof hostedPhoneCallNewRequestBlockerWhere>;
    }): Promise<HostedPhoneCall | null>;
    findUnique(input: {
      where:
        | { id: string }
        | {
            memberId_requestKey: {
              memberId: string;
              requestKey: string;
            };
          };
    }): Promise<HostedPhoneCall | null>;
  };
}

type HostedPhoneCallReconciliationWorkflowStarter = (
  input: { phoneCallId: string },
) => Promise<unknown>;

export async function createHostedPhoneCall(input: {
  brief: HostedPhoneCallBrief;
  crypto?: HostedPhoneCallCrypto;
  memberId: string;
  prisma?: HostedPhoneCallStore;
  reconciliationWorkflowStarter?: HostedPhoneCallReconciliationWorkflowStarter;
  requestKey: string;
  resultNotificationRouteResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<void>;
  runtime?: PhoneCallRuntime;
  signal?: AbortSignal;
  transferNumberResolver?: (resolverInput: {
    memberId: string;
  }) => Promise<string | null>;
}): Promise<HostedPhoneCallStartResponse> {
  const serviceSignal = input.signal
    ? AbortSignal.any([
        input.signal,
        AbortSignal.timeout(HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS);
  return runWithHostedDomainRootUnwrapCache(() => createHostedPhoneCallWithinDeadline({
    ...input,
    signal: serviceSignal,
  }));
}

async function createHostedPhoneCallWithinDeadline(input: Parameters<
  typeof createHostedPhoneCall
>[0] & { signal: AbortSignal }): Promise<HostedPhoneCallStartResponse> {
  const store = resolveHostedPhoneCallStore(input.prisma);
  const crypto = input.crypto ?? hostedPhoneCallCrypto;
  const runtime = input.runtime ?? createRetellPhoneCallRuntime();
  const startReconciliationWorkflow = input.reconciliationWorkflowStarter
    ?? startHostedPhoneCallReconciliationWorkflow;
  const resolveTransferNumber =
    input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber;
  const requireResultNotificationRoute: NonNullable<
    typeof input.resultNotificationRouteResolver
  > =
    input.resultNotificationRouteResolver
    ?? (async ({ memberId }) => {
      await requireHostedPhoneCallResultNotificationRoute({ memberId });
    });

  const existing = await store.hostedPhoneCall.findUnique({
    where: {
      memberId_requestKey: {
        memberId: input.memberId,
        requestKey: input.requestKey,
      },
    },
  });
  if (existing) {
    return await resolveExistingHostedPhoneCall({
      brief: input.brief,
      call: existing,
      crypto,
      memberId: input.memberId,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  }

  const blockingCall = await store.hostedPhoneCall.findFirst({
    where: hostedPhoneCallNewRequestBlockerWhere(input.memberId),
  });
  if (blockingCall) {
    await resolveHostedPhoneCallBlockerForNewRequest({
      call: blockingCall,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  }

  input.signal.throwIfAborted();
  await requireResultNotificationRoute({
    memberId: input.memberId,
  });
  input.signal.throwIfAborted();
  const transferNumber = input.brief.allowTransferToUser
    ? await resolveTransferNumber({
        memberId: input.memberId,
      })
    : null;
  input.signal.throwIfAborted();

  const callId = createHostedPhoneCallId();
  const briefEncrypted = await crypto.encryptBrief({
    callId,
    memberId: input.memberId,
    signal: input.signal,
    value: input.brief,
  });
  input.signal.throwIfAborted();
  const reservation = await store.reserve({
    data: {
      briefEncrypted,
      id: callId,
      memberId: input.memberId,
      provider: "retell",
      requestKey: input.requestKey,
      status: "starting",
    },
  });
  const call = reservation.call;
  if (!reservation.created) {
    return await resolveExistingHostedPhoneCall({
      brief: input.brief,
      call,
      crypto,
      memberId: input.memberId,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  }

  try {
    await startReconciliationWorkflow({ phoneCallId: call.id });
  } catch (error) {
    await store.hostedPhoneCall.updateMany({
      data: { status: "failed" },
      where: {
        analyzedAt: null,
        id: call.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });
    throw error;
  }

  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    try {
      input.signal.throwIfAborted();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }
    started = await runtime.start({
      brief: input.brief,
      id: call.id,
      memberId: input.memberId,
      transferNumber,
    }, {
      signal: input.signal,
    });
  } catch (error) {
    if (!hasPhoneCallRuntimeNoActiveEffect(error)) {
      const current = await store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
      if (hasPhoneCallAdvancedBeyondStart(current)) {
        return toHostedPhoneCallStartResponse(current);
      }
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
    const updated = await store.hostedPhoneCall.updateMany({
      data: {
        status: "failed",
      },
      where: {
        analyzedAt: null,
        id: call.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });

    if (updated.count === 0) {
      const current = await store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
      if (hasPhoneCallAdvancedBeyondStart(current)) {
        return toHostedPhoneCallStartResponse(current);
      }
    }

    throw error;
  }

  if (started.cleanupRequired === true) {
    const updated = await store.hostedPhoneCall.updateMany({
      data: {
        providerCallId: started.providerCallId,
        status: "failed",
      },
      where: {
        analyzedAt: null,
        id: call.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
      },
    });
    let cleanupAuthority: { id: string; providerCallId: string } | null = updated.count > 0
      ? {
          id: call.id,
          providerCallId: started.providerCallId,
        }
      : null;
    if (updated.count === 0) {
      const current = await store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
      if (
        isHostedPhoneCallProviderCleanupPending(current)
        && current.providerCallId
      ) {
        cleanupAuthority = {
          id: current.id,
          providerCallId: current.providerCallId,
        };
      } else if (hasPhoneCallAdvancedBeyondStart(current)) {
        return toHostedPhoneCallStartResponse(current);
      }
    }
    if (cleanupAuthority) {
      await stopHostedPhoneCallCleanupAuthority({
        call: cleanupAuthority,
        runtime,
        signal: input.signal,
        store,
      });
    }
    throw started.error;
  }

  const updated = await store.hostedPhoneCall.updateMany({
    data: {
      providerCallId: started.providerCallId,
      status: "calling",
    },
    where: {
      analyzedAt: null,
      id: call.id,
      provider: "retell",
      providerCallId: null,
      status: "starting",
    },
  });

  if (updated.count === 0) {
    const current = await store.hostedPhoneCall.findUniqueOrThrow({
      where: { id: call.id },
    });
    return toHostedPhoneCallStartResponse(current);
  }

  return {
    phoneCallId: call.id,
    status: "calling",
  };
}

async function resolveHostedPhoneCallBlockerForNewRequest(input: {
  call: HostedPhoneCall;
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
  store: HostedPhoneCallStore;
}): Promise<void> {
  let continuationArmed = false;
  if (
    isHostedPhoneCallProviderCleanupPending(input.call)
    && input.call.providerCallId
  ) {
    await ensureHostedPhoneCallCleanup({
      call: {
        id: input.call.id,
        providerCallId: input.call.providerCallId,
      },
      runtime: input.runtime,
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
      store: input.store,
    });
    continuationArmed = true;
  } else if (isHostedPhoneCallReadyForProviderReconciliation(input.call)) {
    const reconciled = await reconcileHostedPhoneCallForService({
      call: input.call,
      runtime: input.runtime,
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
      store: input.store,
    });
    continuationArmed = reconciled.status === "failed";
  }

  const current = await input.store.hostedPhoneCall.findUniqueOrThrow({
    where: { id: input.call.id },
  });
  if (!isHostedPhoneCallNewRequestBlocker(current)) {
    return;
  }
  if (!continuationArmed) {
    await input.startReconciliationWorkflow({ phoneCallId: current.id });
  }
  throw hostedOnboardingError({
    code: "HOSTED_PHONE_CALL_START_PENDING",
    httpStatus: 409,
    message: "A prior phone call is still being reconciled or cleaned up.",
    retryable: true,
  });
}

async function resolveExistingHostedPhoneCall(input: {
  brief: HostedPhoneCallBrief;
  call: HostedPhoneCall;
  crypto: HostedPhoneCallCrypto;
  memberId: string;
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
  store: HostedPhoneCallStore;
}): Promise<HostedPhoneCallStartResponse> {
  if (input.call.memberId !== input.memberId) {
    throw new Error("Hosted phone call request key collision.");
  }
  assertHostedPhoneCallBriefMatches({
    actual: await readHostedPhoneCallBrief({
      call: input.call,
      crypto: input.crypto,
      signal: input.signal,
    }),
    expected: input.brief,
  });
  if (
    isHostedPhoneCallProviderCleanupPending(input.call)
    && input.call.providerCallId
  ) {
    await ensureHostedPhoneCallCleanup({
      call: {
        id: input.call.id,
        providerCallId: input.call.providerCallId,
      },
      runtime: input.runtime,
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
      store: input.store,
    });
    return toHostedPhoneCallStartResponse(input.call);
  }
  if (hasPhoneCallAdvancedBeyondStart(input.call)) {
    return toHostedPhoneCallStartResponse(input.call);
  }
  if (isHostedPhoneCallReadyForProviderReconciliation(input.call)) {
    const reconciled = await reconcileHostedPhoneCallForService({
      call: input.call,
      runtime: input.runtime,
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
      store: input.store,
    });
    if (reconciled.status !== "starting") {
      return reconciled;
    }
  }
  await input.startReconciliationWorkflow({ phoneCallId: input.call.id });
  return {
    phoneCallId: input.call.id,
    status: "starting",
  };
}

async function reconcileHostedPhoneCallForService(input: {
  call: HostedPhoneCall;
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
  store: HostedPhoneCallStore;
}): Promise<HostedPhoneCallStartResponse> {
  const result = await reconcileHostedPhoneCallProviderAuthority(input);
  if (result.status !== "failed") {
    return result;
  }
  const current = await input.store.hostedPhoneCall.findUniqueOrThrow({
    where: { id: input.call.id },
  });
  if (
    isHostedPhoneCallProviderCleanupPending(current)
    && current.providerCallId
  ) {
    await ensureHostedPhoneCallCleanup({
      call: {
        id: current.id,
        providerCallId: current.providerCallId,
      },
      runtime: input.runtime,
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
      store: input.store,
    });
  }
  return result;
}

async function ensureHostedPhoneCallCleanup(input: {
  call: {
    id: string;
    providerCallId: string;
  };
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
  store: HostedPhoneCallStore;
}): Promise<void> {
  let workflowStartFailure: unknown;
  try {
    await input.startReconciliationWorkflow({ phoneCallId: input.call.id });
  } catch (error) {
    workflowStartFailure = error;
  }
  const stopped = await stopHostedPhoneCallCleanupAuthority(input);
  if (!stopped && workflowStartFailure !== undefined) {
    throw workflowStartFailure;
  }
}

function createHostedPhoneCallId(): string {
  return `hpc_${randomUUID().replaceAll("-", "")}`;
}

function resolveHostedPhoneCallStore(
  provided: HostedPhoneCallStore | undefined,
): HostedPhoneCallStore {
  if (provided) {
    return provided;
  }

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
    reserve: async (input) => prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.data.memberId);
      await assertActiveHostedMemberAccessAllowed({
        memberId: input.data.memberId,
        prisma: tx,
      });
      const existing = await tx.hostedPhoneCall.findUnique({
        where: {
          memberId_requestKey: {
            memberId: input.data.memberId,
            requestKey: input.data.requestKey,
          },
        },
      });
      if (existing) {
        return {
          call: existing,
          created: false,
        };
      }

      const pendingCall = await tx.hostedPhoneCall.findFirst({
        where: hostedPhoneCallNewRequestBlockerWhere(input.data.memberId),
      });
      if (pendingCall) {
        throw hostedOnboardingError({
          code: "HOSTED_PHONE_CALL_START_PENDING",
          httpStatus: 409,
          message: "A phone call start is still being reconciled.",
          retryable: true,
        });
      }

      return {
        call: await tx.hostedPhoneCall.create({ data: input.data }),
        created: true,
      };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS),
    hostedPhoneCall: {
      findFirst: async (input) => prisma.hostedPhoneCall.findFirst(input),
      findUnique: async (input) => prisma.hostedPhoneCall.findUnique(input),
      findUniqueOrThrow: async (input) => prisma.hostedPhoneCall.findUniqueOrThrow(input),
      updateMany: async (input) => prisma.hostedPhoneCall.updateMany(input),
    },
  };
}

function assertHostedPhoneCallBriefMatches(input: {
  actual: unknown;
  expected: HostedPhoneCallBrief;
}): void {
  const actual = hostedPhoneCallBriefSchema.safeParse(input.actual);
  if (!actual.success || stableJson(actual.data) !== stableJson(input.expected)) {
    throw new Error("Hosted phone call request key collision.");
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(stabilizeJsonValue(value));
}

function stabilizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilizeJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stabilizeJsonValue(entryValue)]),
  );
}
