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
  handleRetellCallAnalyzed,
} from "@/src/lib/phone-calls/result";

const MEMBER_ID = "member_result_notification_store";
const CALL_ID = "hpc_result_notification_store";
const PROVIDER_CALL_ID = "retell_result_notification_store";
const NOTIFICATION_DEDUPE_KEY =
  `assistant.notification.requested:phone-call-result:${CALL_ID}`;

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
    const transactionClient = { kind: "mailbox-transaction" };
    const prisma = buildPrisma({
      call: buildStoredAnalyzedCall({
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
      envelope: { eventId: string };
      tx: unknown;
    }) => {
      expect(transactionOpen).toBe(true);
      expect(input.tx).toBe(transactionClient);
      expect(input.envelope.eventId).toBe(NOTIFICATION_DEDUPE_KEY);
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
      dedupeKey: NOTIFICATION_DEDUPE_KEY,
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
});

function buildPrisma(input: {
  call?: HostedPhoneCall;
  onTransaction?: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
} = {}) {
  const call = input.call ?? buildStoredAnalyzedCall();
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      if (input.onTransaction) {
        return await input.onTransaction(callback);
      }
      return await callback({ kind: "mailbox-transaction" });
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
