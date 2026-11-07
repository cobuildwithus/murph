import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHostedLinqChatLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  maybeScheduleHostedLinqAckReaction,
  runHostedLinqAckReactionBestEffort,
} from "@/src/lib/hosted-onboarding/linq-ack-reaction";
import { isHostedLinqAckReactionCoveringCurrentBurst } from "@/src/lib/hosted-onboarding/linq-ack-reaction-store";
import type { HostedLinqMessageReceivedEvent } from "@/src/lib/hosted-onboarding/linq-webhook";
import { createPrismaClient } from "@/src/lib/prisma";

/**
 * Opt-in end-to-end check of the tapback path against the real Decisions API
 * and a local PostgreSQL database, with only the Linq send stubbed. Run:
 *   MURPH_RUN_REAL_LINQ_ACK_REACTION_EVAL=1 OPENAI_API_KEY=… DATABASE_URL=<local> \
 *     pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-ack-reaction-live.test.ts
 * Set MURPH_ACK_LIVE_METRICS_FILE to a path to keep the latency numbers.
 */
const RUN_LIVE = process.env.MURPH_RUN_REAL_LINQ_ACK_REACTION_EVAL === "1";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const PUBLIC_FOOD_PHOTO = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=640";

if (RUN_LIVE && (!apiKey || !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl))) {
  throw new Error("The live ack-reaction check needs OPENAI_API_KEY and a local DATABASE_URL.");
}

const metrics: string[] = [];
function report(line: string): void {
  metrics.push(line);
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

describe.skipIf(!RUN_LIVE)("hosted Linq ack reaction, live", () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
  const saved = { ...process.env };

  beforeAll(() => {
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = `v1:${Buffer.from("c".repeat(32), "utf8").toString("base64")}`;
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
    process.env.HOSTED_LINQ_ACK_REACTIONS = "on";
    delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
  });

  afterAll(async () => {
    for (const name of ["HOSTED_CONTACT_PRIVACY_KEYS", "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "HOSTED_LINQ_ACK_REACTIONS"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
    await prisma.$disconnect();
    const metricsFile = process.env.MURPH_ACK_LIVE_METRICS_FILE?.trim();
    if (metricsFile) writeFileSync(metricsFile, `${metrics.join("\n")}\n`);
  });

  function event(chatId: string, messageId: string, text: string, imageUrl?: string): HostedLinqMessageReceivedEvent {
    return {
      api_version: "v3",
      created_at: new Date().toISOString(),
      data: {
        chat: { id: chatId, is_group: false },
        chat_id: chatId,
        from: "+15555550100",
        is_from_me: false,
        message: {
          id: messageId,
          parts: [
            ...(imageUrl ? [{ mime_type: "image/jpeg", type: "media" as const, url: imageUrl }] : []),
            { type: "text" as const, value: text },
          ],
        },
        service: "iMessage",
      },
      event_id: `evt-${messageId}`,
      event_type: "message.received",
    } as HostedLinqMessageReceivedEvent;
  }

  /** Simulates one inbound: receipt, then the scheduled task, timing receipt→tapback. */
  async function inbound(chatId: string, text: string, imageUrl?: string) {
    const messageId = `msg-${randomUUID()}`;
    const receivedAt = new Date();
    const reactions: Array<{ emoji: string; ms: number }> = [];
    await runHostedLinqAckReactionBestEffort({
      addReaction: async ({ emoji }) => {
        reactions.push({ emoji, ms: Date.now() - receivedAt.getTime() });
        return { ok: true, status: 204 };
      },
      apiKey,
      event: event(chatId, messageId, text, imageUrl),
      linqChatId: chatId,
      messageId,
      messageReceivedAt: receivedAt,
      prisma,
    });
    return reactions;
  }

  it("reacts to ordinary requests within about a second of receipt", async () => {
    const requests = [
      ["remind me to take my meds at 9", "⏰"],
      ["how did i sleep last night", "👀"],
      ["what's my resting heart rate been this week", "👀"],
      ["can you find a good high protein breakfast at starbucks", "🔎"],
      ["make me a 4 week half marathon plan", "📝"],
      ["add a gym session to my calendar tomorrow at 7am", "📅"],
      ["make me a song about leg day", "🎶"],
      ["draw me as a superhero lifting weights", "🎨"],
      ["remind me to stretch before bed", "⏰"],
      ["what were my steps yesterday", "👀"],
      ["change my step goal to 9k", "👍"],
    ] as const;
    const results = await Promise.all(requests.map(([text]) => inbound(`live-${randomUUID()}`, text)));
    results.forEach((reactions, index) => {
      expect(reactions.map((reaction) => reaction.emoji), requests[index]![0]).toEqual([requests[index]![1]]);
    });
    const latencies = results.map((reactions) => reactions[0]!.ms);
    report(`receipt→tapback ms: p50 ${percentile(latencies, 0.5)} p90 ${percentile(latencies, 0.9)} max ${Math.max(...latencies)}`);
    expect(percentile(latencies, 0.5)).toBeLessThan(1_000);
    expect(Math.max(...latencies)).toBeLessThan(4_000);
  }, 30_000);

  it("reads a remote photo URL and still reacts quickly", async () => {
    const reactions = await inbound(`live-${randomUUID()}`, "how many cals is this", PUBLIC_FOOD_PHOTO);
    report(`remote photo receipt→tapback ms: ${reactions[0]?.ms ?? "none"}`);
    expect(reactions.map((reaction) => reaction.emoji)).toEqual(["👀"]);
    expect(reactions[0]!.ms).toBeLessThan(4_000);
  }, 30_000);

  it("stays quiet for logs, chat, and heavy news", async () => {
    for (const text of ["just had 2 eggs and toast", "lol thanks", "my dad passed away this morning"]) {
      expect(await inbound(`live-${randomUUID()}`, text), text).toEqual([]);
    }
  }, 30_000);

  it("gives a three-message burst exactly one tapback, and a heavy burst none", async () => {
    const chat = `live-${randomUUID()}`;
    const burst = await Promise.all([
      inbound(chat, "remind me to drink water at 3"),
      inbound(chat, "also how did i sleep"),
      inbound(chat, "and find me a protein bar under 200 cals"),
    ]);
    expect(burst.flat()).toHaveLength(1);

    const heavyChat = `live-${randomUUID()}`;
    expect(await inbound(heavyChat, "i just got diagnosed with cancer")).toEqual([]);
    expect(await inbound(heavyChat, "can you remind me about my appointment friday")).toEqual([]);
  }, 30_000);

  it("skips the tapback once Murph has answered, and covers progress after one", async () => {
    const answered = `live-${randomUUID()}`;
    const messageId = `msg-${randomUUID()}`;
    const receivedAt = new Date();
    await prisma.hostedLinqDelivery.create({
      data: {
        attemptedAt: new Date(receivedAt.getTime() + 5),
        id: `live-${randomUUID()}`,
        linqChatLookupKey: createHostedLinqChatLookupKey(answered),
        source: "ack_reaction_live",
      },
    });
    let sent = 0;
    await runHostedLinqAckReactionBestEffort({
      addReaction: async () => { sent += 1; return { ok: true, status: 204 }; },
      apiKey,
      event: event(answered, messageId, "remind me to call mom at 6"),
      linqChatId: answered,
      messageId,
      messageReceivedAt: receivedAt,
      prisma,
    });
    expect(sent).toBe(0);

    const reacted = `live-${randomUUID()}`;
    expect(await inbound(reacted, "remind me to call mom at 6")).toHaveLength(1);
    expect(await prisma.$transaction((tx) => isHostedLinqAckReactionCoveringCurrentBurst({ linqChatId: reacted, prisma: tx })))
      .toBe(true);
  }, 30_000);

  it("adds microseconds, not milliseconds, to the webhook path", () => {
    const tasks: Array<() => Promise<void>> = [];
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      maybeScheduleHostedLinqAckReaction({
        currentInboundReply: { chatId: "chat-1", messageId: "msg-1" },
        event: event("chat-1", "msg-1", "remind me at 9"),
        instantFirstTurnOwnsReply: false,
        prisma,
        response: { reason: "wake-appended-active-member" },
        scheduleAfterResponse: (task) => { tasks.push(task); },
        wakeHandoff: { conversationIsGroup: false, linqChatId: "chat-1" },
        wakeHandoffResult: { started: true },
        webhookReceivedAt: new Date(),
      });
    }
    const perCallMs = (performance.now() - startedAt) / 1_000;
    report(`schedule cost per webhook: ${(perCallMs * 1_000).toFixed(1)}µs`);
    expect(tasks).toHaveLength(1_000);
    expect(perCallMs).toBeLessThan(0.5);
  });
});
