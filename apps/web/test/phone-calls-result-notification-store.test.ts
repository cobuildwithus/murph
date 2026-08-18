import { Prisma, type HostedPhoneCall } from "@prisma/client";
import type {
  HostedPhoneCallBrief,
  HostedPhoneCallResult,
} from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAssistantNotificationDestination,
} from "@/src/lib/hosted-routing/assistant-notification-destination";
import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  encryptHostedPhoneCallResult: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  readHostedPhoneCallBrief: vi.fn(),
  readHostedPhoneCallResult: vi.fn(),
  requireHostedAssistantNotificationDestination: vi.fn(),
  signalHostedPhoneCallReconciliation: vi.fn(),
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
    encryptResult: mocks.encryptHostedPhoneCallResult,
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

vi.mock(
  "@/src/lib/phone-calls/reconciliation-workflow-signal",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/phone-calls/reconciliation-workflow-signal")
    >();
    return {
      ...actual,
      signalHostedPhoneCallReconciliation:
        mocks.signalHostedPhoneCallReconciliation,
    };
  },
);

import {
  finalizeHostedPhoneCallStartFailure,
  finalizeHostedPhoneCallStopSettlement,
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

const DESTINATION: HostedAssistantNotificationDestination = {
  conversationShape: "direct-member",
  externalThreadRouteAuthority: null,
  route: {
    actorId: MEMBER_ID,
    channel: "linq",
    delivery: {
      kind: "thread",
      target: "linq_home_result_notification_store",
    },
    identityId: "identity_result_notification_store",
    threadId: "thread_result_notification_store",
    threadIsDirect: true,
  },
};

describe("default phone-call result notification store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.encryptHostedPhoneCallResult.mockResolvedValue(
      "encrypted-fallback-result",
    );
    setHostedSecureBoxStringTestCodecForTests(null);
    mocks.signalHostedPhoneCallReconciliation.mockResolvedValue(undefined);
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
      signal: expect.any(AbortSignal),
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

  it("routes a stored Linq-origin result back through Linq", async () => {
    const prisma = buildPrisma({ resultNotificationChannel: "linq" });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallResult.mockResolvedValue(RESULT);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockResolvedValue({
      envelope: { rootKeyId: "root_linq_result" },
      rootKey: new Uint8Array([1, 2, 3, 4]),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: { id: "mailbox_linq_result", userId: MEMBER_ID },
    });

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_linq_result",
      notificationUserId: MEMBER_ID,
    });

    expect(mocks.requireHostedAssistantNotificationDestination).toHaveBeenCalledWith({
      directChannel: "linq",
      memberId: MEMBER_ID,
      prisma,
    });
  });

  it("keeps a revoked originating route retryable instead of switching channels", async () => {
    const prisma = buildPrisma({ resultNotificationChannel: "telegram" });
    const routeError = Object.assign(new Error("origin route revoked"), {
      retryable: true,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallResult.mockResolvedValue(RESULT);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockRejectedValue(
      routeError,
    );

    await expect(handleRetellCallAnalyzed({
      call: buildAnalyzedRetellCallPayload(),
    })).rejects.toBe(routeError);

    expect(mocks.requireHostedAssistantNotificationDestination).toHaveBeenCalledWith({
      directChannel: "telegram",
      memberId: MEMBER_ID,
      prisma,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(prisma.hostedPhoneCall.findUnique).toHaveBeenCalled();
  });

  it("dedupes the required stop-settlement mailbox item across workflow replay", async () => {
    const stoppedAt = new Date("2026-08-09T00:02:00.000Z");
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall(),
      analyzedAt: null,
      endedAt: stoppedAt,
      resultEncrypted: null,
      status: "ended",
      stopRequestedAt: new Date("2026-08-09T00:01:00.000Z"),
      updatedAt: stoppedAt,
    };
    const prisma = buildPrisma({ resultNotificationChannel: "telegram" });
    const signalRuntime = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: `hosted-user-runtime:${MEMBER_ID}`,
    }));
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "mailbox_stop_settled",
        userId: MEMBER_ID,
      });
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockResolvedValue({
      envelope: { rootKeyId: "root_stop_settled" },
      rootKey: new Uint8Array([1, 2, 3, 4]),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: { id: "mailbox_stop_settled", userId: MEMBER_ID },
    });

    await finalizeHostedPhoneCallStopSettlement(call, { signalRuntime });
    await finalizeHostedPhoneCallStopSettlement(call, { signalRuntime });

    const stopDedupeKey =
      `assistant.notification.requested:phone-call-result:${CALL_ID}:stop-settled`;
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenNthCalledWith(1, {
      dedupeKey: stopDedupeKey,
      prisma,
      userId: MEMBER_ID,
    });
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenNthCalledWith(2, {
      dedupeKey: stopDedupeKey,
      prisma,
      userId: MEMBER_ID,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
    expect(signalRuntime).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "provider-less start failure",
      outcome: "not_completed",
      providerCallId: null,
      summary: "Murph could not start the phone call.",
      stopRequestedAt: null,
    },
    {
      label: "unsafe provider cleanup",
      outcome: "needs_user",
      providerCallId: PROVIDER_CALL_ID,
      summary: "Murph could not safely verify whether the request was completed.",
      stopRequestedAt: null,
    },
    {
      label: "unsafe provider cleanup with a stop fence",
      outcome: "needs_user",
      providerCallId: PROVIDER_CALL_ID,
      summary: "Murph could not safely verify whether the request was completed.",
      stopRequestedAt: new Date("2026-08-09T00:01:00.000Z"),
    },
  ])("dedupes $label and requires Murph to send it", async ({
    outcome,
    providerCallId,
    summary,
    stopRequestedAt,
  }) => {
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall({ resultNotificationChannel: "linq" }),
      analyzedAt: null,
      endedAt: null,
      providerCallId,
      resultEncrypted: null,
      status: "failed",
      stopRequestedAt,
    };
    const prisma = buildPrisma({ call, resultNotificationChannel: "linq" });
    const signalRuntime = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: `hosted-user-runtime:${MEMBER_ID}`,
    }));
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "mailbox_start_failed",
        userId: MEMBER_ID,
      });
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockResolvedValue({
      envelope: { rootKeyId: "root_start_failed" },
      rootKey: new Uint8Array([1, 2, 3, 4]),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: { id: "mailbox_start_failed", userId: MEMBER_ID },
    });
    mocks.readHostedPhoneCallResult.mockResolvedValue({
      ...(providerCallId
        ? {
            followUp:
              "Confirm the outcome with the call recipient before repeating the request.",
          }
        : {}),
      outcome,
      summary: providerCallId
        ? "The call is no longer active, but Murph could not safely verify whether the request was completed."
        : summary,
    });

    await finalizeHostedPhoneCallStartFailure(call, { signalRuntime });
    const storedCall = await prisma.hostedPhoneCall.findUnique({
      where: { id: call.id },
    });
    await finalizeHostedPhoneCallStartFailure(storedCall, { signalRuntime });

    expect(mocks.encryptHostedPhoneCallResult).toHaveBeenCalledOnce();
    expect(prisma.hostedPhoneCall.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ...(providerCallId ? {} : { analyzedAt: expect.any(Date) }),
        resultEncrypted: "encrypted-fallback-result",
      }),
      where: expect.objectContaining({
        analyzedAt: null,
        ...(providerCallId ? { endedAt: null } : {}),
        id: CALL_ID,
        provider: "retell",
        providerCallId,
        resultEncrypted: null,
        status: "failed",
      }),
    });
    expect(storedCall).toMatchObject({
      analyzedAt: providerCallId ? null : expect.any(Date),
      resultEncrypted: "encrypted-fallback-result",
      resultJson: null,
    });
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenNthCalledWith(1, {
      dedupeKey: LEGACY_NOTIFICATION_DEDUPE_KEY,
      prisma,
      userId: MEMBER_ID,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledOnce();
    expect(mocks.readHostedPhoneCallResult).toHaveBeenCalledOnce();
    const instructions = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      .envelope.notification.instructions;
    expect(instructions).toContain(summary);
    expect(instructions).toContain(`"outcome":"${outcome}"`);
    if (providerCallId) {
      expect(instructions).toContain(
        "Confirm the outcome with the call recipient before repeating the request.",
      );
      expect(instructions).not.toContain("Murph stopped the phone call");
    }
    expect(JSON.stringify(
      mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0],
    )).toContain('"kind":"require_send"');
    expect(signalRuntime).toHaveBeenCalledTimes(2);
  });

  it("stores a fenced provider-less failure without emitting an ordinary result", async () => {
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall({ resultNotificationChannel: "linq" }),
      analyzedAt: null,
      endedAt: null,
      providerCallId: null,
      resultEncrypted: null,
      status: "failed",
      stopRequestedAt: new Date("2026-08-09T00:01:00.000Z"),
    };
    const prisma = buildPrisma({ call, resultNotificationChannel: "linq" });
    const signalRuntime = vi.fn();
    mocks.getPrisma.mockReturnValue(prisma);

    await finalizeHostedPhoneCallStartFailure(call, {
      notifyResult: false,
      signalRuntime,
    });

    expect(await prisma.hostedPhoneCall.findUnique({
      where: { id: call.id },
    })).toMatchObject({
      resultEncrypted: "encrypted-fallback-result",
      resultJson: null,
    });
    expect(mocks.readHostedMailboxItemByDedupeKey).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(signalRuntime).not.toHaveBeenCalled();
  });

  it("keeps provider analysis canonical when it wins the fallback CAS", async () => {
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall({ resultNotificationChannel: "linq" }),
      analyzedAt: null,
      endedAt: null,
      resultEncrypted: null,
      status: "failed",
    };
    const authoritativeResult: HostedPhoneCallResult = {
      outcome: "completed",
      summary: "The recipient confirmed the request was completed.",
    };
    const prisma = buildPrisma({
      call,
      onResultUpdate: () => ({
        call: {
          ...call,
          analyzedAt: new Date("2026-08-09T00:02:00.000Z"),
          endedAt: new Date("2026-08-09T00:02:00.000Z"),
          resultEncrypted: "encrypted-authoritative-result",
          status: "completed",
        },
        count: 0,
      }),
      resultNotificationChannel: "linq",
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedPhoneCallResult.mockResolvedValue(authoritativeResult);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockResolvedValue({
      envelope: { rootKeyId: "root_authoritative_result" },
      rootKey: new Uint8Array([1, 2, 3, 4]),
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      item: { id: "mailbox_authoritative_result", userId: MEMBER_ID },
    });

    await finalizeHostedPhoneCallStartFailure(call, { signalRuntime: vi.fn() });

    const instructions = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]
      .envelope.notification.instructions;
    expect(instructions).toContain(authoritativeResult.summary);
    expect(instructions).toContain('"outcome":"completed"');
    expect(instructions).not.toContain("could not safely verify");
  });

  it("forwards the provider result fence and reuses an existing fallback notification", async () => {
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall({ resultNotificationChannel: "linq" }),
      analyzedAt: null,
      endedAt: new Date("2026-08-09T00:02:00.000Z"),
      resultEncrypted: "encrypted-fallback-result",
      status: "failed",
    };
    const prisma = buildPrisma({
      call,
      onResultUpdate: () => ({ call, count: 0 }),
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue({
      id: "mailbox_fallback_result",
      userId: MEMBER_ID,
    });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "A late provider event claimed the call completed.",
          },
        },
        call_id: PROVIDER_CALL_ID,
        data_storage_setting: "basic_attributes_only",
      },
      completionPolicy: "transfer_follow_up_required",
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_fallback_result",
      notificationUserId: MEMBER_ID,
    });

    expect(prisma.hostedPhoneCall.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultEncrypted: expect.any(String),
        status: "completed",
      }),
      where: expect.objectContaining({
        resultEncrypted: null,
        resultJson: {
          equals: Prisma.DbNull,
        },
      }),
    });
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledOnce();
    expect(mocks.readHostedPhoneCallResult).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("keeps a cleanup fallback durable when ordinary notification fails", async () => {
    const call: HostedPhoneCall = {
      ...buildStoredAnalyzedCall({ resultNotificationChannel: "linq" }),
      analyzedAt: null,
      endedAt: null,
      resultEncrypted: null,
      status: "failed",
    };
    const prisma = buildPrisma({ call, resultNotificationChannel: "linq" });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockRejectedValue(
      new Error("route unavailable"),
    );

    await expect(finalizeHostedPhoneCallStartFailure(call)).rejects.toThrow(
      "route unavailable",
    );

    expect(await prisma.hostedPhoneCall.findUnique({
      where: { id: call.id },
    })).toMatchObject({
      analyzedAt: null,
      resultEncrypted: "encrypted-fallback-result",
      resultJson: null,
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

  it("reuses stored-result root preparation through the real mailbox append", async () => {
    const storedCall = buildStoredAnalyzedCall({
      resultDeliveryStatus: "pending",
      resultNotificationChannel: "telegram",
    });
    const fixture = buildRealMailboxPrisma(storedCall);
    mocks.getPrisma.mockReturnValue(fixture.prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallResult.mockResolvedValue(RESULT);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      TELEGRAM_DESTINATION,
    );
    const providerCalls: Array<{ transactionOpen: boolean }> = [];
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(async (input: {
      domain: string;
      userId: string;
    }) => {
      const cache = getHostedDomainRootUnwrapCache();
      if (!cache) {
        throw new Error("Stored-result finalization root cache is missing.");
      }
      const activeKey = `${input.userId}|${input.domain}|@active`;
      const cached = cache.get(activeKey);
      if (cached) {
        const unwrapped = await cached;
        return {
          envelope: unwrapped.envelope,
          rootKey: Uint8Array.from(unwrapped.rootKey),
        };
      }
      providerCalls.push({ transactionOpen: fixture.transactionOpen() });
      fixture.events.push("provider-prepared");
      if (fixture.transactionOpen()) {
        throw new Error("Mailbox KMS unwrap started inside the transaction.");
      }
      const timestamp = "2026-08-09T00:00:00.000Z";
      const envelope: HostedDomainRootKeyEnvelopeV1 = {
        authoritySignature: {
          alg: "GCP-KMS-EC-P256-SHA256",
          keyVersionName: "test-authority-key",
          signature: "test-signature",
          signedAt: timestamp,
        },
        createdAt: timestamp,
        domain: "ingress",
        generation: 1,
        rootKeyId: "root_stored_result_mailbox",
        schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
        updatedAt: timestamp,
        userId: input.userId,
        wraps: [],
      };
      const unwrapped = {
        envelope,
        rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      };
      const pending = Promise.resolve(unwrapped);
      cache.set(activeKey, pending);
      cache.set(
        `${input.userId}|${input.domain}|${unwrapped.envelope.rootKeyId}`,
        pending,
      );
      return {
        envelope: unwrapped.envelope,
        rootKey: Uint8Array.from(unwrapped.rootKey),
      };
    });
    const actualMailboxStore = await vi.importActual<
      typeof import("@/src/lib/hosted-mailbox/store")
    >("@/src/lib/hosted-mailbox/store");
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation((input) =>
      actualMailboxStore.appendHostedMailboxEnvelopeTx(input)
    );
    const signalRuntime = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: `hosted-user-runtime:${MEMBER_ID}`,
    }));

    await expect(finalizeStoredHostedPhoneCallResult(storedCall, {
      signalRuntime,
    })).resolves.toBe("pending");

    expect(providerCalls).toEqual([{ transactionOpen: false }]);
    expect(mocks.unwrapHostedDomainRootForWeb).toHaveBeenCalledTimes(2);
    expect(fixture.events.indexOf("provider-prepared")).toBeLessThan(
      fixture.events.indexOf("transaction:start"),
    );
    expect(fixture.currentCall()).toMatchObject({
      resultDeliveryGeneration: 1,
      resultDeliveryStatus: "queued",
    });
    expect(signalRuntime).toHaveBeenCalledOnce();
  });

  it("does not open stored-result persistence when root preparation fails", async () => {
    const storedCall = buildStoredAnalyzedCall({
      resultDeliveryStatus: "pending",
      resultNotificationChannel: "telegram",
    });
    const fixture = buildRealMailboxPrisma(storedCall);
    mocks.getPrisma.mockReturnValue(fixture.prisma);
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValue(null);
    mocks.readHostedPhoneCallResult.mockResolvedValue(RESULT);
    mocks.readHostedPhoneCallBrief.mockResolvedValue(BRIEF);
    mocks.requireHostedAssistantNotificationDestination.mockResolvedValue(
      TELEGRAM_DESTINATION,
    );
    mocks.unwrapHostedDomainRootForWeb.mockRejectedValue(
      new Error("mailbox root unavailable"),
    );

    await expect(finalizeStoredHostedPhoneCallResult(storedCall)).rejects.toThrow(
      "mailbox root unavailable",
    );
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
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
      expectedPolicy: "require_send",
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
        "never stay silent about it",
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
  onResultUpdate?: () => {
    call: HostedPhoneCall;
    count: number;
  };
  onTransaction?: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  resultNotificationChannel?: "linq" | "telegram" | null;
} = {}) {
  const resultNotificationChannel = input.resultNotificationChannel === undefined
    ? "linq"
    : input.resultNotificationChannel;
  let call = input.call
    ?? buildStoredAnalyzedCall({
      resultNotificationChannel,
      ...(resultNotificationChannel === "telegram"
        ? { resultDeliveryStatus: "pending" }
        : {}),
    });
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
      findUnique: vi.fn(async (findInput?: unknown) => {
        void findInput;
        return call;
      }),
      updateMany: vi.fn(async (update: {
        data: Partial<HostedPhoneCall> & { resultJson?: unknown };
      }) => {
        if (update.data.resultEncrypted) {
          if (input.onResultUpdate) {
            const result = input.onResultUpdate();
            call = result.call;
            return { count: result.count };
          }
          if (call.resultEncrypted === null && call.resultJson === null) {
            call = {
              ...call,
              ...update.data,
              resultJson: null,
            };
            return { count: 1 };
          }
          return { count: 0 };
        }
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
    resultNotificationChannel: "linq",
    status: "completed",
    stopRequestedAt: null,
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

function buildRealMailboxPrisma(initialCall: HostedPhoneCall) {
  let call = initialCall;
  let transactionOpen = false;
  const events: string[] = [];
  const now = new Date("2026-08-09T00:05:00.000Z");
  const transactionClient = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("?");
      if (sql.includes("hosted_mailbox_lane_counter")) {
        return [{ seq: 1n }];
      }
      if (!sql.includes("INSERT INTO hosted_mailbox_item")) {
        throw new Error(`Unexpected mailbox query: ${sql}`);
      }
      return [{
        assistantInputLookupKey: values[2] as string | null,
        causalSeq: values[4] as bigint,
        consumedAt: null,
        createdAt: now,
        dedupeKey: String(values[7]),
        expiresAt: values[15] as Date | null,
        id: String(values[0]),
        kind: String(values[8]),
        lane: String(values[5]),
        laneSeq: values[6] as bigint,
        occurredAt: values[9] as Date,
        payloadBytes: values[13] as number,
        payloadHash: String(values[14]),
        payloadInlineCiphertext: values[11] as string | null,
        payloadRef: values[12] as string | null,
        payloadSchema: String(values[10]),
        sourceMessageLookupKey: values[3] as string | null,
        updatedAt: now,
        userId: String(values[1]),
      }];
    }),
    hostedMailboxItem: {
      findUnique: vi.fn(async () => null),
    },
    hostedMailboxPayload: {
      create: vi.fn(async () => undefined),
    },
    hostedPhoneCall: {
      updateMany: vi.fn(async (input: {
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
          call.resultDeliveryGeneration !== input.where.resultDeliveryGeneration
          || call.resultDeliveryStatus !== input.where.resultDeliveryStatus
        ) {
          return { count: 0 };
        }
        call = { ...call, ...input.data };
        return { count: 1 };
      }),
    },
    hostedWorkspace: {
      upsert: vi.fn(async () => undefined),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (
      run: (tx: typeof transactionClient) => Promise<unknown>,
    ) => {
      events.push("transaction:start");
      transactionOpen = true;
      try {
        return await run(transactionClient);
      } finally {
        transactionOpen = false;
        events.push("transaction:end");
      }
    }),
    hostedPhoneCall: {
      findUnique: vi.fn(async () => call),
      updateMany: vi.fn(async () => {
        throw new Error("Stored result must not run the analysis CAS.");
      }),
    },
  };
  return {
    currentCall: () => call,
    events,
    prisma,
    transactionOpen: () => transactionOpen,
  };
}
