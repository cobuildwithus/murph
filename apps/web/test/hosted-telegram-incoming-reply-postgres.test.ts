import { randomInt, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createHostedLinqDeliverySourceRefLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate, summarizeHostedTelegramWebhook } from "@/src/lib/hosted-onboarding/telegram";
import { withHostedVisibleSecondaryTelegramOutcomes, type HostedOnboardingTelegramWebhookHandler } from "@/src/lib/hosted-onboarding/visible-secondary-webhooks";
import { createPrismaClient } from "@/src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Telegram reply proof requires an explicitly selected local test database.");
  }
}
async function withFixture(run: (f: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const f = await seed();
  try { await run(f); } finally {
    vi.useRealTimers();
    await f.prisma.hostedLinqDelivery.deleteMany({ where: { sourceRef: { in: f.sourceRefs } } });
    await f.prisma.$disconnect();
  }
}
async function seed() {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
  const sourceRefs: string[] = [];
  const updateId = randomInt(1, 1_000_000_000);
  const send = vi.fn<typeof import("@/src/lib/hosted-onboarding/telegram-client").sendHostedTelegramTextMessage>().mockResolvedValue(undefined);
  const handler: HostedOnboardingTelegramWebhookHandler = async () => ({ ignored: true, ok: true, reason: "unlinked-telegram" });
  const wrapped = withHostedVisibleSecondaryTelegramOutcomes(handler, {
    getPrisma: () => prisma, parseHostedTelegramWebhookUpdate, summarizeHostedTelegramWebhook,
    requireHostedOnboardingPublicBaseUrl: () => "https://www.withmurph.ai", sendHostedTelegramTextMessage: send,
  });
  const call = (id = updateId, group = false) => {
    const update = { update_id: id, message: { message_id: 11, date: 1_785_000_000,
      chat: { id: group ? -42 : 42, type: group ? "group" : "private" },
      from: { first_name: "Synthetic", id: 42, is_bot: false }, text: "Hello" } };
    sourceRefs.push(createHostedLinqDeliverySourceRefLookupKey(buildHostedTelegramWebhookEventId(parseHostedTelegramWebhookUpdate(JSON.stringify(update))))!);
    return wrapped({ prisma, rawBody: JSON.stringify(update), secretToken: `synthetic-${randomUUID()}` });
  };
  return { prisma, sourceRefs, send, call, updateId };
}
describe.skipIf(!enabled)("Telegram incoming reply with PostgreSQL and no member binding", () => {
  it("B4: duplicate update after success sends once", async () => withFixture(async (f) => {
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(f.send).toHaveBeenCalledTimes(1);
  }));
  it("a lost response is terminal and replay sends nothing more", async () => withFixture(async (f) => {
    f.send.mockRejectedValueOnce(new Error("Synthetic network error"));
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(f.send).toHaveBeenCalledTimes(1);
  }));
  it("overlap sends once and gives the loser a retry time", async () => withFixture(async (f) => {
    const entered = deferred(); const release = deferred();
    f.send.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const first = f.call();
    try {
      await Promise.race([entered.promise, first]);
      await expect(f.call()).rejects.toMatchObject({ code: "HOSTED_TELEGRAM_VISIBLE_SECONDARY_RETRY", httpStatus: 503, retryable: true, details: { retryAt: expect.any(String) } });
      expect(f.send).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); await first; }
  }));
  it("429 waits for retryAt and then permits one new send", async () => withFixture(async (f) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    f.send.mockRejectedValueOnce(rejection(429));
    await expect(f.call()).rejects.toMatchObject({ code: "HOSTED_TELEGRAM_VISIBLE_SECONDARY_RETRY", retryable: true });
    await expect(f.call()).rejects.toMatchObject({ code: "HOSTED_TELEGRAM_VISIBLE_SECONDARY_RETRY", retryable: true });
    expect(f.send).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + 31_000));
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(await f.call()).toMatchObject({ ignored: false });
    expect(f.send).toHaveBeenCalledTimes(2);
  }));
  it("permanent 403 finishes the inbound and replay does not send", async () => withFixture(async (f) => {
    f.send.mockRejectedValueOnce(rejection(403));
    expect(await f.call()).toEqual({ ignored: true, ok: true, reason: "unlinked-telegram" });
    expect(await f.call()).toEqual({ ignored: true, ok: true, reason: "unlinked-telegram" });
    expect(f.send).toHaveBeenCalledTimes(1);
  }));
  it("a different update id sends a different reply", async () => withFixture(async (f) => {
    await f.call(); await f.call(f.updateId + 1);
    expect(f.send).toHaveBeenCalledTimes(2);
  }));
  it("preserves the incoming group target and reply anchor without a member", async () => withFixture(async (f) => {
    await f.call(f.updateId, true); await f.call(f.updateId, true);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ target: { chatId: "-42", businessConnectionId: null, directMessagesTopicId: null, messageThreadId: null }, replyToMessageId: 11 }));
  }));
});

function rejection(status: number) {
  return hostedOnboardingError({ code: "HOSTED_TELEGRAM_API_RESPONSE_REJECTED", httpStatus: status,
    details: { status, retryAfterSeconds: 30 }, message: "Synthetic Telegram rejection", retryable: status === 429 });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
