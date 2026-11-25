import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { readHostedAuthSession } from "../src/lib/better-auth/session";
import { sealGameText } from "../src/lib/game/crypto";
import { friendsSchema } from "../src/lib/game/progress/contract";
import { everyoneCohortIds } from "../src/lib/game/progress/everyone";

const mocks = vi.hoisted(() => ({ after: vi.fn(), auth: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/game/http/auth", async original => ({
  ...await original<typeof import("../src/lib/game/http/auth")>(), requireGameMemberAuth: mocks.auth,
}));
import { GET } from "../app/api/game/v1/progress/friends/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Everyone proof needs an isolated loopback test database.");
}
const db = getPrisma();
const members: string[] = [], games: string[] = [];
const dayOne = new Date("2026-11-01T00:00:00Z");
const readEveryone = () => GET(new Request("https://example.test/api/game/v1/progress/friends?measure=pushups.reps&range=month&scope=everyone"));

async function member(name: string, joined = true, suspended = false) {
  const id = randomUUID(); members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active", suspendedAt: suspended ? dayOne : null } });
  await db.gameProfile.create({ data: { memberId: id, timeZone: "UTC", createdAt: dayOne,
    everyoneJoinedAt: joined ? new Date("2026-11-12T00:00:00Z") : null,
    firstNameEncrypted: (await sealGameText({ memberId: id, table: "game_profile", rowId: id, field: "first_name" }, name))! } });
  return id;
}

async function exercise(memberId: string, count: number, date = dayOne) {
  const id = randomUUID(); games.push(id);
  await db.game.create({ data: { id, createdBy: memberId, wordsOwnerMemberId: memberId, status: "live",
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [], checkInKind: "any" }] },
    termsWordsEncrypted: (await sealGameText({ memberId, table: "game", rowId: id, field: "terms_words" },
      JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [], defaultTask: "Seventeen pushups", stakes: [] }] })))!,
    players: { create: [{ memberId, seat: 0, timeZone: "UTC", dayOne: date, joinedAt: date }] },
  } });
  const entryId = randomUUID();
  await db.gameEntry.create({ data: { id: entryId, gameId: id, memberId, dayIndex: 0, attempt: 1,
    kind: "reps", receivedAt: date,
    payloadEncrypted: await sealGameText({ memberId, table: "game_entry", rowId: entryId, field: "payload" },
      JSON.stringify({ exercise: "pushups", count, reps: [] })),
  } });
}

async function signIn(memberId: string) {
  const adapter = hostedAuthAdapter(db)({});
  const dates = { createdAt: new Date(), updatedAt: new Date() }, token = randomUUID();
  await adapter.create({ model: "user", forceAllowId: true, data: {
    id: memberId, email: `${memberId}@example.test`, emailVerified: true, name: "", ...dates,
  } });
  await adapter.create({ model: "session", forceAllowId: true, data: {
    id: randomUUID(), userId: memberId, token, expiresAt: new Date(Date.now() + 60_000), ...dates,
  } });
  const { session } = await readHostedAuthSession({ baseURL: "https://example.test", secret: "synthetic-everyone-session-proof-secret",
    prisma: db, credential: token, transport: "native" });
  expect(session).not.toBeNull();
  mocks.auth.mockResolvedValue({ kind: "better-auth", ...session!, credential: token });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
});

describe.skipIf(!enabled)("Everyone membership cohort with PostgreSQL", () => {
  it("includes joined strangers and a zero-total viewer, excluding nonmembers, suspended members and either block direction", async () => {
    const viewer = await member("Rina"), joined = await member("Tavi"), notJoined = await member("Bela", false);
    const suspended = await member("Zeri", true, true), blocked = await member("Caro"), blockedBy = await member("Nelo");
    await db.gameBlock.createMany({ data: [
      { blockerMemberId: viewer, blockedMemberId: blocked }, { blockerMemberId: blockedBy, blockedMemberId: viewer },
    ] });
    for (const id of [joined, notJoined, suspended, blocked, blockedBy]) await exercise(id, 17);
    await exercise(joined, 400, new Date("2026-10-20T00:00:00Z"));
    await signIn(viewer);
    expect(new Set((await everyoneCohortIds(viewer, db)).ids)).toEqual(new Set([viewer, joined]));
    const response = await readEveryone();
    expect(response.status).toBe(200);
    const board = friendsSchema.parse(await response.json());
    expect(board).toMatchObject({ scope: "everyone", everyoneJoined: true, incomplete: false,
      range: "month", shareAsk: false, shareAudience: [], departureNotice: null, challenge: null });
    expect(board.rows.map(row => [row.memberId, row.total?.value, row.rank, row.joinedOn]))
      .toEqual([[joined, 17, null, null], [viewer, 0, null, null]]);
    expect(board.chart).toEqual([{ memberId: joined, points: [["2026-11-01", 17]] }, { memberId: viewer, points: [] }]);
    expect(board.pills).toContainEqual({ id: "pushups.reps", label: "Pushups", icon: "pushups", everyone: true });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(await db.gameProgressAward.count({ where: { memberId: { in: members } } })).toBe(0);
    expect(await db.gameProgressTaskMeasure.count({ where: { memberId: { in: members } } })).toBe(0);
    expect(JSON.stringify(board)).not.toMatch(/Seventeen|payload|gameId/);

    await db.gameProfile.update({ where: { memberId: viewer }, data: { everyoneJoinedAt: null } });
    const left = await readEveryone();
    expect(left.status).toBe(403);
    expect(await left.json()).toMatchObject({ error: { code: "EVERYONE_NOT_JOINED" } });
  });
});
