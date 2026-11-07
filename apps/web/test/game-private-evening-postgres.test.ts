import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ covered: vi.fn() }));
vi.mock("@/src/lib/game/service", async original => ({
  ...await original<typeof import("@/src/lib/game/service")>(), canTextGameReminders: async () => true,
}));
vi.mock("@/src/lib/game/evening-check-in", async original => ({
  ...await original<typeof import("@/src/lib/game/evening-check-in")>(), roomCoversEveningGame: m.covered,
}));

import { getPrisma } from "@/src/lib/prisma";
import { sealGameText } from "@/src/lib/game/crypto";
import { isPrivateEveningCurrentTx, privateEveningEventId, reserveDuePrivateEveningCheckIns } from "@/src/lib/game/private-notification";
import { runGameCommand } from "@/src/lib/game/service";
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

async function game(owner: string) {
  const id = `game_${randomUUID().replaceAll("-", "")}`;
  const words = { v: 1, versions: [{ n: 1, defaultTask: "Walk", tasks: [{ seat: 0, text: "Walk" }], stakes: [] }] };
  const encrypted = await sealGameText({ field: "terms_words", memberId: owner, rowId: id, table: "game" }, JSON.stringify(words));
  await db.game.create({ data: { id, createdBy: owner, wordsOwnerMemberId: owner, status: "live", startedAt: new Date("2026-11-06T12:00:00Z"),
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] }, termsWordsEncrypted: encrypted!,
    players: { create: [{ memberId: owner, seat: 0, timeZone: "UTC", dayOne: new Date("2026-11-06T00:00:00Z"), joinedAt: now }] } } });
  return id;
}
function key(memberId: string, on = date) { return createHostedLinqDeliveryIdempotencyLookupKey(privateEveningEventId(memberId, on))!; }

describe.skipIf(!enabled)("private game evening PostgreSQL", () => {
  beforeEach(() => {
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
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
    expect(receipt).toMatchObject({ sourceRef: `${owner}:${date}`, template: "game_private_evening", payloadOwnerMemberId: owner });
    const policy = { kind: "game_private_evening_check_in" as const, eventId: privateEveningEventId(owner, date), memberId: owner, date,
      expiresAt: "2026-11-06T20:30:00.000Z", conversationLaneSeq: "0", batch: [{ gameId: id, termsVersion: 1, dayIndex: 0 }] };
    await db.gameEntry.create({ data: { id: randomUUID(), gameId: id, memberId: owner, dayIndex: 0, attempt: 1, kind: "words", receivedAt: now } });
    expect(await db.$transaction(tx => isPrivateEveningCurrentTx(policy, tx, now))).toBe(false);
  });

  it("pauses after three accepted unanswered evenings", async () => {
    const owner = await member(); await game(owner);
    for (const [index, day] of ["2026-11-03", "2026-11-04", "2026-11-05"].entries()) {
      const idempotencyKey = key(owner, day);
      await db.hostedLinqDelivery.create({ data: { id: `private_evening_${randomUUID()}`, idempotencyKey, source: "game_lifecycle",
        sourceRef: `${owner}:${day}`, template: "game_private_evening", status: "sent", targetKind: "thread",
        payloadOwnerMemberId: owner, attemptedAt: new Date(`2026-11-0${index + 3}T20:00:00Z`),
        acceptedAt: new Date(`${day}T20:00:00Z`), createdAt: new Date(`${day}T20:00:00Z`) } });
    }
    expect(await reserveDuePrivateEveningCheckIns(now)).toBe(0);
  });
});
