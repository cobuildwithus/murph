import type { HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallResult,
} from "@murphai/hosted-execution/phone-calls";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAssistantNotificationDestination,
} from "@/src/lib/hosted-routing/assistant-notification-destination";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedPhoneCallBrief: vi.fn(),
  readHostedPhoneCallResult: vi.fn(),
  requireHostedAssistantNotificationDestination: vi.fn(),
  unwrapHostedDomainRootForWeb: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
}));

vi.mock("@/src/lib/phone-calls/crypto", () => ({
  hostedPhoneCallCrypto: {
    decryptBrief: vi.fn(),
    decryptResult: vi.fn(),
    encryptBrief: vi.fn(),
    encryptResult: vi.fn(),
  },
  readHostedPhoneCallBrief: mocks.readHostedPhoneCallBrief,
  readHostedPhoneCallResult: mocks.readHostedPhoneCallResult,
}));

vi.mock(
  "@/src/lib/hosted-routing/assistant-notification-destination",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/hosted-routing/assistant-notification-destination")
    >();
    return {
      ...actual,
      requireHostedAssistantNotificationDestination:
        mocks.requireHostedAssistantNotificationDestination,
    };
  },
);

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: mocks.unwrapHostedDomainRootForWeb,
}));

import {
  finalizeStoredHostedPhoneCallResult,
  handleRetellCallAnalyzed,
} from "@/src/lib/phone-calls/result";

const MEMBER_ID = "member_result_notification_store";
const CALL_ID = "hpc_result_notification_store";
const PROVIDER_CALL_ID = "retell_result_notification_store";
const LEGACY_NOTIFICATION_DEDUPE_KEY =
  `assistant.notification.requested:phone-call-result:${CALL_ID}`;
const TRACKED_NOTIFICATION_DEDUPE_KEY =
  `${LEGACY_NOTIFICATION_DEDUPE_KEY}:generation:1`;

const RESULT: HostedPhoneCallResult = {
  outcome: "completed",
  summary: "The pharmacy confirmed the prescription is ready.",
};

const BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: false,
  goal: "Confirm whether the prescription is ready.",
  instructions: [],
  shareableFacts: {},
  successCriteria: "The pharmacy confirms pickup readiness.",
  timeZone: "America/New_York",
  to: {
    label: "the pharmacy",
    phoneNumber: "+15550102020",
  },
};

const TELEGRAM_DESTINATION: HostedAssistantNotificationDestination = {
  conversationShape: "direct-member",
  externalThreadRouteAuthority: null,
  route: {
    actorId: MEMBER_ID,
    channel: "telegram",
    delivery: {
      kind: "thread",
      target: "telegram_home_result_notification_store",
    },
    identityId: "telegram_identity_result_notification_store",
    threadId: "telegram_thread_result_notification_store",
    threadIsDirect: true,
  },
};

describe("default phone-call result notification store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finishes every preparation phase before one mailbox-only transaction", async () => {
    const phases: string[] = [];
    const resultPhase = createBlockedPhase("result", RESULT, phases);
    const briefPhase = createBlockedPhase("brief", BRIEF, phases);
    const destinationPhase = createBlockedPhase(
      "destination",
      TELEGRAM_DESTINATION,
      phases,
    );
    const rootKey = new Uint8Array([1, 2, 3, 4]);
    const rootPhase = createBlockedPhase("root", {
      envelope: { rootKeyId: "root_result_notification_store" },
      rootKey,
    }, phases);
    let transactionOpen = false;
    const transactionClient = {
      hostedPhoneCall: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      kind: "mailbox-transaction",
    };
    const prisma = buildPrisma({
      call: buildStoredAnalyzedCall({
        resultDeliveryStatus: "pending",
        resultNotificationChannel: "telegram",
      }),
      onTransaction: async (callback) => {
        phases.push("transaction:start");
        expect([...rootKey]).toEqual([0, 0, 0, 0]);
        transactionOpen = true;
        try {
          return await callback(transactionClient);
        } finally {
          transactionOpen = false;
          phases.push("transaction:end");
        }
      },
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      phases.push("dedupe-read");
      return null;
    });
    mocks.readHostedPhoneCallResult.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return await resultPhase.run();
    });
    mocks.readHostedPhoneCallBrief.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return await briefPhase.run();
    });
    mocks.requireHostedAssistantNotificationDestination.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return await destinationPhase.run();
    });
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return await rootPhase.run();
    });
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async (input: {
      envelope: {
        eventId: string;
        notification: {
          instructions: string;
          responsePolicy: { kind: string };
        };
      };
      tx: unknown;
    }) => {
      expect(transactionOpen).toBe(true);
      expect(input.tx).toBe(transactionClient);
      expect(input.envelope.eventId).toBe(TRACKED_NOTIFICATION_DEDUPE_KEY);
      expect(input.envelope.notification.responsePolicy).toEqual({
        kind: "require_send",
      });
      expect(input.envelope.notification.instructions).not.toContain(
        "Ask the user what happened after the handoff",
      );
      phases.push("mailbox-append");
      return {
        item: {
          id: "mailbox_result_notification_store",
          userId: MEMBER_ID,
        },
      };
    });

    const handling = handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    });

    await resultPhase.started.promise;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    resultPhase.release.resolve();

    await briefPhase.started.promise;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    briefPhase.release.resolve();

    await destinationPhase.started.promise;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    destinationPhase.release.resolve();

    await rootPhase.started.promise;
    expect(prisma.$transaction).not.toHaveBeenCalled();
    rootPhase.release.resolve();

    await expect(handling).resolves.toEqual({
      notificationMailboxItemId: "mailbox_result_notification_store",
      notificationUserId: MEMBER_ID,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(phases).toEqual([
      "dedupe-read",
      "result:start",
      "result:end",
      "brief:start",
      "brief:end",
      "destination:start",
      "destination:end",
      "root:start",
      "root:end",
      "transaction:start",
      "mailbox-append",
      "transaction:end",
    ]);
    expect(mocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledWith({
      domain: expect.any(String),
      prisma,
      retainFailureInScopedCache: true,
      userId: MEMBER_ID,
    });
    expect(
      mocks.requireHostedAssistantNotificationDestination,
    ).toHaveBeenCalledWith({
      directChannel: "telegram",
      memberId: MEMBER_ID,
      prisma,
    });
  });

  it("returns the canonical mailbox item without opening a transaction", async () => {
    const prisma = buildPrisma();
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      id: "mailbox_result_notification_existing",
      userId: MEMBER_ID,
    });

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_result_notification_existing",
      notificationUserId: MEMBER_ID,
    });

    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: LEGACY_NOTIFICATION_DEDUPE_KEY,
      prisma,
      userId: MEMBER_ID,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.readHostedPhoneCallResult).not.toHaveBeenCalled();
    expect(mocks.readHostedPhoneCallBrief).not.toHaveBeenCalled();
    expect(mocks.requireHostedAssistantNotificationDestination).not.toHaveBeenCalled();
    expect(mocks.unwrapHostedDomainRootForWeb).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      expectedDedupeKey: TRACKED_NOTIFICATION_DEDUPE_KEY,
      expectedPolicy: "require_send",
      label: "tracked transfer",
      result: {
        completionPolicy: "transfer_follow_up_required",
        outcome: "needs_user",
        summary: "The human conversation ended after Murph completed the handoff.",
      } satisfies HostedPhoneCallResult,
      tracked: true,
    },
    {
      expectedDedupeKey: LEGACY_NOTIFICATION_DEDUPE_KEY,
      expectedPolicy: "require_send",
      label: "generationless manual transfer",
      result: {
        completionPolicy: "transfer_follow_up_required",
        outcome: "needs_user",
        summary: "The human conversation ended after Murph completed the handoff.",
      } satisfies HostedPhoneCallResult,
      tracked: false,
    },
    {
      expectedDedupeKey: LEGACY_NOTIFICATION_DEDUPE_KEY,
      expectedPolicy: "allow_send_or_skip",
      label: "legacy ordinary result",
      result: RESULT,
      tracked: false,
    },
  ] as const)("recovers a stored $label with its durable completion policy", async ({
    expectedDedupeKey,
    expectedPolicy,
    result,
    tracked,
  }) => {
    const storedCall = buildStoredAnalyzedCall(tracked
      ? {
          resultDeliveryStatus: "pending",
          resultNotificationChannel: "telegram",
        }
      : {});
    const prisma = buildPrisma({
      call: storedCall,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    let durableItem: { id: string; userId: string } | null = null;
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () =>
      durableItem
    );
    mocks.readHostedPhoneCallResult.mockResolvedValue(result);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      TELEGRAM_DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockResolvedValue({
      envelope: { rootKeyId: "root_transfer_recovery" },
      rootKey: new Uint8Array([1, 2, 3, 4]),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async () => {
      durableItem = {
        id: "mailbox_transfer_recovery",
        userId: MEMBER_ID,
      };
      return { item: durableItem };
    });

    const signalRuntime = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: `hosted-user-runtime:${MEMBER_ID}`,
    }));
    await expect(finalizeStoredHostedPhoneCallResult(storedCall, {
      signalRuntime,
    })).resolves.toBe(tracked ? "pending" : "complete");

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      ?.envelope;
    expect(envelope?.eventId).toBe(expectedDedupeKey);
    expect(envelope?.notification.responsePolicy).toEqual({
      kind: expectedPolicy,
    });
    if (result.completionPolicy === "transfer_follow_up_required") {
      expect(envelope?.notification.instructions).toContain(
        "Ask the user what happened after the handoff",
      );
      expect(envelope?.notification.instructions).not.toContain(
        "you may skip sending a message",
      );
    } else {
      expect(envelope?.notification.instructions).toContain(
        "you may skip sending a message",
      );
    }
    expect(signalRuntime).toHaveBeenCalledWith({
      abortSignal: undefined,
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_transfer_recovery",
    });

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
      completionPolicy: "transfer_follow_up_required",
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_transfer_recovery",
      notificationUserId: MEMBER_ID,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
  });

  it("converges concurrent webhook and reconciliation appends on one mailbox item", async () => {
    const prisma = buildPrisma({
      call: buildStoredAnalyzedCall({
        resultDeliveryStatus: "pending",
        resultNotificationChannel: "telegram",
      }),
    });
    mocks.getPrisma.mockReturnValue(prisma);
    const bothDedupeReads = createDeferred<void>();
    let dedupeReadCount = 0;
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => {
      dedupeReadCount += 1;
      if (dedupeReadCount === 2) {
        bothDedupeReads.resolve();
      }
      return null;
    });
    mocks.readHostedPhoneCallResult.mockResolvedValue(RESULT);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      TELEGRAM_DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(async () => {
      await bothDedupeReads.promise;
      return {
        envelope: { rootKeyId: "root_concurrent_result" },
        rootKey: new Uint8Array([1, 2, 3, 4]),
      };
    });
    let durableAppendCount = 0;
    let durableItem: { id: string; userId: string } | null = null;
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async () => {
      if (!durableItem) {
        durableAppendCount += 1;
        durableItem = {
          id: "mailbox_result_notification_concurrent",
          userId: MEMBER_ID,
        };
      }
      return { item: durableItem };
    });

    const results = await Promise.all([
      handleRetellCallAnalyzed({ call: buildAnalyzedRetellCallPayload() }),
      handleRetellCallAnalyzed({ call: buildAnalyzedRetellCallPayload() }),
    ]);

    expect(results).toEqual([
      {
        notificationMailboxItemId: "mailbox_result_notification_concurrent",
        notificationUserId: MEMBER_ID,
      },
      {
        notificationMailboxItemId: "mailbox_result_notification_concurrent",
        notificationUserId: MEMBER_ID,
      },
    ]);
    expect(durableAppendCount).toBe(1);
  });

  it("fails closed when a tracked result has no delivery generation", async () => {
    const prisma = buildPrisma({
      call: buildStoredAnalyzedCall({
        resultDeliveryGeneration: null,
        resultDeliveryStatus: "pending",
        resultNotificationChannel: "telegram",
      }),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_STATE_INVALID",
      retryable: true,
    });

    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
    expect(mocks.requireHostedAssistantNotificationDestination).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("suppresses duplicate analysis after a tracked generation is terminal", async () => {
    const prisma = buildPrisma({
      call: buildStoredAnalyzedCall({
        resultDeliveryGeneration: 1,
        resultDeliveryStatus: "delivered",
        resultDeliveryTerminalAt: new Date("2026-08-09T00:05:00.000Z"),
        resultNotificationChannel: "telegram",
      }),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    })).resolves.toEqual({
      notificationMailboxItemId: null,
      notificationUserId: null,
    });

    expect(TRACKED_NOTIFICATION_DEDUPE_KEY).not.toBe(
      LEGACY_NOTIFICATION_DEDUPE_KEY,
    );
    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
    expect(mocks.requireHostedAssistantNotificationDestination).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function buildPrisma(input: {
  call?: HostedPhoneCall;
  onTransaction?: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
} = {}) {
  let call = input.call ?? buildStoredAnalyzedCall();
  const transactionClient = {
    hostedPhoneCall: {
      updateMany: vi.fn(async (args: {
        data: {
          resultDeliveryGeneration: number;
          resultDeliveryStatus: HostedPhoneCall["resultDeliveryStatus"];
          resultDeliveryTerminalAt: Date | null;
        };
        where: {
          resultDeliveryGeneration: number;
          resultDeliveryStatus: HostedPhoneCall["resultDeliveryStatus"];
        };
      }) => {
        if (
          call.resultDeliveryGeneration !== args.where.resultDeliveryGeneration
          || call.resultDeliveryStatus !== args.where.resultDeliveryStatus
        ) {
          return { count: 0 };
        }
        call = {
          ...call,
          ...args.data,
        };
        return { count: 1 };
      }),
    },
  };
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      if (input.onTransaction) {
        return await input.onTransaction(callback);
      }
      return await callback(transactionClient);
    }),
    hostedPhoneCall: {
      findUnique: vi.fn(async () => call),
      updateMany: vi.fn(async () => {
        throw new Error("Stored analyzed result must not run the analysis CAS.");
      }),
    },
  };
}

function buildStoredAnalyzedCall(
  overrides: Partial<HostedPhoneCall> = {},
): HostedPhoneCall {
  const now = new Date("2026-08-09T00:00:00.000Z");
  return {
    analyzedAt: now,
    briefEncrypted: "encrypted-brief",
    briefJson: null,
    createdAt: now,
    endedAt: now,
    id: CALL_ID,
    memberId: MEMBER_ID,
    originSessionId: "session_result_notification_store",
    provider: "retell",
    providerCallId: PROVIDER_CALL_ID,
    requestKey: "request_result_notification_store",
    resultDeliveryGeneration: 0,
    resultDeliveryStatus: null,
    resultDeliveryTerminalAt: null,
    resultEncrypted: "encrypted-result",
    resultJson: null,
    resultNotificationChannel: null,
    status: "completed",
    updatedAt: now,
    ...overrides,
  };
}

function buildAnalyzedRetellCallPayload() {
  return {
    call_id: PROVIDER_CALL_ID,
    data_storage_setting: "basic_attributes_only" as const,
  };
}

function createBlockedPhase<T>(name: string, value: T, phases: string[]) {
  const started = createDeferred<void>();
  const release = createDeferred<void>();
  return {
    release,
    run: async (): Promise<T> => {
      phases.push(`${name}:start`);
      started.resolve();
      await release.promise;
      phases.push(`${name}:end`);
      return value;
    },
    started,
  };
}

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}
