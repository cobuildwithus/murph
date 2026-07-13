import { randomUUID } from "node:crypto";

import {
  Prisma,
  type HostedPhoneCall,
  type PrismaClient,
} from "@prisma/client";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallStartResponse,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS,
  hostedPhoneCallBriefSchema,
} from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  activeHostedMemberAccessWithParticipantsWhere,
  assertActiveHostedMemberAccessAllowed,
} from "../hosted-onboarding/member-access";
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
  $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
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
  options: { signal: AbortSignal },
) => Promise<unknown>;

interface HostedPhoneCallPreflightInput {
  memberId: string;
  prisma: Prisma.TransactionClient;
}

type HostedPhoneCallBeforeStart = (input: HostedPhoneCallPreflightInput & {
  phoneCallId: string;
}) => Promise<boolean>;

type HostedPhoneCallProviderStartGuard = (
  attemptedAt: Date,
) => Prisma.HostedPhoneCallWhereInput | null;

export async function createHostedPhoneCall(input: {
  beforeStart?: HostedPhoneCallBeforeStart;
  brief: HostedPhoneCallBrief;
  crypto?: HostedPhoneCallCrypto;
  memberId: string;
  prisma?: HostedPhoneCallStore | PrismaClient;
  reconciliationWorkflowStarter?: HostedPhoneCallReconciliationWorkflowStarter;
  requestKey: string;
  providerStartGuardWhere?: HostedPhoneCallProviderStartGuard;
  providerStartMemberIds?: readonly string[];
  resultNotificationRouteResolver?: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<void>;
  runtime?: PhoneCallRuntime;
  runtimeOptions?: {
    openingLine?: string | null;
    retellAgentId?: string | null;
    retellAgentVersion?: string | null;
  };
  signal?: AbortSignal;
  transferNumberResolver?: (
    resolverInput: HostedPhoneCallPreflightInput,
  ) => Promise<string | null>;
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
    ?? (async ({ memberId, prisma }) => {
      await requireHostedPhoneCallResultNotificationRoute({ memberId, prisma });
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

  let prepared: Awaited<ReturnType<typeof prepareHostedPhoneCallDispatch>>;
  try {
    await startReconciliationWorkflow(
      { phoneCallId: call.id },
      { signal: input.signal },
    );
    input.signal.throwIfAborted();
    prepared = await waitForAbortableOperation(input.signal, () =>
      prepareHostedPhoneCallDispatch({
        beforeStart: input.beforeStart,
        brief: input.brief,
        call,
        memberId: input.memberId,
        providerStartGuardWhere: input.providerStartGuardWhere,
        providerStartMemberIds: input.providerStartMemberIds,
        requireResultNotificationRoute,
        resolveTransferNumber,
        runtime,
        runtimeOptions: input.runtimeOptions,
        signal: input.signal,
        store,
      }));
  } catch (error) {
    const updated = await store.hostedPhoneCall.updateMany({
      data: { status: "failed" },
      where: hostedPhoneCallUnstartedAndUnattemptedWhere(call),
    });
    if (updated.count === 0) {
      const current = await store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: call.id },
      });
      if (
        current.providerStartAttemptedAt !== null
        || hasPhoneCallAdvancedBeyondStart(current)
      ) {
        return toHostedPhoneCallStartResponse(current);
      }
    }
    throw error;
  }
  if (!prepared.runtimeRecord) {
    return toHostedPhoneCallStartResponse(prepared.call);
  }

  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    try {
      input.signal.throwIfAborted();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }
    started = await runtime.start(prepared.runtimeRecord, {
      signal: input.signal,
    });
  } catch (error) {
    if (!hasPhoneCallRuntimeNoActiveEffect(error)) {
      try {
        const current = await waitForAbortableOperation(input.signal, () =>
          store.hostedPhoneCall.findUniqueOrThrow({
            where: { id: call.id },
          }));
        if (hasPhoneCallAdvancedBeyondStart(current)) {
          return toHostedPhoneCallStartResponse(current);
        }
      } catch {
        // The durable row stays pending while the pre-armed Workflow reconciles it.
      }
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
    let updated: { count: number };
    try {
      updated = await waitForAbortableOperation(input.signal, () =>
        store.hostedPhoneCall.updateMany({
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
        }));
    } catch {
      throw error;
    }

    if (updated.count === 0) {
      try {
        const current = await waitForAbortableOperation(input.signal, () =>
          store.hostedPhoneCall.findUniqueOrThrow({
            where: { id: call.id },
          }));
        if (hasPhoneCallAdvancedBeyondStart(current)) {
          return toHostedPhoneCallStartResponse(current);
        }
      } catch {
        throw error;
      }
    }

    throw error;
  }

  if (started.cleanupRequired === true) {
    let updated: { count: number };
    try {
      updated = await waitForAbortableOperation(input.signal, () =>
        store.hostedPhoneCall.updateMany({
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
        }));
    } catch {
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
    let cleanupAuthority: { id: string; providerCallId: string } | null = updated.count > 0
      ? {
          id: call.id,
          providerCallId: started.providerCallId,
        }
      : null;
    if (updated.count === 0) {
      let current: HostedPhoneCall;
      try {
        current = await waitForAbortableOperation(input.signal, () =>
          store.hostedPhoneCall.findUniqueOrThrow({
            where: { id: call.id },
          }));
      } catch {
        return {
          phoneCallId: call.id,
          status: "starting",
        };
      }
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
      } else {
        return {
          phoneCallId: call.id,
          status: "starting",
        };
      }
    }
    if (cleanupAuthority) {
      try {
        await stopHostedPhoneCallCleanupAuthority({
          call: cleanupAuthority,
          runtime,
          signal: input.signal,
          store,
        });
      } catch {
        // Failed cleanup stays durable for Workflow or replay recovery.
      }
    }
    return {
      phoneCallId: call.id,
      status: "failed",
    };
  }

  let updated: { count: number };
  try {
    updated = await waitForAbortableOperation(input.signal, () =>
      store.hostedPhoneCall.updateMany({
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
      }));
  } catch {
    return {
      phoneCallId: call.id,
      status: "starting",
    };
  }

  if (updated.count === 0) {
    try {
      const current = await waitForAbortableOperation(input.signal, () =>
        store.hostedPhoneCall.findUniqueOrThrow({
          where: { id: call.id },
        }));
      return toHostedPhoneCallStartResponse(current);
    } catch {
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
  }

  return {
    phoneCallId: call.id,
    status: "calling",
  };
}

async function prepareHostedPhoneCallDispatch(input: {
  beforeStart?: HostedPhoneCallBeforeStart;
  brief: HostedPhoneCallBrief;
  call: HostedPhoneCall;
  memberId: string;
  providerStartGuardWhere?: HostedPhoneCallProviderStartGuard;
  providerStartMemberIds?: readonly string[];
  requireResultNotificationRoute: (
    input: HostedPhoneCallPreflightInput,
  ) => Promise<void>;
  resolveTransferNumber: (
    input: HostedPhoneCallPreflightInput,
  ) => Promise<string | null>;
  runtime: PhoneCallRuntime;
  runtimeOptions?: {
    openingLine?: string | null;
    retellAgentId?: string | null;
    retellAgentVersion?: string | null;
  };
  signal: AbortSignal;
  store: HostedPhoneCallStore;
}): Promise<{
  call: HostedPhoneCall;
  runtimeRecord: Parameters<PhoneCallRuntime["start"]>[0] | null;
}> {
  return await input.store.$transaction(async (tx) => {
    const providerStartMemberIds = [...new Set([
      input.memberId,
      ...(input.providerStartMemberIds ?? []),
    ])].sort();
    for (const memberId of providerStartMemberIds) {
      input.signal.throwIfAborted();
      await lockHostedMemberRow(tx, memberId);
    }
    input.signal.throwIfAborted();
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: tx,
    });
    input.signal.throwIfAborted();
    await input.requireResultNotificationRoute({
      memberId: input.memberId,
      prisma: tx,
    });
    input.signal.throwIfAborted();
    if (input.beforeStart) {
      const shouldStart = await input.beforeStart({
        memberId: input.memberId,
        phoneCallId: input.call.id,
        prisma: tx,
      });
      input.signal.throwIfAborted();
      if (!shouldStart) {
        return {
          call: await failUnstartedHostedPhoneCallTx({
            call: input.call,
            tx,
          }),
          runtimeRecord: null,
        };
      }
    }

    const transferNumber = input.brief.allowTransferToUser
      ? await input.resolveTransferNumber({
          memberId: input.memberId,
          prisma: tx,
        })
      : null;
    input.signal.throwIfAborted();
    const runtimeRecord: Parameters<PhoneCallRuntime["start"]>[0] = {
      brief: input.brief,
      id: input.call.id,
      memberId: input.memberId,
      openingLine: input.runtimeOptions?.openingLine ?? null,
      retellAgentId: input.runtimeOptions?.retellAgentId ?? null,
      retellAgentVersion: input.runtimeOptions?.retellAgentVersion ?? null,
      transferNumber,
    };
    await input.runtime.validateStart?.(runtimeRecord);
    input.signal.throwIfAborted();

    const attemptedAt = new Date();
    const guardWhere = input.providerStartGuardWhere?.(attemptedAt);
    if (input.providerStartGuardWhere && !guardWhere) {
      return {
        call: await failUnstartedHostedPhoneCallTx({
          call: input.call,
          tx,
        }),
        runtimeRecord: null,
      };
    }
    const updatedAt = new Date(Math.max(
      attemptedAt.getTime(),
      input.call.updatedAt.getTime() + 1,
    ));
    const authorityWhere: Prisma.HostedPhoneCallWhereInput[] = [
      hostedPhoneCallUnstartedAndUnattemptedWhere(input.call),
      {
        member: {
          is: activeHostedMemberAccessWithParticipantsWhere(),
        },
      },
      ...(guardWhere ? [guardWhere] : []),
    ];
    const updated = await tx.hostedPhoneCall.updateMany({
      data: {
        providerStartAttemptedAt: attemptedAt,
        updatedAt,
      },
      where: { AND: authorityWhere },
    });
    if (updated.count === 0) {
      return {
        call: await failUnstartedHostedPhoneCallTx({
          call: input.call,
          tx,
        }),
        runtimeRecord: null,
      };
    }

    return {
      call: {
        ...input.call,
        providerStartAttemptedAt: attemptedAt,
        updatedAt,
      },
      runtimeRecord,
    };
  });
}

async function failUnstartedHostedPhoneCallTx(input: {
  call: HostedPhoneCall;
  tx: Prisma.TransactionClient;
}): Promise<HostedPhoneCall> {
  const failed = await input.tx.hostedPhoneCall.updateMany({
    data: { status: "failed" },
    where: hostedPhoneCallUnstartedAndUnattemptedWhere(input.call),
  });
  if (failed.count > 0) {
    return {
      ...input.call,
      status: "failed",
    };
  }
  return await input.tx.hostedPhoneCall.findUniqueOrThrow({
    where: { id: input.call.id },
  });
}

function hostedPhoneCallUnstartedAndUnattemptedWhere(
  call: Pick<HostedPhoneCall, "id" | "updatedAt">,
): Prisma.HostedPhoneCallWhereInput {
  return {
    analyzedAt: null,
    endedAt: null,
    id: call.id,
    provider: "retell",
    providerCallId: null,
    providerStartAttemptedAt: null,
    status: "starting",
    updatedAt: call.updatedAt,
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

  let current: HostedPhoneCall;
  try {
    current = await waitForAbortableOperation(input.signal, () =>
      input.store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: input.call.id },
      }));
  } catch {
    throwHostedPhoneCallStartPending();
  }
  if (!isHostedPhoneCallNewRequestBlocker(current)) {
    return;
  }
  if (!continuationArmed) {
    try {
      await input.startReconciliationWorkflow(
        { phoneCallId: current.id },
        { signal: input.signal },
      );
    } catch {
      // Keep the prior durable authority blocking this distinct request.
    }
  }
  throwHostedPhoneCallStartPending();
}

function throwHostedPhoneCallStartPending(): never {
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
  try {
    await input.startReconciliationWorkflow(
      { phoneCallId: input.call.id },
      { signal: input.signal },
    );
  } catch {
    // The durable row stays pending for Workflow or replay recovery.
  }
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
  let current: HostedPhoneCall;
  try {
    current = await waitForAbortableOperation(input.signal, () =>
      input.store.hostedPhoneCall.findUniqueOrThrow({
        where: { id: input.call.id },
      }));
  } catch {
    return result;
  }
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
  try {
    await input.startReconciliationWorkflow(
      { phoneCallId: input.call.id },
      { signal: input.signal },
    );
  } catch {
    // The durable cleanup row remains available to Workflow or replay recovery.
  }
  try {
    await stopHostedPhoneCallCleanupAuthority(input);
  } catch {
    // Exact replays keep returning the durable failed authority for later cleanup.
  }
}

export async function terminalizeUnstartedHostedPhoneCall(input: {
  phoneCallId: string;
  prisma?: Pick<Prisma.TransactionClient, "hostedPhoneCall">;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const updated = await prisma.hostedPhoneCall.updateMany({
    data: { status: "failed" },
    where: {
      analyzedAt: null,
      endedAt: null,
      id: input.phoneCallId,
      provider: "retell",
      providerCallId: null,
      providerStartAttemptedAt: null,
      status: "starting",
    },
  });
  return updated.count > 0;
}

function createHostedPhoneCallId(): string {
  return `hpc_${randomUUID().replaceAll("-", "")}`;
}

function resolveHostedPhoneCallStore(
  provided: HostedPhoneCallStore | PrismaClient | undefined,
): HostedPhoneCallStore {
  if (provided && isHostedPhoneCallStore(provided)) {
    return provided;
  }

  const prisma = provided ?? getPrisma();
  return {
    $transaction: async (callback) => prisma.$transaction(
      callback,
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    ),
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

function isHostedPhoneCallStore(
  value: HostedPhoneCallStore | PrismaClient,
): value is HostedPhoneCallStore {
  return "markCleanupEnded" in value && "reserve" in value;
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
