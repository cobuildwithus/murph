import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedVaultShareProjectionKindToScope, buildHostedVaultShareProjectionScopeKey, resolveHostedVaultShareDataSource, type HostedVaultShareFixedProjectionKind } from "@murphai/hosted-execution/vault-share";

const mocks = vi.hoisted(() => ({ audience: vi.fn(), route: vi.fn(), wake: vi.fn(), afterDecrypt: vi.fn(), decrypt: vi.fn(), auth: vi.fn() }));
vi.mock("@/src/lib/game/chat-membership", async original => ({
  ...await original<typeof import("@/src/lib/game/chat-membership")>(), readGameChatAudience: mocks.audience,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-routing/thread-route-store")>(), readHostedThreadRouteByThreadIdentity: mocks.route,
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ hasHostedRuntimeActiveAccess: vi.fn().mockResolvedValue(true) }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: mocks.wake }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ appendHostedMailboxEnvelopeTx: vi.fn(async (input: { envelope: { userId: string } }) => ({ item: {
  id: "synthetic-maintenance", lane: "maintenance", laneSeq: "1", userId: input.envelope.userId,
} })) }));
vi.mock("@/src/lib/hosted-vault-share/projection-snapshot", async original => {
  const actual = await original<typeof import("@/src/lib/hosted-vault-share/projection-snapshot")>();
  return { ...actual, decryptHostedVaultShareProjectionSnapshots: async (input: Parameters<typeof actual.decryptHostedVaultShareProjectionSnapshots>[0]) => {
    mocks.decrypt(input.entries.length, input.requestedHistoryDays);
    const result = await actual.decryptHostedVaultShareProjectionSnapshots(input);
    await mocks.afterDecrypt();
    return result;
  } };
});
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMember: mocks.auth }));

import { getPrisma } from "@/src/lib/prisma";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readPairBoard, savePairBoardSharing } from "@/src/lib/game/board";
import { readHostedGroupBoardData, leaveHostedGroupMemberTx } from "@/src/lib/hosted-groups/group-store";
import { recordHostedConsentGrant, buildCurrentHostedConsentDocumentVersions } from "@/src/lib/legal/consent";
import { createHostedEmailLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { grantHostedVaultShareTx } from "@/src/lib/hosted-vault-share/share-grant-store";
import { encryptHostedVaultShareProjectionSnapshot } from "@/src/lib/hosted-vault-share/projection-snapshot";
import { addDays } from "@/src/lib/game/time";
import { GET } from "../app/api/game/v1/people/[memberId]/board/route";
import { PUT } from "../app/api/game/v1/people/[memberId]/board/sharing/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Pair board proof needs an isolated loopback test database.");
const db = getPrisma();
const members: string[] = [], games: string[] = [], groups: string[] = [];
const today = () => new Date().toISOString().slice(0, 10);
async function fixture(joined = false) {
  const a = randomUUID(), b = randomUUID(), room = randomUUID(), groupId = randomUUID(), gameId = randomUUID();
  members.push(a, b, room); groups.push(groupId); games.push(gameId);
  await db.hostedMember.createMany({ data: [a, b, room].map(id => ({ id, billingStatus: "active" })) });
  await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: b } });
  for (const id of [a, b]) {
    await db.gameProfile.create({ data: { memberId: id, firstNameEncrypted: "synthetic", timeZone: "UTC" } });
    await db.hostedMemberEmailAuthorization.create({ data: { memberId: id, verifiedEmailLookupKey: createHostedEmailLookupKey(`${id}@example.test`), verifiedEmailVerifiedAt: new Date() } });
    for (const scope of ["launch.legal", "launch.health-data"] as const) await recordHostedConsentGrant({ memberId: id, scope,
      acceptedDocumentVersions: buildCurrentHostedConsentDocumentVersions(scope), prisma: db });
  }
  await db.hostedGroup.create({ data: { id: groupId, ownerMemberId: b, runtimeMemberId: room, members: { create: [b, ...(joined ? [a] : [])].map(memberId => ({ id: randomUUID(), memberId, role: memberId === b ? "owner" : "member", joinedAt: new Date() })) } } });
  await db.game.create({ data: { id: gameId, createdBy: a, wordsOwnerMemberId: a, maxPlayers: 2, status: "live", lengthDays: 30,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 10 }, stakes: [] }] }, termsWordsEncrypted: "synthetic",
    chatContainerMemberId: room, startedAt: new Date(),
    players: { create: [a, b].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date(`${addDays(today(), -20)}T00:00:00Z`), joinedAt: new Date() })) } } });
  mocks.auth.mockResolvedValue(a);
  mocks.audience.mockResolvedValue({ memberIds: [a, b], contacts: [a, b].map(id => createHostedLinqParticipantContact({ kind: "email", value: `${id}@example.test` })!), keys: { candidates: [], current: "synthetic" }, threadId: "synthetic-thread" });
  mocks.route.mockResolvedValue({ containerMemberId: room });
  const read = () => readPairBoard(a, b);
  const raw = () => readHostedGroupBoardData({ groupId, runtimeMemberId: room, viewerId: a, otherId: b, now: new Date() });
  const share = async (memberId: string, kind: HostedVaultShareFixedProjectionKind, published = false, legacy = false, sources = 1) => {
    const projectionScope = hostedVaultShareProjectionKindToScope(kind);
    const grant = await db.$transaction(tx => grantHostedVaultShareTx({ tx, grantorMemberId: memberId, destinationMemberId: room, projectionScope, now: new Date() }));
    if (published) {
      const authority = { id: grant.id, destinationMemberId: room, grantorMemberId: memberId, projectionScope, projectionScopeKey: buildHostedVaultShareProjectionScopeKey(projectionScope), projectionKind: kind };
      const values = { "resting-heart-rate-days.v0": ["resting-heart-rate", "bpm", 65], "sleep-duration-days.v0": ["total-sleep-minutes", "minutes", 430], "steps-days.v0": ["steps", "steps", 8000], "vo2-max-days.v0": ["estimated-vo2-max", "mL/kg/min", 42] } as const;
      if (!(kind in values)) throw new Error("Fixture snapshot kind not supported");
      const metric = values[kind as keyof typeof values];
      const ciphertext = await encryptHostedVaultShareProjectionSnapshot({ share: authority, ...(legacy ? {} : { memberTimeZone: "UTC" }), records: Array.from({ length: 90 }, (_, i) => Array.from({ length: sources }, (_, sourceIndex) => {
        const date = addDays(today(), i - 89);
        return { data: { date, metricKey: metric[0], unit: metric[1], value: metric[2] }, source: resolveHostedVaultShareDataSource(`source-${sourceIndex}`)!, recordKey: `${date}.source-${sourceIndex}`, occurredAt: `${date}T00:00:00.000Z` };
      })).flat() });
      await db.hostedVaultShare.update({ where: { id: grant.id }, data: { projectionSnapshotCiphertext: ciphertext } });

    }
    return grant.id;
  };
  return { a, b, room, groupId, gameId, read, raw, share };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  vi.clearAllMocks(); mocks.afterDecrypt.mockResolvedValue(undefined); mocks.wake.mockResolvedValue(undefined); process.env.MURPH_GAME_ENABLED = "true"; delete process.env.MURPH_GAME_BOARD_ENABLED; delete process.env.MURPH_GAME_MEMBER_ALLOWLIST;
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedGroup.deleteMany({ where: { id: { in: groups } } });
  await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
});

describe.skipIf(!enabled)("pair board PostgreSQL authority and routes", () => {
  it("distinguishes a readable empty VO2 snapshot from an unpublished grant on the wire", async () => {
    const f = await fixture(true);
    await f.share(f.a, "vo2-max-days.v0", true, false, 0);
    await f.share(f.b, "vo2-max-days.v0");
    const response = await GET(new Request("https://example.test/board"), { params: Promise.resolve({ memberId: f.b }) });
    expect(response.status).toBe(200);
    const { board } = await response.json();
    expect(board.people[0].numbers.vo2Max).toEqual({ state: "pending", reason: "no_readings" });
    expect(board.people[1].numbers.vo2Max).toEqual({ state: "pending" });
  });
  it("shows an unjoined shell, admits a pair seat and publishes all four scopes through existing grants", async () => {
    const f = await fixture();
    await f.share(f.b, "steps-days.v0", true);
    expect(await f.read()).toMatchObject({ membershipId: null, myShares: [], people: [
      { member: false, numbers: { steps: { state: "not_shared" } } }, { member: true, numbers: { steps: { state: "hidden" } } },
    ] });
    const board = await savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: ["restingHeartRate", "sleep", "steps", "vo2Max"] });
    expect(board?.membershipId).toBeTruthy();
    expect(board?.myShares).toEqual(["restingHeartRate", "sleep", "steps", "vo2Max"]);
    expect(board?.people[0].numbers.steps).toEqual({ state: "pending" });
    expect(board?.people[1].numbers.steps.state).toBe("available");
    expect(mocks.wake).toHaveBeenCalled();
    for (const kind of ["resting-heart-rate-days.v0", "sleep-duration-days.v0", "steps-days.v0", "vo2-max-days.v0"] as const) await f.share(f.a, kind, true);
    const read = await f.read();
    for (const value of Object.values(read!.people[0].numbers)) {
      expect(value.state).toBe("available");
      if (value.state === "available") expect(value.daily).toHaveLength(value.unit === "steps" ? 89 : 90);
    }
  });
  it.each([
    ["07:00:00", "2026-11-03", 88],
    ["08:00:00", "2026-11-04", 89],
  ])("applies the steps cutoff in the composed board at %s local", async (time, through, days) => {
    vi.setSystemTime(new Date(`2026-11-05T${time}-05:00`));
    const f = await fixture(true);
    await db.gamePlayer.updateMany({ where: { gameId: f.gameId }, data: { timeZone: "America/New_York" } });
    await f.share(f.a, "steps-days.v0", true);
    await f.share(f.a, "resting-heart-rate-days.v0", true);
    const board = await f.read();
    expect(board?.window).toEqual({ from: "2026-08-08", through: "2026-11-05" });
    const numbers = board!.people[0].numbers;
    expect(numbers.steps).toMatchObject({ state: "available", latest: { date: through, value: 8000 }, stale: false,
      comparison: { current: { through, value: 8000, days: 7 } } });
    if (numbers.steps.state !== "available") throw new Error("Expected settled steps");
    expect(numbers.steps.daily).toHaveLength(days);
    expect(numbers.steps.daily.every(point => point.date <= through)).toBe(true);
    expect(numbers.restingHeartRate).toMatchObject({ latest: { date: "2026-11-05", value: 65 } });
  });
  it("preserves an unshown scope, deselects, repeats and keeps committed grants when waking fails", async () => {
    const f = await fixture(true);
    const unshown = await f.share(f.a, "sleep-times.v0");
    await f.share(f.a, "steps-days.v0", true);
    const membershipId = (await f.read())!.membershipId;
    mocks.wake.mockRejectedValue(new Error("synthetic unavailable publisher"));
    const save = () => savePairBoardSharing(f.a, f.b, { expectedMembershipId: membershipId, numbers: ["sleep"] });
    await save(); await save();
    expect((await f.read())?.people[0].numbers).toMatchObject({ steps: { state: "not_shared" }, sleep: { state: "pending" } });
    expect(await db.hostedVaultShare.findUnique({ where: { id: unshown } })).toMatchObject({ status: "granted" });
    expect(await db.hostedGroupMember.count({ where: { groupId: f.groupId, memberId: f.a } })).toBe(1);
  });
  it("rejects a stale membership after leave, including leave/rejoin, and requires current consent", async () => {
    const f = await fixture(true);
    const membershipId = (await f.read())!.membershipId!;
    await db.$transaction(tx => leaveHostedGroupMemberTx({ memberId: f.a, membershipId, now: new Date(), tx }));
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: membershipId, numbers: ["steps"] })).rejects.toMatchObject({ httpStatus: 409, code: "MEMBERSHIP_CHANGED" });
    const joined = await savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] });
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: membershipId, numbers: [] })).rejects.toMatchObject({ httpStatus: 409 });
    await db.hostedConsentGrant.delete({ where: { memberId_scope: { memberId: f.a, scope: "launch.health-data" } } });
    const context = { params: Promise.resolve({ memberId: f.b }) };
    const response = await PUT(new Request("https://example.test/board/sharing", { method: "PUT", body: JSON.stringify({ expectedMembershipId: joined!.membershipId, numbers: [] }) }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("HOSTED_CONSENT_REQUIRED");
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: joined!.membershipId, numbers: [] })).rejects.toMatchObject({ httpStatus: 403, code: "HOSTED_CONSENT_REQUIRED" });
  });
  it("refuses outsiders, departed seats, unbound games, changed provider audiences and changed routes", async () => {
    const f = await fixture();
    await expect(savePairBoardSharing(f.room, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
    mocks.route.mockResolvedValueOnce({ containerMemberId: "different-room" });
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
    mocks.audience.mockRejectedValueOnce(new Error("synthetic provider failure"));
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
    const evidence = await mocks.audience();
    mocks.audience.mockResolvedValueOnce({ ...evidence, memberIds: [f.a, f.room] });
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
    mocks.audience.mockImplementationOnce(async () => { await db.game.update({ where: { id: f.gameId }, data: { chatContainerMemberId: null } }); return evidence; });
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
    expect(await f.read()).toBeNull();
    await db.game.update({ where: { id: f.gameId }, data: { chatContainerMemberId: f.room } });
    await db.gamePlayer.update({ where: { gameId_memberId: { gameId: f.gameId, memberId: f.a } }, data: { leftAt: new Date() } });
    await expect(f.read()).rejects.toMatchObject({ httpStatus: 404 });
  });
  it("keeps legacy and missing snapshots pending and revalidates viewer membership after decryption", async () => {
    const f = await fixture(true);
    await f.share(f.b, "steps-days.v0", true, true);
    expect((await f.read())?.people[1].numbers.steps).toEqual({ state: "pending" });
    await f.share(f.b, "steps-days.v0", true);
    mocks.afterDecrypt.mockImplementationOnce(async () => {
      await db.hostedGroupMember.delete({ where: { groupId_memberId: { groupId: f.groupId, memberId: f.a } } });
      await db.hostedGroupMember.create({ data: { id: randomUUID(), groupId: f.groupId, memberId: f.a, role: "member", joinedAt: new Date() } });
    });
    expect((await f.read())?.people[1].numbers.steps).toEqual({ state: "hidden" });
  });
  it("withholds a grant replaced during decryption, and masks a new game block before returning", async () => {
    const f = await fixture(true);
    const shareId = await f.share(f.b, "steps-days.v0", true);
    mocks.afterDecrypt.mockImplementationOnce(async () => { await db.hostedVaultShare.update({ where: { id: shareId }, data: { id: randomUUID(), projectionSnapshotCiphertext: null } }); });
    expect((await f.read())?.people[1].numbers.steps).toEqual({ state: "pending" });
    await f.share(f.b, "steps-days.v0", true);
    mocks.afterDecrypt.mockImplementationOnce(async () => { await db.gameBlock.create({ data: { blockerMemberId: f.b, blockedMemberId: f.a } }); });
    await expect(f.read()).rejects.toMatchObject({ httpStatus: 404 });
  });
  it("reads canonical Day 1 older than the health window and independently of the streak cap", async () => {
    const f = await fixture(true);
    const old = addDays(today(), -200);
    await db.gamePlayer.updateMany({ where: { gameId: f.gameId }, data: { dayOne: new Date(`${old}T00:00:00Z`) } });
    await f.share(f.a, "steps-days.v0", true);
    expect(await f.read()).toMatchObject({ firstGameOn: old, people: [{ numbers: { steps: { comparison: { sinceFirstGame: false } } } }, {}] });
    const extraGames = Array.from({ length: 100 }, () => randomUUID());
    games.push(...extraGames);
    await db.game.createMany({ data: extraGames.map(id => ({ id, createdBy: f.a, wordsOwnerMemberId: f.a, maxPlayers: 2, status: "settled", lengthDays: 7,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] }, termsWordsEncrypted: "synthetic", chatContainerMemberId: f.room })) });
    await db.gamePlayer.createMany({ data: extraGames.flatMap(gameId => [f.a, f.b].map((memberId, seat) => ({ gameId, memberId, seat,
      timeZone: "UTC", joinedAt: new Date(), dayOne: new Date(`${addDays(today(), -7)}T00:00:00Z`) }))) });
    expect(await f.read()).toMatchObject({ firstGameOn: old, people: [{ inARow: null }, { inARow: null }] });
  });
  it("bounds a full eight-source, four-metric read to two batches and only the pair's snapshots", async () => {
    const f = await fixture(true);
    for (const memberId of [f.a, f.b]) for (const kind of ["resting-heart-rate-days.v0", "sleep-duration-days.v0", "steps-days.v0", "vo2-max-days.v0"] as const) {
      await f.share(memberId, kind, true, false, 8);
    }
    const unrelated = randomUUID(); members.push(unrelated);
    await db.hostedMember.create({ data: { id: unrelated, billingStatus: "active" } });
    await db.hostedGroupMember.create({ data: { id: randomUUID(), groupId: f.groupId, memberId: unrelated, role: "member" } });
    mocks.decrypt.mockClear();
    const board = await f.read();
    expect(board?.people).toHaveLength(2);
    expect(mocks.decrypt.mock.calls).toEqual([[4, 90], [4, 90]]);
    for (const person of board!.people) for (const metric of Object.values(person.numbers)) {
      expect(metric.state).toBe("available");
      if (metric.state === "available") expect(metric.daily).toHaveLength(metric.unit === "steps" ? 89 : 90);
    }
  });
  it("uses the latest chat-bound pair game; an unbound newer game doesn't hide the board", async () => {
    const f = await fixture(true);
    const newer = randomUUID(); games.push(newer);
    await db.game.create({ data: { id: newer, createdBy: f.a, wordsOwnerMemberId: f.a, maxPlayers: 2, status: "live", lengthDays: 7,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] }, termsWordsEncrypted: "synthetic",
      createdAt: new Date(Date.now() + 1000), players: { create: [f.a, f.b].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", joinedAt: new Date(), dayOne: new Date(`${today()}T00:00:00Z`) })) } } });
    expect(await f.read()).toMatchObject({ groupId: f.groupId });
    await db.game.update({ where: { id: newer }, data: { chatContainerMemberId: f.a } }); // no HostedGroup at this binding
    expect(await f.read()).toBeNull();
    await expect(savePairBoardSharing(f.a, f.b, { expectedMembershipId: null, numbers: [] })).rejects.toMatchObject({ httpStatus: 404 });
  });
  it("uses no-store routes, enforces kill switch and rejects malformed saves", async () => {
    const f = await fixture();
    const context = { params: Promise.resolve({ memberId: f.b }) };
    const request = (body?: unknown) => new Request("https://example.test/api/game/v1/people/other/board", { method: body ? "PUT" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
    const get = await GET(request(), context);
    expect(get.status).toBe(200); expect(get.headers.get("cache-control")).toContain("no-store");
    expect((await get.json()).board.membershipId).toBeNull();
    expect((await PUT(request({ numbers: [] }), context)).status).toBe(400);
    expect((await PUT(request({ expectedMembershipId: null, numbers: ["privateRank"] }), context)).status).toBe(400);
    process.env.MURPH_GAME_BOARD_ENABLED = "false";
    expect(await (await GET(request(), context)).json()).toEqual({ board: null });
    expect((await PUT(request({ expectedMembershipId: null, numbers: [] }), context)).status).toBe(404);
    process.env.MURPH_GAME_BOARD_ENABLED = "FALSE";
    expect((await (await GET(request(), context)).json()).board).not.toBeNull();
    mocks.auth.mockRejectedValueOnce(hostedOnboardingError({ code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in to continue." }));
    const denied = await GET(request(), context);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toContain("no-store");
  });
});
