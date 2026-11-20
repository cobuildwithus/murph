import { randomUUID } from "node:crypto";
import { buildHostedExecutionTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ covered: vi.fn() }));
vi.mock("@/src/lib/game/service", async original => ({
  ...await original<typeof import("@/src/lib/game/service")>(), canTextGameReminders: async () => true,
}));
vi.mock("@/src/lib/game/evening-check-in", async original => ({
  ...await original<typeof import("@/src/lib/game/evening-check-in")>(), roomCoversEveningGame: m.covered,
}));

import { getPrisma } from "@/src/lib/prisma";
import { appendHostedMailboxEnvelopeTx } from "@/src/lib/hosted-mailbox/store";
import { sealGameText } from "@/src/lib/game/crypto";
import { isPrivateEveningCurrentTx, privateEveningEventId, reserveDuePrivateEveningCheckIns } from "@/src/lib/game/private-notification";
import { runGameCommand } from "@/src/lib/game/service";
import { readPrivatelyTextedGameIds } from "@/src/lib/game/evening-check-in";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Private evening proof needs a loopback test database.");
const db = getPrisma(), now = new Date("2026-11-06T20:00:00Z"), date = "2026-11-06";
const members: string[] = [];

async function member() {
  const prefix = `hbm_game_evening_${randomUUID()}_`, shard = Math.floor(now.getTime() / 60_000) % 5;
  const [candidate] = await db.$queryRaw<Array<{ id: string }>>`SELECT ${prefix} || n::text AS id FROM generate_series(1, 1000) n
    WHERE mod(abs(hashtext(${prefix} || n::text)::bigint), 5) = ${shard} LIMIT 1`;
  const id = candidate!.id;
  members.push(id);
  await db.hostedMember.create({ data: { id } });
  expect(await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName: "Alex", timeZone: "UTC" } })).toMatchObject({ ok: true });
  await db.gameProfile.update({ where: { memberId: id }, data: { reminderMinutes: 1140, reminderText: true } });
  return id;
}

async function game(owner: string, room?: string, peer?: string) {
  const id = `game_${randomUUID().replaceAll("-", "")}`;
  const words = { v: 1, versions: [{ n: 1, defaultTask: "Walk", tasks: [{ seat: 0, text: "Walk" }], stakes: [] }] };
  const encrypted = await sealGameText({ field: "terms_words", memberId: owner, rowId: id, table: "game" }, JSON.stringify(words));
  await db.game.create({ data: { id, createdBy: owner, wordsOwnerMemberId: owner, status: "live", startedAt: new Date("2026-11-06T12:00:00Z"),
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] }, termsWordsEncrypted: encrypted!,
    ...(room ? { chatContainerMemberId: room } : {}),
    players: { create: [{ memberId: owner, seat: 0, timeZone: "UTC", dayOne: new Date("2026-11-06T00:00:00Z"), joinedAt: now },
      ...(peer ? [{ memberId: peer, seat: 1, timeZone: "UTC", dayOne: new Date("2026-11-06T00:00:00Z"), joinedAt: now }] : [])] } } });
  return id;
}
function key(memberId: string, on = date, minutes = 1140) { return createHostedLinqDeliveryIdempotencyLookupKey(privateEveningEventId(memberId, on, minutes))!; }

describe.skipIf(!enabled)("private game evening PostgreSQL", () => {
  beforeEach(() => {
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    m.covered.mockReset().mockResolvedValue(false);
  });
  afterEach(async () => {
    await db.hostedLinqDelivery.deleteMany({ where: { payloadOwnerMemberId: { in: members }, template: "game_private_evening" } });
    await cleanupGameFixtures(db, members);
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    vi.unstubAllEnvs();
  });

  it("reserves one member/date receipt, excludes room-covered games, and invalidates a closed day", async () => {
    const owner = await member(), id = await game(owner);
    m.covered.mockResolvedValueOnce(true);
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(0);
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(1);
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(0);
    const receipt = await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key(owner) } });
    expect(receipt).toMatchObject({ sourceRef: `${owner}:${date}:1140`, template: "game_private_evening", payloadOwnerMemberId: owner });
    const policy = { kind: "game_private_evening_check_in" as const, eventId: privateEveningEventId(owner, date, 1140), memberId: owner, date,
      expiresAt: "2026-11-06T20:30:00.000Z", conversationLaneSeq: "0", batch: [{ gameId: id, termsVersion: 1, dayIndex: 0 }] };
    await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: owner, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy, tx, now))).toBe(false);
  });

  it("texts each game an hour after its own time, with only the games at that time", async () => {
    const owner = await member(), evening = await game(owner), noon = await game(owner);
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: noon, memberId: owner } }, data: { reminderMinutes: 720 } });
    const policy = (eventId: string, expiresAt: string, gameIds: string[]) => ({ kind: "game_private_evening_check_in" as const, eventId, memberId: owner, date,
      expiresAt, conversationLaneSeq: "0", batch: gameIds.map(gameId => ({ gameId, termsVersion: 1, dayIndex: 0 })) });
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(1);
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key(owner) } })).toMatchObject({ sourceRef: `${owner}:${date}:1140` });
    const atSeven = privateEveningEventId(owner, date, 1140);
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy(atSeven, "2026-11-06T20:30:00.000Z", [evening]), tx, now))).toBe(true);
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy(atSeven, "2026-11-06T20:30:00.000Z", [evening, noon].sort()), tx, now))).toBe(false);
    const one = new Date("2026-11-06T13:00:00Z"), atNoon = privateEveningEventId(owner, date, 720);
    expect(await reserveDuePrivateEveningCheckIns(one)).toBe(1);
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key(owner, date, 720) } })).toMatchObject({ sourceRef: `${owner}:${date}:720` });
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy(atNoon, "2026-11-06T13:30:00.000Z", [noon]), tx, one))).toBe(true);
    expect(await reserveDuePrivateEveningCheckIns(one)).toBe(0);
  });

  it("continues private reminders past an unreadable room", async () => {
    const [first, second] = [await member(), await member()].sort();
    const room = await member();
    await game(first!, room);
    await game(second!);
    m.covered.mockImplementation(async (roomId: string | null) => {
      if (roomId === room) throw new Error("Roster unavailable");
      return false;
    });

    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(1);
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key(first!) } })).toBeNull();
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key(second!) } })).toBeTruthy();
  });

  it("names the games that get the private text: no group chat, or players hours apart", async () => {
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "true");
    const owner = await member(), near = await member(), far = await member(), room = await member();
    await db.gameProfile.update({ where: { memberId: far }, data: { timeZone: "Asia/Tokyo" } });
    const alone = await game(owner), together = await game(owner, room, near), apart = await game(owner, room, far);
    expect([...await readPrivatelyTextedGameIds([alone, together, apart], now)].sort()).toEqual([alone, apart].sort());
    vi.stubEnv("MURPH_GAME_EVENING_CHECK_IN_ENABLED", "false");
    expect([...await readPrivatelyTextedGameIds([together], now)]).toEqual([together]);
  });

  it.each(["text", "post"] as const)("pauses after three accepted unanswered texts at any of their times, though dispatch rewrote their receipts, until a %s answers", async answer => {
    const owner = await member(); await game(owner);
    const sent = [["2026-11-03", 1140, "accepted"], ["2026-11-05", 720, "accepted"], ["2026-11-05", 1140, "failed"], ["2026-11-05", 1200, "accepted"]] as const;
    for (const [index, [day, minutes, status]] of sent.entries()) {
      const eventId = privateEveningEventId(owner, day, minutes), at = new Date(`${day}T${String(10 + index).padStart(2, "0")}:00:00Z`);
      await db.hostedMailboxItem.create({ data: { id: `private_evening_wake_${randomUUID()}`, userId: owner, kind: "assistant.notification.requested",
        lane: "notification", laneSeq: BigInt(index + 1), dedupeKey: eventId, occurredAt: at, createdAt: at, payloadSchema: "synthetic-private-evening" } });
      // Dispatch keeps the idempotency key but rewrites the template and source fields.
      await db.hostedLinqDelivery.create({ data: { id: `private_evening_${randomUUID()}`, idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)!,
        source: "hosted_runtime_linq_delivery", sourceRef: "rewritten", template: null, status, targetKind: "thread", payloadOwnerMemberId: owner,
        attemptedAt: at, createdAt: at, ...(status === "accepted" ? { acceptedAt: at } : {}) } });
    }
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(0);
    if (answer === "text") await db.$transaction(tx => appendHostedMailboxEnvelopeTx({ tx, envelope: buildHostedExecutionTelegramConversationMessageWake({
      eventId: `private-evening-reply-${randomUUID()}`, userId: owner, occurredAt: now.toISOString(),
      telegramMessage: { messageId: "2", schema: "murph.hosted-telegram-message.v1", text: "on it", threadId: "123", threadIsDirect: true },
    }) }));
    // A post in another of their games answers the texts; this game is still open tonight.
    else await db.gameEntry.create({ data: { id: `entry_${randomUUID()}`, gameId: await game(owner), memberId: owner, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(1);
  });

  it("ends an unsent receipt once its half hour is over, and stops polling a sent one", async () => {
    const owner = await member(); await game(owner);
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(1);
    const receipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: key(owner) } });
    const { drainGameChatLifecycle } = await import("@/src/lib/game/chat-lifecycle");
    await drainGameChatLifecycle({ now: new Date(now.getTime() + 31 * 60_000) });
    expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id: receipt.id } }))
      .toMatchObject({ status: "skipped", skipReason: "game_private_evening_expired", retryAfterAt: null });
    // Sent work keeps its row and leaves the due sweep.
    await db.hostedLinqDelivery.update({ where: { id: receipt.id }, data: { status: "generation_queued", skippedAt: null, skipReason: null,
      retryAfterAt: new Date(now.getTime() + 31 * 60_000) } });
    await drainGameChatLifecycle({ now: new Date(now.getTime() + 32 * 60_000) });
    expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ status: "generation_queued", retryAfterAt: null });
  });

  it("keeps a private evening current after the member writes", async () => {
    const owner = await member(), id = await game(owner);
    const policy = { kind: "game_private_evening_check_in" as const, eventId: privateEveningEventId(owner, date, 1140), memberId: owner, date,
      expiresAt: "2026-11-06T20:30:00.000Z", conversationLaneSeq: "0", batch: [{ gameId: id, termsVersion: 1, dayIndex: 0 }] };
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy, tx, now))).toBe(true);
    await db.$transaction(tx => appendHostedMailboxEnvelopeTx({ tx, envelope: buildHostedExecutionTelegramConversationMessageWake({
      eventId: `private-evening-conversation-${randomUUID()}`, userId: owner, occurredAt: now.toISOString(),
      telegramMessage: { messageId: "1", schema: "murph.hosted-telegram-message.v1", text: "hello", threadId: "123", threadIsDirect: true },
    }) }));
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy, tx, now))).toBe(true);
  });
});
