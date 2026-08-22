import { randomUUID } from "node:crypto";

import {
  type HostedPhoneCall,
} from "@prisma/client";
import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallGroupRequester,
  HostedPhoneCallResultNotificationChannel,
  HostedPhoneCallStartResponse,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_PHONE_CALL_START_SERVICE_TIMEOUT_MS,
  hostedPhoneCallBriefSchema,
  isHostedScheduledPhoneCallRequestKey,
} from "@murphai/hosted-execution/phone-calls";

import { waitForAbortableOperation } from "../hosted-onboarding/abortable-settlement";
import { getPrisma } from "../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import {
  isHostedThreadContainerNotificationDestination,
  requireHostedAssistantNotificationDestination,
  type HostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
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
import { createRetellPhoneCallRuntime } from "./retell-runtime";
import {
  hasPhoneCallAdvancedBeyondStart,
  reconcileHostedPhoneCallProviderAuthority,
  stopHostedPhoneCallCleanupAuthority,
  toHostedPhoneCallStartResponse,
  type HostedPhoneCallReconciliationStore,
} from "./reconciliation";
import { finalizeHostedPhoneCallStartFailure } from "./result";
import {
  startHostedPhoneCallReconciliationWorkflow,
} from "./reconciliation-workflow-start";
import { resolveVerifiedMemberTransferNumber } from "./transfer";
import {
  assertHostedGroupPhoneCallRequesterHasOwnMurph,
} from "./group-requester";
import {
  hasPhoneCallRuntimeNoActiveEffect,
  markPhoneCallRuntimeNoActiveEffect,
  type PhoneCallRuntime,
} from "./types";

interface HostedPhoneCallReservationData {
  briefEncrypted: string;
  id: string;
  memberId: string;
  originSessionId: string;
  provider: "retell";
  requestKey: string;
  resultNotificationChannel: HostedPhoneCallResultNotificationChannel | null;
  status: "starting";
}

interface HostedPhoneCallStore extends HostedPhoneCallReconciliationStore {
  refreshDispatchAuthority(input: {
    expectedUpdatedAt: Date;
    id: string;
    updatedAt: Date;
  }): Promise<{ count: number }>;
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

type HostedPhoneCallNotificationDestinationResolver = (input: {
  directChannel?: HostedPhoneCallResultNotificationChannel;
  memberId: string;
  signal?: AbortSignal;
}) => Promise<HostedAssistantNotificationDestination>;

type HostedGroupPhoneCallRequesterActivationAsserter = (input: {
  groupRequester: HostedPhoneCallGroupRequester | null;
  inboundMailboxItemIds: readonly string[];
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}) => Promise<void>;

export async function createHostedPhoneCall(input: {
  brief: HostedPhoneCallBrief;
  crypto?: HostedPhoneCallCrypto;
  finalizeStartFailure?: typeof finalizeHostedPhoneCallStartFailure;
  groupRequester?: HostedPhoneCallGroupRequester;
  groupRequesterActivationAsserter?: HostedGroupPhoneCallRequesterActivationAsserter;
  inboundMailboxItemIds?: readonly string[];
  memberId: string;
  notificationDestinationResolver?: HostedPhoneCallNotificationDestinationResolver;
  originSessionId: string;
  prisma?: HostedPhoneCallStore;
  reconciliationWorkflowStarter?: HostedPhoneCallReconciliationWorkflowStarter;
  requestKey: string;
  resultNotificationChannel?: HostedPhoneCallResultNotificationChannel;
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
  const finalizeStartFailure = input.finalizeStartFailure
    ?? finalizeHostedPhoneCallStartFailure;
  const startReconciliationWorkflow = input.reconciliationWorkflowStarter
    ?? startHostedPhoneCallReconciliationWorkflow;
  const resolveTransferNumber =
    input.transferNumberResolver ?? resolveVerifiedMemberTransferNumber;
  const resolveNotificationDestination = input.notificationDestinationResolver
    ?? requireHostedAssistantNotificationDestination;
  const resolveReplay = (call: HostedPhoneCall) =>
    resolveExistingHostedPhoneCall({
      brief: input.brief,
      call,
      crypto,
      memberId: input.memberId,
      originSessionId: input.originSessionId,
      resultNotificationChannel: input.resultNotificationChannel ?? null,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  if (input.resultNotificationChannel) {
    const existing = await findHostedPhoneCallByRequestKey({
      memberId: input.memberId,
      requestKey: input.requestKey,
      store,
    });
    if (existing) {
      return await resolveReplay(existing);
    }
  }

  let notificationDestination: HostedAssistantNotificationDestination;
  try {
    notificationDestination = await resolveNotificationDestination({
      ...(input.resultNotificationChannel
        ? { directChannel: input.resultNotificationChannel }
        : {}),
      memberId: input.memberId,
      signal: input.signal,
    });
  } catch (error) {
    // An exact replay remains authoritative even if its mutable delivery route
    // was removed after the provider effect began. Re-read after route failure
    // to close the concurrent-reservation race without admitting a new call.
    if (input.resultNotificationChannel) {
      const existing = await findHostedPhoneCallByRequestKey({
        memberId: input.memberId,
        requestKey: input.requestKey,
        store,
      });
      if (existing) {
        return await resolveReplay(existing);
      }
    }
    throw error;
  }
  input.signal.throwIfAborted();
  const threadContainerDestination =
    isHostedThreadContainerNotificationDestination(notificationDestination);
  if (input.resultNotificationChannel) {
    assertHostedPhoneCallDirectNotificationDestination({
      channel: input.resultNotificationChannel,
      destination: notificationDestination,
    });
  }
  let reassertGroupRequesterAuthority: (() => Promise<void>) | null = null;
  if (threadContainerDestination) {
    const routeAuthority = notificationDestination.externalThreadRouteAuthority;
    if (!routeAuthority) {
      throw new Error(
        "Hosted thread-container notification destination is missing route authority.",
      );
    }
    const assertGroupRequesterActivation =
      input.groupRequesterActivationAsserter
      ?? assertHostedGroupPhoneCallRequesterHasOwnMurph;
    const authorityInput = {
      groupRequester: input.groupRequester ?? null,
      inboundMailboxItemIds: input.inboundMailboxItemIds ?? [],
      routeAuthority,
      signal: input.signal,
    };
    await assertGroupRequesterActivation(authorityInput);
    reassertGroupRequesterAuthority = async () => {
      await assertGroupRequesterActivation(authorityInput);
    };
    input.signal.throwIfAborted();
  }
  const brief = normalizeHostedPhoneCallBriefForConversation({
    brief: input.brief,
    notificationDestination,
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
      brief,
      call: existing,
      crypto,
      memberId: input.memberId,
      originSessionId: input.originSessionId,
      resultNotificationChannel: input.resultNotificationChannel ?? null,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  }
  if (!threadContainerDestination && !input.resultNotificationChannel) {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_RESULT_CHANNEL_REQUIRED",
      httpStatus: 409,
      message: "New direct phone calls require an authenticated origin channel.",
      retryable: true,
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
  const transferNumber = brief.allowTransferToUser
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
    value: brief,
  });
  input.signal.throwIfAborted();
  const reservation = await store.reserve({
    data: {
      briefEncrypted,
      id: callId,
      memberId: input.memberId,
      originSessionId: input.originSessionId,
      provider: "retell",
      requestKey: input.requestKey,
      resultNotificationChannel: input.resultNotificationChannel ?? null,
      status: "starting",
    },
  });
  const call = reservation.call;
  if (!reservation.created) {
    return await resolveExistingHostedPhoneCall({
      brief,
      call,
      crypto,
      memberId: input.memberId,
      originSessionId: input.originSessionId,
      resultNotificationChannel: input.resultNotificationChannel ?? null,
      runtime,
      signal: input.signal,
      startReconciliationWorkflow,
      store,
    });
  }

  let dispatchAuthority: { count: number };
  try {
    await startReconciliationWorkflow(
      { phoneCallId: call.id },
      { signal: input.signal },
    );
    input.signal.throwIfAborted();
    const dispatchAuthorityUpdatedAt = new Date(Math.max(
      Date.now(),
      call.updatedAt.getTime() + 1,
    ));
    dispatchAuthority = await waitForAbortableOperation(input.signal, () =>
      store.refreshDispatchAuthority({
        expectedUpdatedAt: call.updatedAt,
        id: call.id,
        updatedAt: dispatchAuthorityUpdatedAt,
      }));
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
  if (dispatchAuthority.count === 0) {
    try {
      const current = await waitForAbortableOperation(input.signal, () =>
        store.hostedPhoneCall.findUniqueOrThrow({
          where: { id: call.id },
        }));
      return toHostedPhoneCallStartResponse(current);
    } catch {
      input.signal.throwIfAborted();
      return {
        phoneCallId: call.id,
        status: "starting",
      };
    }
  }

  let started: Awaited<ReturnType<PhoneCallRuntime["start"]>>;
  try {
    try {
      input.signal.throwIfAborted();
      await reassertGroupRequesterAuthority?.();
      if (input.resultNotificationChannel) {
        const currentDestination = await resolveNotificationDestination({
          directChannel: input.resultNotificationChannel,
          memberId: input.memberId,
          signal: input.signal,
        });
        assertHostedPhoneCallDirectNotificationDestination({
          channel: input.resultNotificationChannel,
          destination: currentDestination,
        });
      }
      input.signal.throwIfAborted();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }
    started = await runtime.start({
      brief,
      id: call.id,
      memberId: input.memberId,
      transferNumber,
    }, {
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
    try {
      await waitForAbortableOperation(input.signal, () =>
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
    let cleanupCall: HostedPhoneCall;
    try {
      cleanupCall = await waitForAbortableOperation(input.signal, () =>
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
      isHostedPhoneCallProviderCleanupPending(cleanupCall)
      && cleanupCall.providerCallId
    ) {
      try {
        await stopHostedPhoneCallCleanupAuthority({
          call: {
            id: cleanupCall.id,
            providerCallId: cleanupCall.providerCallId,
          },
          finalizeBeforeEnd: () => finalizeStartFailure(cleanupCall, {
            abortSignal: input.signal,
          }),
          runtime,
          signal: input.signal,
          store,
        });
      } catch {
        // Failed cleanup stays durable for Workflow or replay recovery.
      }
    } else if (hasPhoneCallAdvancedBeyondStart(cleanupCall)) {
      return toHostedPhoneCallStartResponse(cleanupCall);
    } else {
      return {
        phoneCallId: call.id,
        status: "starting",
      };
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

async function findHostedPhoneCallByRequestKey(input: {
  memberId: string;
  requestKey: string;
  store: HostedPhoneCallStore;
}): Promise<HostedPhoneCall | null> {
  return input.store.hostedPhoneCall.findUnique({
    where: {
      memberId_requestKey: {
        memberId: input.memberId,
        requestKey: input.requestKey,
      },
    },
  });
}

function assertHostedPhoneCallDirectNotificationDestination(input: {
  channel: HostedPhoneCallResultNotificationChannel;
  destination: HostedAssistantNotificationDestination;
}): void {
  if (
    isHostedThreadContainerNotificationDestination(input.destination)
    || input.destination.route.threadIsDirect !== true
    || input.destination.route.channel !== input.channel
  ) {
    throw new Error(
      "Hosted phone call result notification channel does not match the direct route.",
    );
  }
}

function normalizeHostedPhoneCallBriefForConversation(input: {
  brief: HostedPhoneCallBrief;
  notificationDestination: HostedAssistantNotificationDestination;
}): HostedPhoneCallBrief {
  if (
    !isHostedThreadContainerNotificationDestination(
      input.notificationDestination,
    )
    || !input.brief.allowTransferToUser
  ) {
    return input.brief;
  }

  // A room-owned call must never bridge the live caller to one participant.
  // Normalize before dedupe comparison, encryption, and provider dispatch so
  // every server-owned representation carries the same effective authority.
  return {
    ...input.brief,
    allowTransferToUser: false,
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
      },
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
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
  originSessionId: string;
  resultNotificationChannel: HostedPhoneCallResultNotificationChannel | null;
  runtime: PhoneCallRuntime;
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
  store: HostedPhoneCallStore;
}): Promise<HostedPhoneCallStartResponse> {
  if (input.call.memberId !== input.memberId) {
    throw new Error("Hosted phone call request key collision.");
  }
  if (
    input.call.originSessionId !== input.originSessionId
    && !isHostedScheduledPhoneCallRequestKey(input.call.requestKey)
  ) {
    throw new Error("Hosted phone call request key collision.");
  }
  if (
    input.call.resultNotificationChannel !== null
    && input.resultNotificationChannel !== null
    && input.call.resultNotificationChannel !== input.resultNotificationChannel
  ) {
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
      },
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
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
      },
      signal: input.signal,
      startReconciliationWorkflow: input.startReconciliationWorkflow,
    });
  }
  return result;
}

async function ensureHostedPhoneCallCleanup(input: {
  call: {
    id: string;
  };
  signal: AbortSignal;
  startReconciliationWorkflow: HostedPhoneCallReconciliationWorkflowStarter;
}): Promise<void> {
  try {
    await input.startReconciliationWorkflow(
      { phoneCallId: input.call.id },
      { signal: input.signal },
    );
  } catch {
    // The durable cleanup row remains available to Workflow or replay recovery.
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
    refreshDispatchAuthority: async (input) => prisma.hostedPhoneCall.updateMany({
      data: {
        updatedAt: input.updatedAt,
      },
      where: {
        analyzedAt: null,
        id: input.id,
        provider: "retell",
        providerCallId: null,
        status: "starting",
        updatedAt: input.expectedUpdatedAt,
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
