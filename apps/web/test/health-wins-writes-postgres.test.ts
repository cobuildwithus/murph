import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "@/src/lib/better-auth/native-auth";
import { getPrisma } from "@/src/lib/prisma";
import { openHealthTexts } from "@/src/lib/health-wins/crypto";
import { buildRecordedCards, recordedActivitySummary } from "@/src/lib/health-wins/engine/recorded";
import { openRecordedActivitySummaries } from "@/src/lib/health-wins/recorded-summary";
import { previewRecordedActivity, saveRecordedActivity } from "@/src/lib/health-wins/recorded-activities";
import { uploadHealthPhoto } from "@/src/lib/health-wins/media";
import { createHealthComment, createHealthPost, deleteHealthComment, deleteHealthPost, patchHealthPost, setHealthCheer } from "@/src/lib/health-wins/writes";

const state = vi.hoisted(() => ({
  consent: true, visible: true, currentSet: true, keysAvailable: true,
  resolve: vi.fn(), sent: vi.fn(), queued: [] as Array<() => Promise<void>>,
  putPhoto: vi.fn(),
}));
vi.mock("@/src/lib/game/progress/media-store", () => ({
  progressMediaStore: () => ({ putProgressPic: state.putPhoto }),
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

describe.skipIf(!enabled)("health write transactions", () => {
  afterEach(async () => {
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: memberIds.splice(0) } } });
    state.consent = state.visible = state.currentSet = state.keysAvailable = true;
    state.queued.length = 0;
    state.sent.mockClear();
    state.resolve.mockReset();
    vi.unstubAllEnvs();
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

    const otherPostId = randomUUID();
    await expect(createHealthPost(owner, { ...input, id: otherPostId }, "metric")).rejects.toMatchObject({ httpStatus: 409 });
    expect(await db.healthPost.count({ where: { id: otherPostId } })).toBe(0);

    state.keysAvailable = false;
    state.currentSet = false;
    state.resolve.mockClear();
    expect(await createHealthPost(owner, { ...input, cards: [changed] })).toEqual({ id: input.id, version: 1 });
    expect(state.resolve).not.toHaveBeenCalled();
    state.keysAvailable = true;

    async function storedCards() {
      const row = await db.healthPost.findUniqueOrThrow({ where: { id: input.id } });
      const opened = await openHealthTexts(row.cardsEncrypted.map((value, index) => ({
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
    expect(state.resolve).not.toHaveBeenCalled();
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

  it("previews without a write, seals a private summary once, and cascades it with the account", async () => {
    const owner = await member(), outsider = await member(), db = getPrisma();
    for (const memberId of [owner.member.id, outsider.member.id]) {
      await db.gameProfile.create({ data: { memberId, firstNameEncrypted: "fixture-label", timeZone: "America/Chicago" } });
    }
    const first = { id: randomUUID(), kind: "walk", startedAt: "2034-06-03T02:36:00.000Z", elapsedSec: 510, movingSec: 480 } as const;
    const activity = { id: randomUUID(), kind: "lift" as const, startedAt: "2034-06-03T03:11:00.000Z", elapsedSec: 180, movingSec: 165,
      heartRate: { avgBpm: 94, lowBpm: 69, peakBpm: 137, perMinute: [77, null, 104] } };
    const before = await previewRecordedActivity(owner, activity, "us");
    expect(before.cards).toHaveLength(1);
    expect(await db.healthActivity.count({ where: { memberId: owner.member.id } })).toBe(0);

    await Promise.all([saveRecordedActivity(owner, first), saveRecordedActivity(owner, first)]);
    const after = await previewRecordedActivity(owner, activity, "uk");
    expect(after.suggestedTitle).toMatch(/after your walk/i);
    expect(after.cards).toEqual(before.cards);
    expect(await db.healthActivity.count({ where: { memberId: owner.member.id } })).toBe(1);

    const summary = recordedActivitySummary(activity);
    const receipt = await saveRecordedActivity(owner, summary);
    expect(receipt).toEqual({ id: activity.id });
    const row = await db.healthActivity.findUniqueOrThrow({ where: receipt });
    expect(row.day).toBe("2034-06-02");
    expect(row.summaryEncrypted).not.toContain("peakBpm");
    expect(await openRecordedActivitySummaries([row])).toEqual([summary]);
    await expect(saveRecordedActivity(owner, { ...summary, movingSec: 154 })).rejects.toMatchObject({ httpStatus: 409 });
    await expect(saveRecordedActivity(outsider, summary)).rejects.toMatchObject({ httpStatus: 409 });
    expect((await db.healthActivity.findUniqueOrThrow({ where: receipt })).summaryEncrypted).toBe(row.summaryEncrypted);

    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", owner.member.id);
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", owner.member.id);
    const post = { id: randomUUID(), caption: "Fixture entry", activity };
    await expect(createHealthPost(owner, { ...post, activity: { ...activity, elapsedSec: 177 } })).rejects.toMatchObject({ httpStatus: 409 });
    expect(await db.healthPost.findUnique({ where: { id: post.id } })).toBeNull();
    const attempts = [post, { ...post, id: randomUUID() }];
    const results = await Promise.allSettled(attempts.map(attempt => createHealthPost(owner, attempt)));
    expect(results.filter(result => result.status === "rejected")).toMatchObject([{ reason: { httpStatus: 409 } }]);
    const winner = attempts[results.findIndex(result => result.status === "fulfilled")]!;
    expect(await db.healthPost.findMany({ where: { authorMemberId: owner.member.id }, select: { id: true } })).toEqual([{ id: winner.id }]);
    expect(await db.healthActivity.findUniqueOrThrow({ where: receipt })).toMatchObject({ postId: winner.id, summaryEncrypted: row.summaryEncrypted });

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
