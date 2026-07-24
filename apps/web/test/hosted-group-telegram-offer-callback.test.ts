import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  createHostedTelegramMessageLookupKey,
  createHostedTelegramMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  acceptHostedGroupOfferAffirmation: vi.fn(),
  answerHostedTelegramCallbackQueryBestEffort: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-offer-affirmation", () => ({
  acceptHostedGroupOfferAffirmation: mocks.acceptHostedGroupOfferAffirmation,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  resolveHostedMemberRoutingByTelegramUserId:
    mocks.resolveHostedMemberRoutingByTelegramUserId,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/telegram-client")
  >("@/src/lib/hosted-onboarding/telegram-client");
  return {
    ...actual,
    answerHostedTelegramCallbackQueryBestEffort:
      mocks.answerHostedTelegramCallbackQueryBestEffort,
  };
});

const { handleHostedTelegramGroupOfferCallback } = await import(
  "@/src/lib/hosted-groups/telegram-offer-callback"
);
const {
  HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA,
  HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA,
} = await import("@/src/lib/hosted-onboarding/telegram-client");

const prisma = {} as PrismaClient;

function buildCallbackQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: HOSTED_TELEGRAM_GROUP_JOIN_CALLBACK_DATA,
    from: { id: 4242, is_bot: false },
    id: "cbq_1",
    message: { chat: { id: -100777, type: "supergroup" }, message_id: 55 },
    ...overrides,
  } as Parameters<typeof handleHostedTelegramGroupOfferCallback>[0]["callbackQuery"];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
    lookup: { core: { id: "usr_1", suspendedAt: null } },
    status: "found",
  });
  mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
  mocks.acceptHostedGroupOfferAffirmation.mockResolvedValue({
    kind: "join",
    status: "accepted",
  });
});

describe("hosted telegram group offer callback", () => {
  it("binds the tap to the exact chat and message the button was attached to", async () => {
    const result = await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery(),
      prisma,
    });

    expect(result).toEqual({ handled: true, reason: "accepted-telegram-group-join" });
    const call = mocks.acceptHostedGroupOfferAffirmation.mock.calls[0]?.[0];
    expect(call.channel).toBe("telegram");
    expect(call.kinds).toEqual(["join"]);
    expect(call.memberId).toBe("usr_1");
    expect(call.messageLookupKeyReadCandidates).toEqual(
      createHostedTelegramMessageLookupKeyReadCandidates({
        chatId: "-100777",
        messageId: "55",
      }),
    );
  });

  it("keeps a permission button from ever accepting a join offer", async () => {
    mocks.acceptHostedGroupOfferAffirmation.mockResolvedValue({
      kind: "disclosure",
      status: "accepted",
    });

    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery({
        data: HOSTED_TELEGRAM_GROUP_DISCLOSURE_CALLBACK_DATA,
      }),
      prisma,
    });

    expect(mocks.acceptHostedGroupOfferAffirmation.mock.calls[0]?.[0].kinds).toEqual([
      "disclosure",
    ]);
  });

  it("gives a genuinely new tap a new affirmation id so a revoked grant can be restored", async () => {
    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery({ id: "cbq_first" }),
      prisma,
    });
    const first = mocks.acceptHostedGroupOfferAffirmation.mock.calls[0]?.[0]
      .affirmationEventId;

    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery({ id: "cbq_second" }),
      prisma,
    });
    const second = mocks.acceptHostedGroupOfferAffirmation.mock.calls[1]?.[0]
      .affirmationEventId;

    expect(first).not.toBe(second);
  });

  it("keeps one redelivered callback idempotent", async () => {
    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery({ id: "cbq_same" }),
      prisma,
    });
    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery({ id: "cbq_same" }),
      prisma,
    });

    expect(
      mocks.acceptHostedGroupOfferAffirmation.mock.calls[0]?.[0].affirmationEventId,
    ).toBe(
      mocks.acceptHostedGroupOfferAffirmation.mock.calls[1]?.[0].affirmationEventId,
    );
  });

  it.each([
    ["an inline-mode callback with no chat message", { message: undefined }, "callback-without-chat-message"],
    ["a bot actor", { from: { id: 99, is_bot: true } }, "bot-actor"],
    ["unrecognized callback data", { data: "murph:group:something-else" }, "unsupported-callback-data"],
  ])("never grants for %s", async (_label, overrides, expectedReason) => {
    const result = await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery(overrides),
      prisma,
    });

    expect(result).toEqual({ handled: false, reason: expectedReason });
    expect(mocks.acceptHostedGroupOfferAffirmation).not.toHaveBeenCalled();
  });

  it("never grants when the telegram identity is ambiguous", async () => {
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      status: "ambiguous",
    });

    const result = await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery(),
      prisma,
    });

    expect(result).toEqual({ handled: false, reason: "ambiguous-telegram-binding" });
    expect(mocks.acceptHostedGroupOfferAffirmation).not.toHaveBeenCalled();
  });

  it("never grants for a suspended or inactive member", async () => {
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: "usr_1", suspendedAt: new Date("2026-07-01T00:00:00.000Z") } },
      status: "found",
    });
    expect(
      await handleHostedTelegramGroupOfferCallback({
        callbackQuery: buildCallbackQuery(),
        prisma,
      }),
    ).toEqual({ handled: false, reason: "suspended-member" });

    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: "usr_1", suspendedAt: null } },
      status: "found",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
    expect(
      await handleHostedTelegramGroupOfferCallback({
        callbackQuery: buildCallbackQuery(),
        prisma,
      }),
    ).toEqual({ handled: false, reason: "inactive-member" });

    expect(mocks.acceptHostedGroupOfferAffirmation).not.toHaveBeenCalled();
  });

  it("always answers the callback so the client spinner stops", async () => {
    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery(),
      prisma,
    });
    expect(mocks.answerHostedTelegramCallbackQueryBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ callbackQueryId: "cbq_1", text: "You're in." }),
    );

    vi.clearAllMocks();
    mocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: { core: { id: "usr_1", suspendedAt: null } },
      status: "found",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.acceptHostedGroupOfferAffirmation.mockResolvedValue({
      reason: "no_offer_match",
      status: "ignored",
    });
    await handleHostedTelegramGroupOfferCallback({
      callbackQuery: buildCallbackQuery(),
      prisma,
    });
    expect(mocks.answerHostedTelegramCallbackQueryBestEffort).toHaveBeenCalledTimes(1);
  });
});

describe("hosted telegram message lookup key", () => {
  it("separates the same message id across different chats", () => {
    expect(
      createHostedTelegramMessageLookupKey({ chatId: "-100777", messageId: "55" }),
    ).not.toBe(
      createHostedTelegramMessageLookupKey({ chatId: "-100888", messageId: "55" }),
    );
  });

  it("requires both the chat and the message", () => {
    expect(
      createHostedTelegramMessageLookupKey({ chatId: null, messageId: "55" }),
    ).toBeNull();
    expect(
      createHostedTelegramMessageLookupKey({ chatId: "-100777", messageId: null }),
    ).toBeNull();
  });
});
