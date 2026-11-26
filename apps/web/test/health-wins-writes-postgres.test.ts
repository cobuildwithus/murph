import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "@/src/lib/better-auth/native-auth";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import * as moderation from "@/src/lib/game/moderation";
import { encodePolyline } from "@/src/lib/game/progress/route-geometry";
import * as gameService from "@/src/lib/game/service";
import { createHostedOpaqueDigest } from "@/src/lib/hosted-onboarding/contact-privacy";
import { getPrisma } from "@/src/lib/prisma";
import { prepareRecordedActivityExport } from "@/src/lib/health-wins/activity-export";
import * as healthCrypto from "@/src/lib/health-wins/crypto";
import { buildRecordedCards } from "@/src/lib/health-wins/engine/recorded";
import { openRecordedActivitySummaries } from "@/src/lib/health-wins/recorded-summary";
import { previewRecordedActivity, saveRecordedActivity } from "@/src/lib/health-wins/recorded-activities";
import { uploadHealthPhoto } from "@/src/lib/health-wins/media";
import { readHealthPayoffs } from "@/src/lib/health-wins/payoff";
import { createHealthComment, createHealthPost, deleteHealthComment, deleteHealthPost, patchHealthPost, setHealthCheer } from "@/src/lib/health-wins/writes";
import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { seedHealthPayoff } from "./support/health-payoff-fixture";

const state = vi.hoisted(() => ({
  consent: true, visible: true, currentSet: true, keysAvailable: true,
  resolve: vi.fn(), sent: vi.fn(), queued: [] as Array<() => Promise<void>>,
  putPhoto: vi.fn(),
}));
vi.mock("@/src/lib/game/progress/media-store", () => ({
  progressMediaStore: () => ({ putProgressPic: state.putPhoto }),
  purgeProgressMedia: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/server", async original => ({ ...await original<object>(), after: (task: () => Promise<void>) => state.queued.push(task) }));
vi.mock("@/src/lib/health-wins/flag", async original => ({ ...await original<object>(), isHealthFeedEnabled: () => true }));
vi.mock("@/src/lib/browser-vault/authority", () => ({
  assertBrowserVaultMemberAuthority: async () => { if (!state.consent) throw new Error("Synthetic consent withdrawal"); },
}));
vi.mock("@/src/lib/health-wins/wins", () => ({
  resolveHealthCards: state.resolve,
  assertHealthSetCurrent: async () => { if (!state.currentSet) throw Object.assign(new Error("Set replaced"), { httpStatus: 409 }); },
}));
// Audience has its own relational route proof. Use the real parent/child liveness facts in these mutation races.
vi.mock("@/src/lib/health-wins/audience", () => ({
  findVisibleHealthPost: (db: Prisma.TransactionClient, _viewer: string, id: string) => state.visible
    ? db.healthPost.findFirst({ where: { id, deletedAt: null }, select: { id: true, authorMemberId: true, version: true } }) : null,
  findVisibleHealthComment: (db: Prisma.TransactionClient, _viewer: string, id: string) => state.visible
    ? db.healthPostComment.findFirst({ where: { id, deletedAt: null, post: { deletedAt: null } } }) : null,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  unwrapHostedDomainRootForWeb: async () => {
    if (!state.keysAvailable) throw new Error("Key service unavailable");
    return { rootKey: Buffer.alloc(32, 17), envelope: { rootKeyId: "synthetic-health-root" } };
  },
  unwrapHostedDomainRootForWebByRootKeyId: async () => ({ rootKey: Buffer.alloc(32, 17) }),
}));
vi.mock("@/src/lib/game/push-delivery", () => ({
  readGamePushRoutes: async (_db: unknown, members: string[]) => [{ userId: members[0], gameSessionId: "synthetic-installation",
    environment: "development", token: "bd".repeat(32), topic: "ai.withmurph.app.dev" }],
  deliverGamePush: async (notification: unknown, valid: () => Promise<boolean>) => { if (await valid()) state.sent(notification); },
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Health write proof requires a loopback test database.");
}
const memberIds: string[] = [];

async function member(): Promise<HostedNativeMemberAuth> {
  const db = getPrisma(), memberId = `hbm_health_write_${randomUUID()}`, sessionId = randomUUID(), now = new Date();
  memberIds.push(memberId);
  const member = await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  const expiresAt = new Date(now.getTime() + 86400_000);
  const row = await db.hostedAuthRecord.create({ data: { id: sessionId, model: "session", memberId,
    createdAt: now, updatedAt: now, expiresAt, payloadEncrypted: "synthetic-session-proof" } });
  // The initial native authentication is upstream. Exercise the real in-transaction session proof and locks.
  const credential = randomUUID();
  return { kind: "better-auth", credential, member, sessionId, proof: { row, expiresAt, credentialDigest: createHash("sha256").update(credential).digest() } };
}

async function payoffFixture() {
  const owner = await member(), debtor = await member();
  const memberId = owner.member.id, debtorId = debtor.member.id;
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
  vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", memberId);
  const { gameId, ticketId, result } = await seedHealthPayoff({ winnerId: memberId, debtorId });
  const { cards } = await readHealthPayoffs(owner);
  expect(cards).toHaveLength(1);
  const pick = { candidateId: `game:${gameId}`, option: "original", specRevision: cards[0]!.specRevision };
  const attachmentId = randomUUID();
  await uploadHealthPhoto(owner, attachmentId, Uint8Array.of(3, 6, 9));
  return { owner, debtorId, memberId, gameId, ticketId, result, input: { id: randomUUID(), attachmentId, cards: [pick] } };
}

describe.skipIf(!enabled)("health write transactions", () => {
  afterEach(async () => {
    await cleanupGameFixtures(getPrisma(), memberIds);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds.splice(0) } } });
    state.consent = state.visible = state.currentSet = state.keysAvailable = true;
    state.queued.length = 0;
    state.sent.mockClear();
    state.resolve.mockReset();
    vi.unstubAllEnvs();
  });

  it("commits the scoped payoff, photo and one redemption together across same-ID retries and a repost", async () => {
    const { owner, memberId, gameId, ticketId, input } = await payoffFixture();
    const db = getPrisma(), receipt = { id: input.id, version: 1 };
    expect(await Promise.all([createHealthPost(owner, input), createHealthPost(owner, input)])).toEqual([receipt, receipt]);
    const post = await db.healthPost.findUniqueOrThrow({ where: { id: input.id } });
    expect(post).toMatchObject({ gameId, postedCardKeys: [], authorMemberId: memberId });
    expect(post.cardsEncrypted).toHaveLength(1);
    const [frozen] = await healthCrypto.openHealthTexts([{ memberId, rowId: post.id, field: "card:0", table: "health_post", value: post.cardsEncrypted[0]! }]);
    expect(JSON.parse(frozen!)).toMatchObject({ id: `game:${gameId}`, specRevision: input.cards[0]!.specRevision,
      spec: { kind: "game_result", chart: { type: "game_result", paid: true } } });
    expect(await db.healthPostAttachment.findUniqueOrThrow({ where: { id: input.attachmentId } })).toMatchObject({ postId: post.id, status: "published" });
    const events = () => db.gameEvent.findMany({ where: { gameId, type: "redeemed" }, select: { actor: true, payload: true } });
    expect(await events()).toEqual([{ actor: memberId, payload: { v: 1, ticketId } }]);
    const ticket = await db.gameTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ status: "redeemed", redeemedAt: expect.any(Date) });

    for (const edit of [{ cards: [] }, { cards: [{ candidateId: "slot:willow", option: "original" }], setRevision: randomUUID() },
      { removeCardIds: [input.cards[0]!.candidateId] }]) {
      await expect(patchHealthPost(owner, post.id, { ...edit, expectedVersion: 1 })).rejects.toMatchObject({ httpStatus: 400 });
    }
    expect(await patchHealthPost(owner, post.id, { expectedVersion: 1, caption: "Course complete." })).toEqual({ id: post.id, version: 2 });
    expect((await db.healthPost.findUniqueOrThrow({ where: { id: post.id } })).cardsEncrypted).toEqual(post.cardsEncrypted);
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", "");
    state.keysAvailable = false;
    expect(await createHealthPost(owner, input)).toEqual({ id: post.id, version: 2 });
    state.keysAvailable = true;
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", memberId);
    await deleteHealthPost(owner, post.id);
    expect(await db.healthPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ gameId, deletedAt: expect.any(Date) });
    const next = { ...input, id: randomUUID(), attachmentId: randomUUID() };
    await uploadHealthPhoto(owner, next.attachmentId, Uint8Array.of(4, 7));
    await createHealthPost(owner, next);
    expect(await events()).toHaveLength(1);
    expect(await db.gameTicket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(ticket);
  });

  it("admits one of two distinct payoff posts for the same game and preserves the unused draft", async () => {
    const { owner, input, gameId } = await payoffFixture(), db = getPrisma();
    const other = { ...input, id: randomUUID(), attachmentId: randomUUID() };
    await uploadHealthPhoto(owner, other.attachmentId, Uint8Array.of(11, 12));
    const attempts = [input, other];
    const results = await Promise.allSettled(attempts.map(attempt => createHealthPost(owner, attempt)));
    expect(results.filter(r => r.status === "rejected")).toMatchObject([{ reason: { httpStatus: 409, code: "HEALTH_PAYOFF_EXISTS" } }]);
    const winner = attempts[results.findIndex(r => r.status === "fulfilled")]!;
    const unused = attempts.find(attempt => attempt !== winner)!;
    expect(await db.healthPost.findMany({ where: { gameId }, select: { id: true } })).toEqual([{ id: winner.id }]);
    expect(await db.gameEvent.count({ where: { gameId, type: "redeemed" } })).toBe(1);
    expect(await db.healthPostAttachment.findUniqueOrThrow({ where: { id: unused.attachmentId } })).toMatchObject({ postId: null, status: "ready" });
    await expect(createHealthPost(owner, unused)).rejects.toMatchObject({ httpStatus: 409, code: "HEALTH_PAYOFF_EXISTS" });
  });

  it("rolls back the post, photo, ticket and event when redemption fails before commit", async () => {
    const { owner, gameId, ticketId, input } = await payoffFixture(), db = getPrisma();
    const redeem = gameService.redeemGameTicketTx;
    const failed = vi.spyOn(gameService, "redeemGameTicketTx").mockImplementationOnce(async (tx, ticket) => {
      await redeem(tx, ticket);
      throw new Error("Synthetic redemption failure");
    });
    try {
      await expect(createHealthPost(owner, input)).rejects.toThrow("Synthetic redemption failure");
    } finally {
      failed.mockRestore();
    }
    expect(await db.healthPost.findUnique({ where: { id: input.id } })).toBeNull();
    expect(await db.healthPostAttachment.findUniqueOrThrow({ where: { id: input.attachmentId } })).toMatchObject({ postId: null, status: "ready" });
    expect(await db.gameTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ status: "open", redeemedAt: null });
    expect(await db.gameEvent.count({ where: { gameId, type: "redeemed" } })).toBe(0);
    expect(await createHealthPost(owner, input)).toEqual({ id: input.id, version: 1 });
    expect(await db.gameEvent.count({ where: { gameId, type: "redeemed" } })).toBe(1);
  });

  it("rejects a stale digest, disabled writer, invalid proof and payoff selection on an ordinary post", async () => {
    const { owner, memberId, ticketId, gameId, input } = await payoffFixture(), db = getPrisma();
    const pick = input.cards[0]!;
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", "");
    await expect(createHealthPost(owner, input)).rejects.toMatchObject({ httpStatus: 404 });
    vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", memberId);
    await expect(createHealthPost(owner, { ...input, cards: [{ ...pick, specRevision: "a".repeat(64) }] }))
      .rejects.toMatchObject({ httpStatus: 409, code: "HEALTH_PAYOFF_CHANGED" });
    await expect(createHealthPost(owner, { ...input, attachmentId: undefined })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(createHealthPost(owner, { ...input, setRevision: randomUUID(), cards: [pick, { candidateId: "slot:willow", option: "original" }] }))
      .rejects.toMatchObject({ httpStatus: 400 });
    await expect(createHealthPost(owner, { ...input, attachmentId: randomUUID() })).rejects.toMatchObject({ httpStatus: 409 });
    const regular = await createHealthPost(owner, { id: randomUUID(), caption: "Finished the route." });
    await expect(patchHealthPost(owner, regular.id, { expectedVersion: 1, setRevision: randomUUID(), cards: [pick] }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(await db.healthPost.findUnique({ where: { id: input.id } })).toBeNull();
    expect(await db.gameTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ status: "open", redeemedAt: null });
    expect(await db.gameEvent.count({ where: { gameId, type: "redeemed" } })).toBe(0);
  });

  it.each(["score correction", "debtor departure"] as const)("rechecks the prepared payoff after a %s", async change => {
    const { owner, debtorId, gameId, ticketId, input, result } = await payoffFixture(), db = getPrisma();
    const seal = healthCrypto.sealHealthTexts;
    const sealing = vi.spyOn(healthCrypto, "sealHealthTexts").mockImplementationOnce(async fields => {
      const encrypted = await seal(fields);
      if (change === "debtor departure") {
        await db.gamePlayer.update({ where: { gameId_memberId: { gameId, memberId: debtorId } }, data: { leftAt: new Date() } });
      } else {
        const corrected = { ...result, scores: result.scores.map(row => row.memberId === debtorId ? { ...row, score: 4, misses: 3 } : row) };
        await db.game.update({ where: { id: gameId }, data: { result: toPrismaJsonObject(corrected) } });
      }
      return encrypted;
    });
    try {
      const error = change === "debtor departure" ? { httpStatus: 404 } : { httpStatus: 409, code: "HEALTH_PAYOFF_CHANGED" };
      await expect(createHealthPost(owner, input)).rejects.toMatchObject(error);
      expect(sealing).toHaveBeenCalled();
    } finally {
      sealing.mockRestore();
    }
    expect(await db.healthPost.findUnique({ where: { id: input.id } })).toBeNull();
    expect(await db.healthPostAttachment.findUniqueOrThrow({ where: { id: input.attachmentId } })).toMatchObject({ postId: null, status: "ready" });
    expect(await db.gameTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ status: "open", redeemedAt: null });
    expect(await db.gameEvent.count({ where: { gameId, type: "redeemed" } })).toBe(0);
  });

  it("admits one concurrent creation, replays across a set replacement, and freezes one envelope per card", async () => {
    const owner = await member(), other = await member(), db = getPrisma();
    const input = { id: randomUUID(), setRevision: randomUUID(), cards: [{ candidateId: "test-card", option: "original" }], caption: "Synthetic caption" };
    state.resolve.mockResolvedValue({ day: "2026-08-22", cards: [{ id: "test-card", specRevision: randomUUID(), spec: { title: "Synthetic specimen" } }] });
    const receipts = await Promise.all([createHealthPost(owner, input), createHealthPost(owner, input)]);
    expect(receipts).toEqual([{ id: input.id, version: 1 }, { id: input.id, version: 1 }]);
    const post = await db.healthPost.findUniqueOrThrow({ where: { id: input.id } });
    expect(post.cardsEncrypted).toHaveLength(1);
    expect(JSON.stringify(post)).not.toContain("Synthetic");
    state.currentSet = false;
    state.resolve.mockClear();
    expect(await createHealthPost(owner, input)).toEqual(receipts[0]);
    expect(state.resolve).not.toHaveBeenCalled();
    await expect(createHealthPost(other, input)).rejects.toMatchObject({ httpStatus: 409 });
    const replaced = { ...input, id: randomUUID() };
    await expect(createHealthPost(owner, replaced)).rejects.toMatchObject({ httpStatus: 409 });
    expect(await db.healthPost.findUnique({ where: { id: replaced.id } })).toBeNull();
  });

  it("binds a recording once, checks the selected revision, and keeps mixed frozen cards in order across edits", async () => {
    const owner = await member(), db = getPrisma(), memberId = owner.member.id;
    await db.gameProfile.create({ data: { memberId, timeZone: "UTC", firstNameEncrypted: "fixture-name" } });
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
    const activity = { kind: "lift", id: randomUUID(), startedAt: "2031-03-16T07:12:00.000Z", elapsedSec: 420, movingSec: 406 } as const;
    const { candidates: [candidate] } = buildRecordedCards(activity, { day: "2031-03-16", hour: 7, units: "metric" });
    const hidden = candidate!.variants.find(item => item.option === "hide_numbers")!;
    const pick = { candidateId: candidate!.id, option: hidden.option, specRevision: hidden.specRevision };
    const input = { id: randomUUID(), activity, setRevision: randomUUID(), cards: [
      { candidateId: "fixture-walk", option: "original" }, pick, { candidateId: "fixture-rest", option: "original" },
    ] };
    const winCards = ["fixture-walk", "fixture-rest"].map(id => ({ id, specRevision: randomUUID(), spec: { title: id } }));
    state.resolve.mockResolvedValue({ day: "2031-03-16", cards: winCards });

    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", "");
    await expect(createHealthPost(owner, input)).rejects.toMatchObject({ httpStatus: 404 });
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", memberId);
    const changed = { ...pick, specRevision: "e".repeat(64) };
    await expect(createHealthPost(owner, { ...input, cards: [changed] })).rejects.toMatchObject({
      httpStatus: 409, code: "HEALTH_ACTIVITY_CARD_CHANGED",
    });
    expect(await db.healthPost.count({ where: { id: input.id } })).toBe(0);
    expect(await db.healthActivity.count({ where: { id: activity.id } })).toBe(0);
    expect(await createHealthPost(owner, input, "metric")).toEqual({ id: input.id, version: 1 });
    expect(await db.healthActivity.findUniqueOrThrow({ where: { id: activity.id } })).toMatchObject({ postId: input.id, memberId });
    const postedKeys = () => db.healthPost.findUniqueOrThrow({ where: { id: input.id }, select: { postedCardKeys: true } });
    const winKeys = winCards.map(card => createHostedOpaqueDigest("health-win-card", `${memberId}:${card.id}`));
    expect((await postedKeys()).postedCardKeys).toEqual(winKeys);

    const otherPostId = randomUUID();
    await expect(createHealthPost(owner, { ...input, id: otherPostId }, "metric")).rejects.toMatchObject({ httpStatus: 409 });
    expect(await db.healthPost.count({ where: { id: otherPostId } })).toBe(0);

    state.keysAvailable = false;
    state.currentSet = false;
    state.resolve.mockClear();
    expect(await createHealthPost(owner, { ...input, cards: [changed] })).toEqual({ id: input.id, version: 1 });
    expect(state.resolve).not.toHaveBeenCalled();
    state.keysAvailable = true;
    // A committed post keeps its receipt even after the member leaves the recording allowlist.
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", "");
    expect(await createHealthPost(owner, input, "metric")).toEqual({ id: input.id, version: 1 });
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", memberId);

    async function storedCards() {
      const row = await db.healthPost.findUniqueOrThrow({ where: { id: input.id } });
      const opened = await healthCrypto.openHealthTexts(row.cardsEncrypted.map((value, index) => ({
        memberId, rowId: input.id, table: "health_post", field: `card:${index}`, value,
      })));
      return opened.map(value => JSON.parse(value));
    }
    const before = await storedCards();
    expect(before).toEqual([winCards[0], { id: pick.candidateId, specRevision: pick.specRevision, spec: hidden.spec }, winCards[1]]);
    await expect(patchHealthPost(owner, input.id, { expectedVersion: 1, cards: input.cards, setRevision: randomUUID() }))
      .rejects.toMatchObject({ httpStatus: 400 });
    await expect(patchHealthPost(owner, input.id, { expectedVersion: 1, removeCardIds: ["unknown-card"] }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(await patchHealthPost(owner, input.id, { expectedVersion: 1, caption: "Fixture caption" })).toEqual({ id: input.id, version: 2 });
    expect(await storedCards()).toEqual(before);
    expect(await patchHealthPost(owner, input.id, { expectedVersion: 2, removeCardIds: [winCards[0]!.id] }))
      .toEqual({ id: input.id, version: 3 });
    expect(await storedCards()).toEqual(before.slice(1));
    expect((await postedKeys()).postedCardKeys).toEqual(winKeys.slice(1));
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("binds the private route summary and freezes only the cards retained after hiding the map", async () => {
    const owner = await member(), db = getPrisma(), memberId = owner.member.id;
    await db.gameProfile.create({ data: { memberId, timeZone: "UTC", firstNameEncrypted: "fixture-name" } });
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", memberId);
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", memberId);
    vi.stubEnv("MURPH_HEALTH_PAINTED_RUNS", "true");
    const summary = {
      id: randomUUID(), kind: "run" as const, startedAt: "2036-01-15T17:30:00.000Z", elapsedSec: 660, movingSec: 635,
      route: { distanceM: 2000, climbM: 11, splits: [{ distanceM: 1000, seconds: 310 }, { distanceM: 1000, seconds: 325 }] },
    };
    const paths = [encodePolyline([[-133, -38], [-133.001, -38.001]])];
    const activity = { ...summary, route: { ...summary.route, paths } };
    const preview = await previewRecordedActivity(owner, activity, "metric");
    const map = preview.cards.find(card => card.kind === "activity_route")!;
    const splits = preview.cards.find(card => card.kind === "activity_splits")!;
    const removal = map.change_options.find(option => option.id === "hide_map")!;
    const hideMap = { candidateId: map.candidateId, option: removal.id, specRevision: removal.specRevision };
    const showSplits = { candidateId: splits.candidateId, option: "original", specRevision: splits.specRevision };
    const id = randomUUID();
    const body = { id, activity, cards: [hideMap, showSplits] };

    await saveRecordedActivity(owner, summary);
    const saved = await db.healthActivity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(await openRecordedActivitySummaries([saved])).toEqual([
      { ...summary, route: { distanceM: 2000, climbM: 11, splitSec: [310, 325] } },
    ]);
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", "");
    await expect(createHealthPost(owner, body, "metric")).rejects.toMatchObject({ httpStatus: 404 });
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", memberId);
    const stalePick = { ...hideMap, specRevision: map.specRevision };
    await expect(createHealthPost(owner, { ...body, cards: [stalePick, showSplits] }, "metric"))
      .rejects.toMatchObject({ httpStatus: 409, code: "HEALTH_ACTIVITY_CARD_CHANGED" });
    await expect(createHealthPost(owner, { ...body, cards: [hideMap] }, "metric")).rejects.toMatchObject({ httpStatus: 400 });
    expect(await db.healthPost.count({ where: { id } })).toBe(0);
    expect(await createHealthPost(owner, body, "metric")).toEqual({ id, version: 1 });
    expect(state.queued).toHaveLength(0);

    const post = await db.healthPost.findUniqueOrThrow({ where: { id } });
    expect(post.cardsEncrypted).toHaveLength(1);
    const [card] = await healthCrypto.openHealthTexts([{ memberId, table: "health_post", rowId: id, field: "card:0", value: post.cardsEncrypted[0]! }]);
    expect(JSON.parse(card!)).toMatchObject({ id: splits.candidateId, spec: { kind: "activity_splits" } });
    expect(card).not.toContain("paths");
    expect(card).not.toContain("area:v2:");
    expect(await db.healthActivity.findUniqueOrThrow({ where: { id: activity.id } }))
      .toMatchObject({ summaryEncrypted: saved.summaryEncrypted, postId: id });
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", "");
    expect(await createHealthPost(owner, { ...body, cards: [stalePick] }, "us")).toEqual({ id, version: 1 });
  });

  it("applies one competing edit and permits a consent-withdrawn owner to retire their post and its children", async () => {
    const owner = await member(), friend = await member(), db = getPrisma();
    const post = await createHealthPost(owner, { id: randomUUID(), caption: "Fixture words" });
    const edits = await Promise.allSettled(["First edit", "Second edit"].map(caption =>
      patchHealthPost(owner, post.id, { expectedVersion: 1, caption })));
    expect(edits.filter(edit => edit.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter(edit => edit.status === "rejected")).toMatchObject([{ reason: { httpStatus: 409 } }]);
    await expect(patchHealthPost(owner, post.id, { expectedVersion: 2, caption: null })).rejects.toMatchObject({ httpStatus: 400 });
    await setHealthCheer(friend, post.id, true);
    const comment = await createHealthComment(friend, post.id, { id: randomUUID(), body: "A synthetic response" });
    state.consent = false;
    await expect(deleteHealthPost(friend, post.id)).rejects.toMatchObject({ httpStatus: 404 });
    await deleteHealthPost(owner, post.id);
    await deleteHealthPost(owner, post.id);
    const stored = await db.healthPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(stored).toMatchObject({ captionEncrypted: null, cardsEncrypted: [], version: 3, deletedAt: expect.any(Date) });
    expect(await db.healthPostCheer.count({ where: { postId: post.id } })).toBe(0);
    expect(await db.healthPostComment.findUnique({ where: { id: comment.id } })).toMatchObject({ deletedAt: expect.any(Date), bodyEncrypted: null });
    await expect(createHealthPost(owner, { id: post.id, caption: "Replay" })).rejects.toMatchObject({ httpStatus: 409 });
    for (const deliver of state.queued) await deliver();
    expect(state.sent).not.toHaveBeenCalled();
  });

  it("admits one concurrent upload into the last slot and lets existing drafts retry", async () => {
    const owner = await member(), other = await member(), db = getPrisma();
    const pendingId = randomUUID(), bytes = Uint8Array.of(1, 8);
    await db.healthPostAttachment.createMany({ data: Array.from({ length: 18 }, () => ({
      id: randomUUID(), memberId: owner.member.id, storageKeyEncrypted: "unused-test-binding", status: "ready",
    })) });
    state.putPhoto.mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
    await expect(uploadHealthPhoto(owner, pendingId, bytes)).rejects.toThrow("Storage temporarily unavailable");

    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(ids.map(id => uploadHealthPhoto(owner, id, bytes)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toMatchObject([{ reason: { code: "HEALTH_PHOTO_LIMIT", httpStatus: 409 } }]);
    const winner = ids[results.findIndex(result => result.status === "fulfilled")]!;
    await uploadHealthPhoto(owner, pendingId, bytes);
    await uploadHealthPhoto(owner, winner, bytes);
    expect(await db.healthPostAttachment.count({ where: { memberId: owner.member.id, status: "ready" } })).toBe(20);
    await uploadHealthPhoto(other, randomUUID(), bytes);
  });

  it("binds comment replays to actor and target, sends private comments only to the poster, and retains deleted IDs", async () => {
    const owner = await member(), friend = await member();
    const a = await createHealthPost(owner, { id: randomUUID(), caption: "First fixture" });
    const b = await createHealthPost(owner, { id: randomUUID(), caption: "Second fixture" });
    const input = { id: randomUUID(), body: "Example comment", visibility: "poster" } as const;
    await Promise.all([createHealthComment(friend, a.id, input), createHealthComment(friend, a.id, input)]);
    expect(state.queued).toHaveLength(1);
    state.keysAvailable = false;
    expect(await createHealthComment(friend, a.id, input)).toEqual({ id: input.id });
    await expect(createHealthComment(friend, b.id, input)).rejects.toMatchObject({ httpStatus: 409 });
    await expect(createHealthComment(owner, a.id, input)).rejects.toMatchObject({ httpStatus: 409 });
    await state.queued[0]!();
    expect(state.sent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ memberId: owner.member.id }));
    expect(JSON.stringify(state.sent.mock.calls)).not.toContain(input.body);
    state.visible = false;
    await state.queued[0]!();
    expect(state.sent).toHaveBeenCalledTimes(1);
    await deleteHealthComment(friend, input.id);
    state.visible = true;
    await state.queued[0]!();
    expect(state.sent).toHaveBeenCalledTimes(1);
    await expect(createHealthComment(friend, a.id, input)).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("atomically coalesces cheers per post for an hour and suppresses a withdrawn claim", async () => {
    const owner = await member(), friend = await member(), peer = await member();
    const post = await createHealthPost(owner, { id: randomUUID(), caption: "Sample post" });
    await Promise.all([setHealthCheer(friend, post.id, true), setHealthCheer(peer, post.id, true)]);
    expect(state.queued).toHaveLength(1);
    await state.queued[0]!();
    expect(state.sent).toHaveBeenCalledTimes(1);
    state.visible = false;
    await Promise.all([setHealthCheer(friend, post.id, false), setHealthCheer(peer, post.id, false)]);
    state.visible = true;
    await state.queued[0]!();
    expect(state.sent).toHaveBeenCalledTimes(1);
    await setHealthCheer(friend, post.id, true);
    expect(state.queued).toHaveLength(1);
    await getPrisma().healthPost.update({ where: { id: post.id }, data: { cheerPushClaimedAt: new Date(Date.now() - 3600_001) } });
    await setHealthCheer(peer, post.id, true);
    expect(state.queued).toHaveLength(2);
    await state.queued[1]!();
    expect(state.sent).toHaveBeenCalledTimes(2);
  });

  it("previews without a write, seals a private named summary once, and cascades it with the account", async () => {
    const owner = await member(), outsider = await member(), db = getPrisma();
    for (const memberId of [owner.member.id, outsider.member.id]) {
      await db.gameProfile.create({ data: { memberId, firstNameEncrypted: "fixture-label", timeZone: "America/Chicago" } });
    }
    const first = { id: randomUUID(), kind: "walk", name: "Orchard lap", startedAt: "2034-06-03T02:36:00.000Z", elapsedSec: 510, movingSec: 480 } as const;
    const summary = { id: randomUUID(), kind: "lift" as const, name: "Cable circuit", startedAt: "2034-06-03T03:11:00.000Z", elapsedSec: 180, movingSec: 165,
      heartRate: { avgBpm: 94, lowBpm: 69, peakBpm: 137 } };
    const activity = { ...summary, heartRate: { ...summary.heartRate, perMinute: [77, null, 104] } };
    const before = await previewRecordedActivity(owner, activity, "us");
    expect(before.cards).toHaveLength(1);
    expect(await db.healthActivity.count({ where: { memberId: owner.member.id } })).toBe(0);

    await Promise.all([saveRecordedActivity(owner, first), saveRecordedActivity(owner, first)]);
    const after = await previewRecordedActivity(owner, activity, "uk");
    expect(after.suggestedTitle).toBe("Cable circuit after your orchard lap");
    expect(after.cards).toEqual(before.cards);
    expect(await db.healthActivity.count({ where: { memberId: owner.member.id } })).toBe(1);

    const receipt = await saveRecordedActivity(owner, summary);
    expect(receipt).toEqual({ id: activity.id });
    const row = await db.healthActivity.findUniqueOrThrow({ where: receipt });
    expect(row.day).toBe("2034-06-02");
    expect(row.summaryEncrypted).not.toContain("peakBpm");
    expect(row.summaryEncrypted).not.toContain(summary.name);
    expect(await openRecordedActivitySummaries([row])).toEqual([summary]);
    await expect(saveRecordedActivity(owner, { ...summary, movingSec: 154 })).rejects.toMatchObject({ httpStatus: 409 });
    await expect(saveRecordedActivity(outsider, summary)).rejects.toMatchObject({ httpStatus: 409 });
    expect((await db.healthActivity.findUniqueOrThrow({ where: receipt })).summaryEncrypted).toBe(row.summaryEncrypted);

    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", owner.member.id);
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", owner.member.id);
    const post = { id: randomUUID(), caption: "Fixture entry", activity };
    await expect(createHealthPost(owner, { ...post, activity: { ...activity, elapsedSec: 177 } })).rejects.toMatchObject({ httpStatus: 409 });
    await expect(createHealthPost(owner, { ...post, activity: { ...activity, name: "Band circuit" } })).rejects.toMatchObject({
      httpStatus: 409, code: "HEALTH_ACTIVITY_CONFLICT",
    });
    expect(await db.healthPost.findUnique({ where: { id: post.id } })).toBeNull();
    const attempts = [post, { ...post, id: randomUUID() }];
    const results = await Promise.allSettled(attempts.map(attempt => createHealthPost(owner, attempt)));
    expect(results.filter(result => result.status === "rejected")).toMatchObject([{ reason: { httpStatus: 409 } }]);
    const winner = attempts[results.findIndex(result => result.status === "fulfilled")]!;
    expect(await db.healthPost.findMany({ where: { authorMemberId: owner.member.id }, select: { id: true } })).toEqual([{ id: winner.id }]);
    expect(await db.healthActivity.findUniqueOrThrow({ where: receipt })).toMatchObject({ postId: winner.id, summaryEncrypted: row.summaryEncrypted });

    // A policy change can reject new content while prior receipts and Settings exports stay readable.
    const policy = vi.spyOn(moderation, "isGameTextRefused").mockReturnValue(true);
    try {
      const freshSummary = { ...summary, id: randomUUID() };
      await expect(saveRecordedActivity(owner, freshSummary)).rejects.toMatchObject({
        httpStatus: 400, code: "HEALTH_ACTIVITY_NAME_INVALID",
      });
      expect(await db.healthActivity.findUnique({ where: { id: freshSummary.id } })).toBeNull();
      expect(await saveRecordedActivity(owner, summary)).toEqual(receipt);
      await expect(createHealthPost(owner, { ...post, id: randomUUID() })).rejects.toMatchObject({
        httpStatus: 400, code: "HEALTH_ACTIVITY_NAME_INVALID",
      });
      expect(await createHealthPost(owner, winner)).toEqual({ id: winner.id, version: 1 });
      const next = await previewRecordedActivity(owner, { ...activity, name: undefined }, "us");
      expect(next.suggestedTitle).toBe("Strength session after your orchard lap");
      const archive = await prepareRecordedActivityExport(owner.member.id, async () => {});
      const page = await archive!().next();
      expect(JSON.parse(page.value ?? "{}").recordedActivities).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.id, name: first.name }),
        expect.objectContaining({ id: activity.id, name: activity.name, postId: winner.id }),
      ]));
    } finally {
      policy.mockRestore();
    }

    // A partial day cannot support an "after" title. The overflow path should open no envelopes.
    await db.healthActivity.createMany({ data: Array.from({ length: 33 }, () => ({
      id: randomUUID(), memberId: owner.member.id, day: row.day, summaryEncrypted: "fixture-unopened",
    })) });
    expect((await previewRecordedActivity(owner, activity, "metric")).suggestedTitle).toBe(before.suggestedTitle);
    state.consent = false;
    await expect(saveRecordedActivity(owner, { ...first, id: randomUUID() })).rejects.toThrow("withdrawal");
    await expect(previewRecordedActivity(owner, activity, "us")).rejects.toThrow("withdrawal");

    await db.hostedMember.delete({ where: { id: owner.member.id } });
    expect(await db.healthActivity.count({ where: { memberId: owner.member.id } })).toBe(0);
  });
});
