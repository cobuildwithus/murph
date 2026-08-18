import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordHostedAiUsageRecords,
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";

const allowanceMocks = vi.hoisted(() => ({
  accountHostedAiUsageForAllowanceTx: vi.fn(),
}));

const routingMocks = vi.hoisted(() => ({
  readHostedLinqHomeLineAuthority: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

const noticeMocks = vi.hoisted(() => ({
  projectHostedAiUsageLimitNoticeForDelivery: vi.fn(),
  sendClaimedHostedAiUsageLimitNoticeToLinqChat: vi.fn(),
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  accountHostedAiUsageForAllowanceTx: allowanceMocks.accountHostedAiUsageForAllowanceTx,
}));

vi.mock("@/src/lib/hosted-execution/usage-limit-notice", () => ({
  sendClaimedHostedAiUsageLimitNoticeToLinqChat:
    noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat,
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread:
    noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread,
}));

vi.mock("@/src/lib/hosted-execution/usage-limit-notice-message", () => ({
  projectHostedAiUsageLimitNoticeForDelivery:
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: routingMocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-home-routing", () => ({
  readHostedLinqHomeLineAuthority: routingMocks.readHostedLinqHomeLineAuthority,
}));

const BASE_USAGE_RECORD = {
  apiKeyEnv: "OPENAI_API_KEY",
  attemptCount: 1,
  baseUrl: "https://api.openai.com/v1",
  cacheWriteTokens: 3,
  cachedInputTokens: 12,
  credentialSource: "platform",
  inputTokens: 120,
  memberId: "member_123",
  occurredAt: "2026-03-29T12:00:00.000Z",
  outputTokens: 45,
  provider: "codex-cli",
  providerMetadataJson: {
    headers: {
      authorization: "redacted-test-header",
    },
    nested: {
      ignored: undefined,
    },
    prompt: "redacted test prompt",
    provider: "openai",
  },
  providerName: "openai",
  providerRequestId: "req_123",
  codexThreadId: "session_123",
  rawUsageJson: {
    input_tokens: 120,
    input_tokens_details: {
      cached_tokens: 12,
    },
    output_tokens: 45,
    output_tokens_details: {
      reasoning_tokens: 8,
    },
    total_tokens: 165,
  },
  rawUsageJsonHash: "sha256:hosted-usage-hash",
  reasoningTokens: 8,
  requestedModel: "gpt-5.6-terra",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.6-terra",
  sessionId: "asst_123",
  stripeMeterSource: "murph",
  totalTokens: 165,
  turnId: "turn_123",
  usageId: "turn_123.attempt-1",
  usageExtractionSourcePath: "params.usage",
  usageExtractionVersion: "codex-usage-v1",
} as const;

describe("recordHostedAiUsageRecords", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:06.000Z"));
    vi.clearAllMocks();
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(null);
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery.mockImplementation(
      async (input: { message: string }) => input.message,
    );
    noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mockResolvedValue(undefined);
    noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread.mockResolvedValue({
      status: "sent",
    });
    routingMocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_home_123",
      linqHomeLineAssignedAt: new Date("2026-03-01T00:00:00.000Z"),
      linqRecipientPhone: "+15555550123",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
    });
    routingMocks.readHostedLinqHomeLineAuthority.mockReturnValue({
      assignedAt: new Date("2026-03-01T00:00:00.000Z"),
      chatId: "chat_home_123",
      kind: "home",
      recipientPhone: "+15555550123",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends the home-route usage-limit notice after accounting reports a crossing", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn(async () => null);
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery.mockResolvedValueOnce(
      "You hit your monthly Murph AI limit.\n\n" +
      "Add usage: https://www.withmurph.ai/settings?addUsage=true#subscription",
    );

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      record: expect.objectContaining({
        usageId: "turn_123.attempt-1",
      }),
      tx: expect.objectContaining({
        hostedAiUsage: expect.objectContaining({
          upsert: hostedAiUsageUpsert,
        }),
      }),
    });
    expect(hostedAiUsageFindUnique).not.toHaveBeenCalled();
    expect(routingMocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .toHaveBeenCalledExactlyOnceWith({
        chatId: "chat_home_123",
        claimToken: {
          periodStart: "2026-03-01T00:00:00.000Z",
          planResetAt: null,
          sentAt: expect.any(String),
          usageCreditLedgerVersion: "0",
        },
        memberId: "member_123",
        message:
          "You hit your monthly Murph AI limit.\n\n" +
          "Add usage: https://www.withmurph.ai/settings?addUsage=true#subscription",
        noticeCode: "edge_usage_limit_reached",
        occurredAt: "2026-03-29T12:00:05.000Z",
        prisma,
        sourceEventId: "turn_123.attempt-1",
      });
    expect(noticeMocks.projectHostedAiUsageLimitNoticeForDelivery)
      .toHaveBeenCalledExactlyOnceWith({
        memberId: "member_123",
        message: "You hit your monthly Murph AI limit.",
        noticeCode: "edge_usage_limit_reached",
        prisma,
      });
  });

  it.each([
    {
      noticeCode: "edge_usage_limit_reached" as const,
      noticeMessage: "You hit your monthly Murph AI limit.",
    },
    {
      noticeCode: "thread_usage_limit_reached" as const,
      noticeMessage: "This thread has reached its Murph AI limit for now.",
    },
  ])("never falls back from explicit-null provenance for $noticeCode", async ({
    noticeCode,
    noticeMessage,
  }) => {
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate({
        noticeCode,
        noticeMessage,
      }),
    );

    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget: null,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(routingMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .not.toHaveBeenCalled();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .not.toHaveBeenCalled();
  });

  it("sends a neutral thread crossing notice to the exact originating Linq route", async () => {
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const noticeDeliveryTarget = {
      channel: "linq" as const,
      replyToMessageId: "linq_message_usage_origin",
      routeAuthority: {
        channel: "linq" as const,
        containerMemberId: "container_member_usage_origin",
        threadId: "linq_thread_usage_origin",
      },
      target: "linq_chat_usage_origin",
    };
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate({
        noticeCode: "thread_usage_limit_reached",
        noticeMessage: "This thread has reached its Murph AI limit for now.",
      }),
    );
    const linkedNotice =
      "Murph is paused in this chat right now.\n"
      + "https://join.example.test/groups/fund/gf1.member_123.signature";
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery.mockResolvedValueOnce(
      linkedNotice,
    );

    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        chatId: noticeDeliveryTarget.target,
        message: linkedNotice,
        noticeCode: "thread_usage_limit_reached",
        replyToMessageId: noticeDeliveryTarget.replyToMessageId,
        routeAuthority: noticeDeliveryTarget.routeAuthority,
      }));
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .not.toHaveBeenCalled();
    expect(routingMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  });

  it.each([
    {
      channel: "linq" as const,
      replyToMessageId: "linq_message_usage_origin",
      routeAuthority: {
        channel: "linq" as const,
        containerMemberId: "container_member_usage_origin",
        threadId: "linq_thread_usage_origin",
      },
      target: "linq_chat_usage_origin",
    },
    {
      channel: "telegram" as const,
      replyToMessageId: "telegram_message_usage_origin",
      target: "telegram_thread_usage_origin",
    },
  ])("never claims a linkless $channel thread crossing notice", async (
    noticeDeliveryTarget,
  ) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate({
        noticeCode: "thread_usage_limit_reached",
        noticeMessage: "This thread has reached its Murph AI limit for now.",
      }),
    );
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery.mockRejectedValueOnce(
      new Error("mandatory recovery URL unavailable"),
    );

    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .not.toHaveBeenCalled();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "Hosted AI usage-limit notice delivery failed.",
      expect.objectContaining({ noticeCode: "thread_usage_limit_reached" }),
    );
    warning.mockRestore();
  });

  it("sends a crossing notice to an originating personal Linq home thread", async () => {
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const noticeDeliveryTarget = {
      channel: "linq" as const,
      replyToMessageId: "linq_message_usage_home",
      routeAuthority: null,
      target: "chat_home_123",
    };
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );

    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(routingMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        chatId: noticeDeliveryTarget.target,
        replyToMessageId: noticeDeliveryTarget.replyToMessageId,
        routeAuthority: null,
      }));
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .not.toHaveBeenCalled();
  });

  it("sends a crossing notice back to the originating Telegram thread", async () => {
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const noticeDeliveryTarget = {
      channel: "telegram" as const,
      replyToMessageId: "telegram_message_usage_origin",
      target: "telegram_thread_usage_origin",
    };
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate({
        noticeCode: "thread_usage_limit_reached",
        noticeMessage: "This thread has reached its Murph AI limit for now.",
      }),
    );
    const linkedNotice =
      "Murph is paused in this chat right now.\n"
      + "https://join.example.test/groups/fund/gf1.member_123.signature";
    noticeMocks.projectHostedAiUsageLimitNoticeForDelivery.mockResolvedValueOnce(
      linkedNotice,
    );
    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToTelegramThread)
      .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        message: linkedNotice,
        noticeCode: "thread_usage_limit_reached",
        replyToMessageId: noticeDeliveryTarget.replyToMessageId,
        target: noticeDeliveryTarget.target,
      }));
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .not.toHaveBeenCalled();
    expect(routingMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  });

  it.each([
    ["inbound reply", "user-message"],
    ["cron automation", "runtime_timer"],
  ])("sends the crossing notice after recording a %s usage row", async (_label, triggerKind) => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        triggerKind,
      }],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        triggerKind,
      }),
    }));
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledOnce();
  });

  it("keeps the compatibility wrapper usable with transaction-compatible clients", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledOnce();
    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledOnce();
  });

  it("keeps the transaction-compatible recorder DB-only when accounting reports a crossing", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );

    await expect(recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledOnce();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("records usage normally when accounting reports no crossing", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledOnce();
  });

  it("rolls back valid usage rows when allowance accounting fails generically", async () => {
    const prisma = makeRollbackAwareUsagePrismaClient();
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).rejects.toThrow("database unavailable");

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.readHostedAiUsageRows()).toEqual([]);
  });

  it("dedupes multiple crossing records in one flush to one notice claim", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx
      .mockResolvedValueOnce(buildUsageLimitNoticeCandidate({
        sourceUsageId: "turn_123.attempt-1",
      }))
      .mockResolvedValueOnce(buildUsageLimitNoticeCandidate({
        sourceUsageId: "turn_123.request-1.attempt-1",
      }));

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 1,
          usageId: "turn_123.request-1.attempt-1",
        },
      ],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1", "turn_123.request-1.attempt-1"],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledTimes(2);
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledOnce();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: "turn_123.attempt-1",
      }),
    );
  });

  it("sends the exhausted notice when prior accounting created no low candidate", async () => {
    const hostedAiUsageUpsert = vi.fn(
      async (args: { create: Record<string, unknown> }) => args.create,
    );
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildUsageLimitNoticeCandidate({
        noticeCode: "thread_usage_limit_reached",
        noticeMessage: "Murph usage is paused for this chat.",
        sourceUsageId: "turn_123.request-1.attempt-1",
      }));

    await recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      noticeDeliveryTarget: {
        channel: "linq",
        replyToMessageId: "linq_message_usage_origin",
        routeAuthority: {
          channel: "linq",
          containerMemberId: "container_member_usage_origin",
          threadId: "linq_thread_usage_origin",
        },
        target: "linq_chat_usage_origin",
      },
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 1,
          usageId: "turn_123.request-1.attempt-1",
        },
      ],
    });

    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat)
      .toHaveBeenCalledTimes(1);
    expect(
      noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat.mock.calls
        .map(([input]) => input.noticeCode),
    ).toEqual(["thread_usage_limit_reached"]);
  });

  it("passes Family-sponsored notice codes through the same crossing send path", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate({
        noticeCode: "family_usage_limit_reached",
        noticeMessage: "family usage limit notice",
      }),
    );

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "family usage limit notice",
        noticeCode: "family_usage_limit_reached",
      }),
    );
  });

  it("attempts durable delivery whenever allowance accounting reports a crossing candidate", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });
    expect(routingMocks.readHostedMemberRoutingState).toHaveBeenCalledOnce();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).toHaveBeenCalledOnce();
  });

  it("skips crossing notices for usage periods that have already ended", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:01.000Z"));
    try {
      const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
      const prisma = makeUsagePrisma(hostedAiUsageUpsert);
      allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
        buildUsageLimitNoticeCandidate({
          periodEnd: new Date("2026-04-01T00:00:00.000Z"),
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
        }),
      );

      await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
        accountAllowance: true,
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      })).resolves.toEqual({
        recordedIds: ["turn_123.attempt-1"],
      });
      expect(routingMocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
      expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the crossing notice when no home Linq route is available", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );
    routingMocks.readHostedLinqHomeLineAuthority.mockReturnValue({
      kind: "none",
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });
    consoleWarnSpy.mockRestore();
    expect(noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat).not.toHaveBeenCalled();
  });

  it("swallows crossing notice send failures without writing a period marker", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(
      buildUsageLimitNoticeCandidate(),
    );
    noticeMocks.sendClaimedHostedAiUsageLimitNoticeToLinqChat
      .mockRejectedValue(new Error("provider unavailable"));

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });
    consoleWarnSpy.mockRestore();
  });

  it("does not account allowance when accounting is disabled", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).not.toHaveBeenCalled();
  });

  it("persists explicit token pricing basis and accounts the normalized record", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        tokenPricingBasis: "openai-flex",
      }],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        tokenPricingBasis: "openai-flex",
      }),
    }));
    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      record: expect.objectContaining({
        tokenPricingBasis: "openai-flex",
      }),
      tx: prisma,
    });
  });

  it("persists sanitized usage metadata without provider debug fields", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        id: "turn_123.attempt-1",
        memberId: "member_123",
        providerRequestId: "req_123",
        providerRequestOutcome: "succeeded",
        providerRequestOrdinal: 0,
        rawUsageJson: {
          input_tokens: 120,
          input_tokens_details: {
            cached_tokens: 12,
          },
          output_tokens: 45,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          total_tokens: 165,
        },
        rawUsageJsonHash: "sha256:hosted-usage-hash",
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
        tokenPricingBasis: "standard",
        totalTokens: 165,
        usageExtractionSourcePath: "params.usage",
        usageExtractionVersion: "codex-usage-v1",
      }),
      select: expect.any(Object),
      update: {
        id: "turn_123.attempt-1",
      },
    });
    const upsertCall = hostedAiUsageUpsert.mock.calls[0]?.[0] as { create?: Record<string, unknown> } | undefined;
    expect(upsertCall?.create).toBeDefined();
    expect(upsertCall?.create).not.toHaveProperty("codexThreadId");
    expect(upsertCall?.create).not.toHaveProperty("providerMetadataJson");
    expect(JSON.stringify(upsertCall?.create?.rawUsageJson)).not.toContain("prompt");
    expect(JSON.stringify(upsertCall?.create?.rawUsageJson)).not.toContain("authorization");
    expect(prisma.hostedAiUsage.updateMany).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
        stripeMeterSource: "murph",
        stripeMeterStatus: {
          in: ["pending", "processing"],
        },
      },
      data: {
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterNextAttemptAt: null,
        stripeMeterStatus: "skipped",
      },
    });
  });

  it("does not read billing refs while recording local usage", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run while recording local usage");
    });
    const prisma = makeUsagePrisma(hostedAiUsageUpsert, findUnique);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
      }),
    }));
  });

  it("persists failed provider request outcomes for hosted usage imports", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            providerRequestOutcome: "failed",
          },
        ],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        providerRequestOutcome: "failed",
      }),
    }));
  });

  it("persists validated v1/v2 turn profiles and drops invalid v2 profiles", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const v1TurnProfileJson = {
      modelContextWindow: 258400,
      requestCount: 1,
      requests: [{ cachedInput: 12, input: 120, output: 45 }],
      requestsTruncated: false,
      schema: "murph.assistant-turn-profile.v1",
      tools: [
        { calls: 1, durationMs: 420, label: "vault-cli samples query", outputChars: 2048 },
      ],
      toolsTruncated: false,
    };
    const v2TurnProfileJson = {
      modelContextWindow: null,
      requestCount: 0,
      requests: [],
      requestsTruncated: false,
      schema: "murph.assistant-turn-profile.v2",
      tools: [
        {
          calls: 2,
          durationKnownCalls: 1,
          durationMs: 420,
          failedCalls: 1,
          kind: "command",
          label: "vault-cli memory show",
          outputBytesMax: 8,
          outputBytesTotal: 12,
        },
      ],
      toolsTruncated: false,
    };

    const v1Result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{ ...BASE_USAGE_RECORD, turnProfileJson: v1TurnProfileJson }],
    });

    expect(v1Result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: expect.objectContaining({
        turnProfileJson: v1TurnProfileJson,
      }),
    }));

    const v2Result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        turnId: "turn_124",
        turnProfileJson: v2TurnProfileJson,
        usageId: "turn_124.attempt-1",
      }],
    });

    expect(v2Result.recordedIds).toEqual(["turn_124.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: expect.objectContaining({
        turnProfileJson: v2TurnProfileJson,
      }),
    }));

    // Out-of-contract profiles must not reject the row: the usage record is
    // still persisted for billing, just without the telemetry payload.
    const droppedUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const droppedPrisma = makeUsagePrisma(droppedUpsert);

    const droppedResult = await recordHostedAiUsageRecords({
      prisma: droppedPrisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        turnProfileJson: {
          ...v2TurnProfileJson,
          tools: [
            {
              ...v2TurnProfileJson.tools[0],
              outputBytesMax: 13,
            },
          ],
        },
      }],
    });

    expect(droppedResult.recordedIds).toEqual(["turn_123.attempt-1"]);
    const droppedCreate = droppedUpsert.mock.calls[0]?.[0]?.create as
      | Record<string, unknown>
      | undefined;
    expect(droppedCreate).toBeDefined();
    expect(droppedCreate?.turnProfileJson).toBeUndefined();
    expect(droppedCreate?.inputTokens).toBe(120);
  });

  it("dedupes identical usage rows by usageId before persisting them", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD, BASE_USAGE_RECORD],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(1);
  });

  it("dedupes omitted and explicit first provider request ordinals", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 0,
        },
      ],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(1);
  });

  it("persists continuation provider requests as separate usage rows", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const continuationUsage = {
      ...BASE_USAGE_RECORD,
      providerRequestOrdinal: 1,
      usageId: "turn_123.request-1.attempt-1",
    };

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD, continuationUsage],
    });

    expect(result.recordedIds).toEqual([
      "turn_123.attempt-1",
      "turn_123.request-1.attempt-1",
    ]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(2);
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        providerRequestOrdinal: 0,
      }),
    }));
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: "turn_123.request-1.attempt-1",
      },
      create: expect.objectContaining({
        providerRequestOrdinal: 1,
      }),
    }));
  });

  it("rejects conflicting duplicate usage ids in one import batch", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => args.create),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          BASE_USAGE_RECORD,
          {
            ...BASE_USAGE_RECORD,
            totalTokens: 166,
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains conflicting records for one usage id.",
    );
  });

  it("rejects non-canonical usage ids before any hosted usage row is persisted", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            usageId: "turn_123.unexpected-1",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains an invalid usage record.",
    );

    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
  });

  it("rejects an existing usage row when immutable fields do not match", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        totalTokens: 999,
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: totalTokens.",
    );
  });

  it("rejects an existing usage row when the stored provider request ordinal differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        providerRequestOrdinal: 1,
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: providerRequestOrdinal.",
    );
  });

  it("accepts an existing usage row when raw usage JSON only differs by key order", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        rawUsageJson: {
          total_tokens: 165,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          output_tokens: 45,
          input_tokens_details: {
            cached_tokens: 12,
          },
          input_tokens: 120,
        },
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });
  });

  it("rejects an existing usage row when raw usage JSON values differ", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        rawUsageJson: {
          input_tokens: 121,
          input_tokens_details: {
            cached_tokens: 12,
          },
          output_tokens: 45,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          total_tokens: 166,
        },
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: rawUsageJson.",
    );
  });

  it("rejects an existing usage row when the stored Stripe meter source differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        stripeMeterSource: "external-meter",
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: stripeMeterSource.",
    );
  });

  it("rejects an existing usage row when the stored token pricing basis differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        tokenPricingBasis: "standard",
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [{
          ...BASE_USAGE_RECORD,
          tokenPricingBasis: "openai-flex",
        }],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: tokenPricingBasis.",
    );
  });

  it("rejects usage rows whose memberId does not match the trusted hosted execution user", async () => {
    const prisma = makeUsagePrisma(vi.fn(async () => ({})));

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            attemptCount: 1,
            credentialSource: "platform",
            memberId: "member_other",
            occurredAt: "2026-03-29T12:00:00.000Z",
            provider: "codex-cli",
            routeId: "primary",
            schema: "murph.assistant-usage.v1",
            sessionId: "asst_123",
            totalTokens: 165,
            turnId: "turn_123",
            usageId: "turn_123.attempt-1",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage memberId does not match the authenticated hosted execution user.",
    );
  });

  it("rejects unsupported meter source payloads", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run for usage imports");
    });
    const prisma = makeUsagePrisma(hostedAiUsageUpsert, findUnique);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            stripeMeterSource: "external-meter",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains an invalid usage record.",
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
  });
});

function makeUsagePrisma(
  upsert: ReturnType<typeof vi.fn>,
  findUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
  hostedAiUsageFindUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
) {
  return {
    hostedAiUsage: {
      findUnique: hostedAiUsageFindUnique,
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert,
    },
    hostedMemberBillingRef: {
      findUnique,
    },
  };
}

function makeUsagePrismaClient(
  upsert: ReturnType<typeof vi.fn>,
  findUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
  hostedAiUsageFindUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
) {
  const tx = makeUsagePrisma(upsert, findUnique, hostedAiUsageFindUnique);
  return {
    ...tx,
    $transaction: vi.fn(async <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx)),
  };
}

function makeRollbackAwareUsagePrismaClient() {
  type HostedAiUsageRow = Record<string, unknown>;
  type HostedAiUsageUpdateManyArgs = {
    data?: HostedAiUsageRow;
    where?: {
      id?: string;
    };
  };
  type HostedAiUsageUpsertArgs = {
    create: HostedAiUsageRow;
    where: {
      id: string;
    };
  };

  let rows = new Map<string, HostedAiUsageRow>();

  const createTx = (workingRows: Map<string, HostedAiUsageRow>) => ({
    hostedAiUsage: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async (args: HostedAiUsageUpdateManyArgs) => {
        const id = args.where?.id;
        const row = id ? workingRows.get(id) : null;
        if (!row) {
          return { count: 0 };
        }

        if (args.data) {
          Object.assign(row, args.data);
        }
        return { count: 1 };
      }),
      upsert: vi.fn(async (args: HostedAiUsageUpsertArgs) => {
        const existing = workingRows.get(args.where.id);
        if (existing) {
          return existing;
        }

        const row = {
          allowanceAccountedAt: null,
          allowanceCostUsdMicros: null,
          allowanceCounted: null,
          ...args.create,
          rawUsageJson: args.create.rawUsageJson ?? null,
          turnProfileJson: args.create.turnProfileJson ?? null,
        };
        workingRows.set(args.where.id, row);
        return row;
      }),
    },
    hostedMemberBillingRef: {
      findUnique: vi.fn(async () => null),
    },
  });

  type RollbackAwareUsageTx = ReturnType<typeof createTx>;

  return {
    $transaction: vi.fn(async <T>(run: (transaction: RollbackAwareUsageTx) => Promise<T>) => {
      const workingRows = new Map(
        [...rows].map(([id, row]) => [id, { ...row }] as const),
      );
      const result = await run(createTx(workingRows));
      rows = workingRows;
      return result;
    }),
    readHostedAiUsageRows: () => [...rows.values()],
  };
}

function buildUsageLimitNoticeCandidate(overrides: Partial<{
  memberId: string;
  noticeCode: string;
  noticeMessage: string;
  periodEnd: Date;
  periodStart: Date;
  sourceUsageId: string;
  usageCreditLedgerVersion: bigint;
}> = {}) {
  return {
    crossedAt: new Date("2026-03-29T12:00:05.000Z"),
    memberId: overrides.memberId ?? "member_123",
    periodEnd: overrides.periodEnd ?? new Date("2026-04-01T00:00:00.000Z"),
    periodStart: overrides.periodStart ?? new Date("2026-03-01T00:00:00.000Z"),
    sourceUsageId: overrides.sourceUsageId ?? "turn_123.attempt-1",
    usageCreditLedgerVersion: overrides.usageCreditLedgerVersion ?? 0n,
    userNotice: {
      code: overrides.noticeCode ?? "edge_usage_limit_reached",
      message: overrides.noticeMessage ?? "You hit your monthly Murph AI limit.",
    },
  };
}
