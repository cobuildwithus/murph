import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { authorizeMediaRead, authorizeMediaReads } from "../src/lib/game/service";
import { serveGameMedia } from "../src/lib/game/http/media-routes";
import * as media from "../src/lib/game/media";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Everyone media proof needs an isolated loopback test database.");
}
const db = getPrisma();
const members: string[] = [], games: string[] = [];
const keyFor = (id: string) => `game/${id}/${randomBytes(32).toString("hex")}.jpg`;

async function member(joined = true) {
  const id = randomUUID(), photoKey = keyFor(id);
  members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active" } });
  await db.gameProfile.create({ data: { memberId: id, firstNameEncrypted: "synthetic-unused-name", timeZone: "UTC",
    photoKey, everyoneJoinedAt: joined ? new Date() : null } });
  return { id, photoKey };
}

beforeEach(() => vi.stubEnv("MURPH_GAME_ENABLED", "true"));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
});

describe.skipIf(!enabled)("Everyone canonical profile media against PostgreSQL", () => {
  it("authorizes only the current avatar between joined strangers and serves its signed delivery", async () => {
    const viewer = await member(), subject = await member(), outsider = await member(false);
    expect(await authorizeMediaRead(viewer.id, subject.photoKey)).toBe(true);
    expect(await authorizeMediaRead(outsider.id, subject.photoKey)).toBe(false);
    expect(await authorizeMediaRead(viewer.id, outsider.photoKey)).toBe(false);
    const replacement = keyFor(subject.id);
    await db.gameProfile.update({ where: { memberId: subject.id }, data: { photoKey: replacement } });
    expect(await authorizeMediaReads(viewer.id, [subject.photoKey, replacement])).toEqual(new Set([replacement]));

    vi.spyOn(media, "isGameMediaStorageAvailable").mockReturnValue(true);
    vi.spyOn(media, "servesSignedGameMedia").mockReturnValue(true);
    const delivery = { url: "https://example.test/synthetic-avatar", expiresAt: "2030-01-01T00:05:00.000Z" };
    const sign = vi.spyOn(media, "gameMediaDelivery").mockResolvedValue(delivery);
    const response = await serveGameMedia({ memberId: viewer.id, key: replacement, delivery: true, variant: "avatar" });
    expect(await response.json()).toEqual(delivery);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sign).toHaveBeenCalledExactlyOnceWith(replacement, "avatar");
    sign.mockClear();
    await expect(serveGameMedia({ memberId: viewer.id, key: subject.photoKey, delivery: true, variant: "avatar" }))
      .rejects.toMatchObject({ code: "MEDIA_MISSING", httpStatus: 404 });
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(["viewer-left", "subject-left", "viewer-suspended", "subject-suspended", "viewer-block", "subject-block", "reported", "disabled"] as const)(
    "denies current avatar access after %s", async loss => {
      const viewer = await member(), subject = await member();
      expect(await authorizeMediaRead(viewer.id, subject.photoKey)).toBe(true);
      if (loss === "viewer-left" || loss === "subject-left") {
        await db.gameProfile.update({ where: { memberId: loss === "viewer-left" ? viewer.id : subject.id }, data: { everyoneJoinedAt: null } });
      } else if (loss === "viewer-suspended" || loss === "subject-suspended") {
        await db.hostedMember.update({ where: { id: loss === "viewer-suspended" ? viewer.id : subject.id }, data: { suspendedAt: new Date() } });
      } else if (loss === "viewer-block" || loss === "subject-block") {
        await db.gameBlock.create({ data: { blockerMemberId: loss === "viewer-block" ? viewer.id : subject.id,
          blockedMemberId: loss === "viewer-block" ? subject.id : viewer.id } });
      } else if (loss === "reported") {
        await db.gameReport.create({ data: { id: randomUUID(), reporterMemberId: viewer.id, reportedMemberId: subject.id, about: "player", reason: "other" } });
      } else {
        vi.stubEnv("MURPH_GAME_ENABLED", "false");
      }
      expect(await authorizeMediaRead(viewer.id, subject.photoKey)).toBe(false);
      const sign = vi.spyOn(media, "gameMediaDelivery");
      await expect(serveGameMedia({ memberId: viewer.id, key: subject.photoKey, delivery: true, variant: "avatar" }))
        .rejects.toMatchObject({ code: "MEDIA_MISSING", httpStatus: 404 });
      expect(sign).not.toHaveBeenCalled();
    },
  );

  it("never expands Everyone access to entry photos, contact photos or other uploads", async () => {
    const viewer = await member(), subject = await member(), peer = await member();
    const entryKey = keyFor(subject.id), contactKey = keyFor(subject.id), unusedKey = keyFor(subject.id), gameId = randomUUID();
    games.push(gameId);
    await db.game.create({ data: { id: gameId, createdBy: subject.id, wordsOwnerMemberId: subject.id, status: "settled",
      terms: {}, termsWordsEncrypted: "synthetic-unused-terms", players: { create: [subject, peer].map((person, seat) => ({ memberId: person.id, seat, timeZone: "UTC", joinedAt: new Date() })) } } });
    await db.gameEntry.create({ data: { id: randomUUID(), gameId, memberId: subject.id, dayIndex: 0, attempt: 1,
      kind: "photo", mediaKeys: [entryKey], receivedAt: new Date() } });
    await db.gameContactLabel.create({ data: { ownerMemberId: subject.id, subjectMemberId: peer.id, photoKey: contactKey } });
    expect(await authorizeMediaReads(viewer.id, [subject.photoKey, entryKey, contactKey, unusedKey])).toEqual(new Set([subject.photoKey]));
    // Existing game access remains independent of Everyone membership.
    await db.gameProfile.update({ where: { memberId: peer.id }, data: { everyoneJoinedAt: null } });
    expect(await authorizeMediaReads(peer.id, [subject.photoKey, entryKey, contactKey, unusedKey])).toEqual(new Set([subject.photoKey, entryKey]));
  });
});
