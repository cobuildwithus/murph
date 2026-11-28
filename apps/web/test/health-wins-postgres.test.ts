import { randomUUID } from "node:crypto";
import { createBrowserVaultQueryClient } from "@murphai/query/browser-replica-client";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUT as saveActivity } from "../app/api/game/v1/health/activities/[id]/route";
import { POST as previewActivity } from "../app/api/game/v1/health/activities/cards/route";
import { GET as wins } from "../app/api/game/v1/health/wins/route";
import { POST as change } from "../app/api/game/v1/health/wins/[id]/change/route";
import { freezeHealthSelections, prepareHealthCandidates } from "../src/lib/health-wins/card-options";
import { generateHealthWins, type HealthWinsInput } from "../src/lib/health-wins/engine";
import * as inputs from "../src/lib/health-wins/inputs";
import * as companion from "../src/lib/device-sync/companion-numbers";
import { GET as profile } from "../app/api/game/v1/health/people/[memberId]/profile/route";
import { GET as feed } from "../app/api/game/v1/health/feed/route";
import { GET as photo } from "../app/api/game/v1/health/photos/[id]/route";
import { POST as post } from "../app/api/game/v1/health/posts/route";
import { DELETE as deletePost, GET as openPost, PATCH as editPost } from "../app/api/game/v1/health/posts/[id]/route";
import { GET as seeYours } from "../app/api/game/v1/health/posts/[id]/see-yours/route";
import { DELETE as uncheer, PUT as cheer } from "../app/api/game/v1/health/posts/[id]/cheer/route";
import { GET as comments, POST as comment } from "../app/api/game/v1/health/posts/[id]/comments/route";
import { DELETE as deleteComment } from "../app/api/game/v1/health/comments/[id]/route";
import { GET as listHides } from "../app/api/game/v1/health/hides/route";
import { DELETE as unhide, PUT as hide } from "../app/api/game/v1/health/hides/[memberId]/route";
import { serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";
import * as applePush from "../src/lib/apple-push/send";
import * as board from "../src/lib/game/board";
import * as gameCrypto from "../src/lib/game/crypto";
import * as moderation from "../src/lib/game/moderation";
import { GET as readArt } from "../app/api/game/v1/progress/art/[key]/route";
import { claimArt } from "../src/lib/game/progress/place-art";
import { encodePolyline } from "../src/lib/game/progress/route-geometry";
import * as audience from "../src/lib/health-wins/audience";
import * as crypto from "../src/lib/health-wins/crypto";
import { recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from "../src/lib/legal/consent";
import { getPrisma } from "../src/lib/prisma";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { experimentReplica } from "./support/health-win-experiment-replica";

const deferred = vi.hoisted(() => [] as Array<() => Promise<void>>);
const readPhotoObject = vi.hoisted(() => vi.fn());
vi.mock("next/server", async original => ({ ...await original<object>(), after: (task: () => Promise<void>) => deferred.push(task) }));
vi.mock("../src/lib/game/progress/media-store", async original => ({
  ...await original<object>(), progressMediaStore: () => ({ readProgressPic: readPhotoObject }),
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Health feed proofs require an isolated loopback test database.");
}
const db = getPrisma();
const games: string[] = [];
const areaKeys: string[] = [];
const members: string[] = [];
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const memberContext = (memberId: string) => ({ params: Promise.resolve({ memberId }) });

async function person(firstName = "Finch") {
  const id = randomUUID();
  members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active" } });
  const firstNameEncrypted = await gameCrypto.sealGameText({ table: "game_profile", memberId: id, rowId: id, field: "first_name" }, firstName);
  await db.gameProfile.create({ data: { memberId: id, timeZone: "UTC", firstNameEncrypted: firstNameEncrypted! } });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({ memberId: id, scope, prisma: db });
  }
  const { token, sessionId } = await issueHostedAppSession({ memberId: id });
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", members.join(","));
  return { id, sessionId, request(path: string, method = "GET", body?: object) {
    return new Request(`https://example.test/api/game/v1/health/${path}`, {
      method, headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}`, "content-type": "application/json" },
      body: body && JSON.stringify(body),
    });
  } };
}
type Person = Awaited<ReturnType<typeof person>>;

async function pair(first: Person, second: Person) {
  const id = randomUUID();
  games.push(id);
  await db.game.create({ data: {
    id, createdBy: first.id, wordsOwnerMemberId: first.id, status: "settled", terms: {}, termsWordsEncrypted: "unused",
    players: { create: [first, second].map((player, seat) => ({ memberId: player.id, seat, timeZone: "UTC", dayOne: new Date(), joinedAt: new Date() })) },
  } });
  return id;
}

async function share(author: Person) {
  const id = randomUUID();
  const body = { id, caption: "Found a quiet path today." };
  const create = () => post(author.request("posts", "POST", body));
  expect((await create()).status).toBe(200);
  expect((await create()).status).toBe(200);
  expect(await db.healthPost.count({ where: { id } })).toBe(1);
  return id;
}

const readPost = (who: Person, id: string) => openPost(who.request(`posts/${id}`), context(id));

function insulinReading(value: number, today: string): HealthWinsInput {
  return {
    member: { today, age: 42, sex: "female", wearableProvider: null },
    labs: [{ analyte: "insulin", value, unit: "µIU/mL", date: today, fasting: true }],
  };
}

async function frozenLabPost(author: Person, option = "original") {
  const today = new Date().toISOString().slice(0, 10);
  const input = insulinReading(3.4, today);
  const candidates = prepareHealthCandidates(author.id, generateHealthWins(input));
  const cardId = candidates[0].id, postId = randomUUID();
  const [card] = freezeHealthSelections(candidates, [{ candidateId: cardId, option }]);
  const cardsEncrypted = await crypto.sealHealthTexts([{
    memberId: author.id, table: "health_post", rowId: postId, field: "card:0", value: JSON.stringify(card),
  }]);
  await db.healthPost.create({ data: { id: postId, authorMemberId: author.id, cardsEncrypted } });
  return { postId, read(who: Person, selector = cardId) {
    return seeYours(who.request(`posts/${postId}/see-yours?card=${selector}`), context(postId));
  } };
}

type CommentFields = { visibility?: "everyone" | "poster"; replyTo?: string };

function submitComment(who: Person, postId: string, id: string, fields: CommentFields = {}) {
  return comment(who.request(`posts/${postId}/comments`, "POST", { id, body: "The practice log is ready.", ...fields }), context(postId));
}

async function addComment(who: Person, postId: string, fields?: CommentFields) {
  const id = randomUUID();
  const response = await submitComment(who, postId, id, fields);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id });
  return id;
}

type PageComment = { id: string; parentId: string | null; recipientMemberId: string | null; recipientFirstName: string | null };
async function commentPage(who: Person, postId: string, cursor?: string) {
  const query = cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
  const response = await comments(who.request(`posts/${postId}/comments${query}`), context(postId));
  expect(response.status).toBe(200);
  const page: { comments: PageComment[]; ancestors: { id: string }[]; nextCursor: string | null } = await response.json();
  return page;
}
async function readComments(who: Person, postId: string) {
  return (await commentPage(who, postId)).comments;
}

async function captureCommentPushes(people: Person[]) {
  const tokens = new Map(people.map(who => [who.id, randomUUID().replaceAll("-", "").repeat(2)]));
  await db.companionPushRoute.createMany({ data: people.map(who => ({
    userId: who.id, gameSessionId: who.sessionId, installationId: randomUUID(), token: tokens.get(who.id)!,
    environment: "development", topic: "ai.withmurph.app.dev", alertsAllowed: true, updatedAt: new Date(),
  })) });
  vi.spyOn(applePush, "prepareApplePushProviderToken").mockResolvedValue({ value: "fixture", issuedAt: Date.now() });
  const sends = vi.spyOn(applePush, "sendApplePush").mockResolvedValue("sent");
  return async (postId: string, commentId: string, targets: [Person, "reply" | "comment"][]) => {
    for (const task of deferred.splice(0)) await task();
    const requests = sends.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(targets.length);
    for (const [who, reason] of targets) expect(requests).toContainEqual(expect.objectContaining({
      target: expect.objectContaining({ token: tokens.get(who.id) }),
      data: { notification: "health_comment", postId, commentId },
      message: { kind: "alert", body: reason === "reply" ? "Someone replied to your comment." : "You have a new comment on your post." },
    }));
    sends.mockClear();
  };
}

async function commentIds(who: Person, postId: string) {
  return (await readComments(who, postId)).map(item => item.id);
}

describe.skipIf(!enabled)("health routes with native sessions and PostgreSQL", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 41).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 42).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://example.test");
  });
  afterEach(async () => {
    await db.game.deleteMany({ where: { id: { in: games.splice(0) } } });
    await db.hostedMember.deleteMany({ where: { id: { in: members.splice(0) } } });
    if (areaKeys.length) await db.gamePlaceArt.deleteMany({ where: { key: { in: areaKeys.splice(0) } } });
    deferred.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("serves the logged intervention and run counts from the stored win set", async () => {
    const member = await person();
    const client = createBrowserVaultQueryClient(await experimentReplica());
    const load = vi.spyOn(companion, "loadPublishedCompanionMetricReplica").mockResolvedValue({ client, state: "ready", freshness: "fresh" });
    for (let read = 0; read < 2; read++) {
      const response = await wins(member.request("wins"));
      expect(response.status).toBe(200);
      const { candidates } = await response.json();
      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "experiment_result", title: { number: "Meditation", measure: "" },
          chart: expect.objectContaining({ adherence: { done: 13, target: 10 } }) }),
        expect.objectContaining({ kind: "experiment_result", title: { number: "Running", measure: "" },
          chart: expect.objectContaining({ adherence: { done: 11, target: 15 } }) }),
      ]));
    }
    expect(load).toHaveBeenCalledOnce();
  });

  it("reads one viewer measure privately, leaving the viewer's suggestions and the post's interactions intact", async () => {
    const author = await person(), viewer = await person();
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", viewer.id);
    await pair(author, viewer);
    const shared = await frozenLabPost(author);
    const input = insulinReading(8.1, new Date().toISOString().slice(0, 10));
    vi.spyOn(inputs, "readHealthWinInputs").mockResolvedValue({
      input: { ...input, sessions: Array.from({ length: 3 }, () => ({ date: input.member.today, type: "walk", minutes: 23 })) },
      sourceRevision: "fixture", complete: true, distanceArtUrl: null,
    });
    const suggestions = await wins(viewer.request("wins"));
    expect(suggestions.status).toBe(200);
    const before = await suggestions.json();
    expect(before.candidates).toHaveLength(1);
    const stored = () => db.healthWinSet.findMany({ where: { memberId: viewer.id } });
    const sealed = await stored();
    const presentation = () => db.healthWinNudge.findUniqueOrThrow({ where: { memberId: viewer.id } });
    const lastPresented = await presentation();
    const source = vi.spyOn(inputs, "readMeasureInputs").mockResolvedValue({ input, observed: true });
    const response = await shared.read(viewer);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    const measure = { key: "insulin", source: "labs", label: "insulin" };
    expect(result).toMatchObject({
      measure, reason: null, friend: { value: 3.4, unit: "µIU/mL" },
      card: { candidateId: "mine:insulin:percentile", measure: "insulin", specRevision: expect.stringMatching(/^[0-9a-f]{64}$/u),
        chart: { type: "percentile", value: 8.1 }, change_options: [{ id: "original" }, { id: "hide_numbers" }] },
    });
    expect(Object.keys(result.friend).sort()).toEqual(["unit", "value"]);
    source.mockResolvedValue({ input: { member: input.member }, observed: false });
    expect(await (await shared.read(viewer)).json()).toEqual({ measure, card: null, reason: "no_labs", friend: null });
    expect(await presentation()).toEqual(lastPresented);
    expect(await (await wins(viewer.request("wins"))).json()).toEqual(before);
    expect(await stored()).toEqual(sealed);
    const post = await db.healthPost.findUniqueOrThrow({ where: { id: shared.postId },
      select: { cheerPushClaimedAt: true, _count: { select: { cheers: true, comments: true } } } });
    expect(post).toEqual({ cheerPushClaimedAt: null, _count: { cheers: 0, comments: 0 } });
    expect(deferred).toHaveLength(0);
  });

  it("says when the viewer's own card for the measure is already in one of their posts", async () => {
    const author = await person(), viewer = await person();
    await pair(author, viewer);
    const shared = await frozenLabPost(author);
    const input = insulinReading(8.1, new Date().toISOString().slice(0, 10));
    vi.spyOn(inputs, "readMeasureInputs").mockResolvedValue({ input, observed: true });
    const first = await (await shared.read(viewer)).json();
    expect(first).toMatchObject({ card: { candidateId: "mine:insulin:percentile" }, shared: false });
    const original = first.card.change_options.find((option: { id: string }) => option.id === "original");
    const posted = await post(viewer.request("posts", "POST", { id: randomUUID(),
      cards: [{ candidateId: first.card.candidateId, option: "original", specRevision: original.specRevision }] }));
    expect(posted.status).toBe(200);
    expect(await (await shared.read(viewer)).json()).toMatchObject({ card: { id: first.card.id }, shared: true });
  });

  it("opens only a visible partner's selected measure and rejects stale post versions after the replica read", async () => {
    const author = await person(), viewer = await person();
    await pair(author, viewer);
    const shared = await frozenLabPost(author);
    const hidden = await frozenLabPost(author, "hide_numbers");
    const source = vi.spyOn(inputs, "readMeasureInputs");
    expect((await shared.read(author)).status).toBe(400);
    expect((await hidden.read(viewer)).status).toBe(400);
    expect((await shared.read(viewer, "another-card")).status).toBe(404);
    await db.gameBlock.create({ data: { blockerMemberId: author.id, blockedMemberId: viewer.id } });
    expect((await shared.read(viewer)).status).toBe(404);
    await db.gameBlock.deleteMany({ where: { blockerMemberId: author.id } });
    await db.healthFeedHide.create({ data: { memberId: viewer.id, hiddenMemberId: author.id } });
    expect((await shared.read(viewer)).status).toBe(404);
    await db.healthFeedHide.deleteMany({ where: { memberId: viewer.id } });
    expect(source).not.toHaveBeenCalled();
    source.mockImplementationOnce(async (_auth, today) => {
      await db.healthPost.update({ where: { id: shared.postId }, data: { version: { increment: 1 } } });
      return { input: insulinReading(7.2, today), observed: true };
    });
    expect((await shared.read(viewer)).status).toBe(404);
    source.mockImplementationOnce(async (_auth, today) => {
      await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
      return { input: insulinReading(7.2, today), observed: true };
    });
    expect((await shared.read(viewer)).status).toBe(404);
    expect((await shared.read(viewer)).status).toBe(404);
    await recordHostedLaunchRequiredConsent({ memberId: author.id, scope: "launch.health-data", prisma: db });
    source.mockImplementationOnce(async (_auth, today) => {
      await revokeHostedConsentScope({ memberId: viewer.id, scope: "launch.health-data", prisma: db });
      return { input: insulinReading(7.2, today), observed: true };
    });
    expect((await shared.read(viewer)).status).toBe(404);
    await recordHostedLaunchRequiredConsent({ memberId: viewer.id, scope: "launch.health-data", prisma: db });
    await db.healthPost.update({ where: { id: shared.postId }, data: { deletedAt: new Date() } });
    expect((await shared.read(viewer)).status).toBe(404);
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("limits See yours across posts per viewer before opening content", async () => {
    const viewer = await person(), other = await person();
    const source = vi.spyOn(inputs, "readMeasureInputs");
    const missingPost = (who: Person) => {
      const id = randomUUID();
      return seeYours(who.request(`posts/${id}/see-yours?card=some-card`), context(id));
    };
    for (let n = 0; n < 10; n++) expect((await missingPost(viewer)).status).toBe(404);
    const limited = await missingPost(viewer);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
    expect((await missingPost(other)).status).toBe(404);
    expect(source).not.toHaveBeenCalled();
  });

  it("limits a payoff and its interactions to the two players across feed, profile, detail and photo reads", async () => {
    const poster = await person(), player = await person(), otherPartner = await person();
    const gameId = await pair(poster, player);
    await pair(poster, otherPartner);
    const id = randomUUID(), photoId = randomUUID(), commentId = randomUUID();
    const [storageKeyEncrypted] = await crypto.sealHealthTexts([{
      table: "health_post_attachment", memberId: poster.id, rowId: photoId, field: "storage_key", value: "synthetic-photo",
    }]);
    await db.healthPost.create({ data: { id, gameId, authorMemberId: poster.id,
      attachment: { create: { id: photoId, memberId: poster.id, storageKeyEncrypted, status: "published" } },
    } });
    const bytes = Uint8Array.of(20, 30, 40);
    readPhotoObject.mockReset().mockResolvedValue({ envelope: "synthetic-photo-envelope" });
    vi.spyOn(crypto, "openHealthPhoto").mockImplementation(async () => bytes.slice());
    const readFeed = async (who: Person) => (await feed(who.request("feed"))).json();
    const readProfile = async (who: Person) => (await profile(who.request(`people/${poster.id}/profile`), memberContext(poster.id))).json();
    const readPhoto = (who: Person) => photo(who.request(`photos/${photoId}`), context(photoId));
    const addCheer = (who: Person) => cheer(who.request(`posts/${id}/cheer`, "PUT"), context(id));
    const addComment = (who: Person) => comment(who.request(`posts/${id}/comments`, "POST", {
      id: commentId, body: "The blue ribbon arrived.",
    }), context(id));

    const openCards = vi.spyOn(crypto, "openHealthTexts");
    expect((await seeYours(otherPartner.request(`posts/${id}/see-yours?card=game:${gameId}`), context(id))).status).toBe(404);
    expect(openCards).not.toHaveBeenCalled();

    expect((await readFeed(otherPartner)).posts).toEqual([]);
    expect(await readProfile(otherPartner)).toMatchObject({ memberId: poster.id, posts: [] });
    expect((await readPost(otherPartner, id)).status).toBe(404);
    expect((await comments(otherPartner.request(`posts/${id}/comments`), context(id))).status).toBe(404);
    expect((await readPhoto(otherPartner)).status).toBe(404);
    expect(readPhotoObject).not.toHaveBeenCalled();
    expect((await addCheer(otherPartner)).status).toBe(404);
    expect((await addComment(otherPartner)).status).toBe(404);

    expect((await readFeed(player)).posts).toMatchObject([{ id }]);
    expect((await readProfile(player)).posts).toMatchObject([{ id }]);
    expect((await readPost(player, id)).status).toBe(200);
    const response = await readPhoto(player);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect((await addCheer(player)).status).toBe(204);
    expect((await addComment(player)).status).toBe(200);
    expect(await commentIds(player, id)).toEqual([commentId]);
    expect(await commentIds(poster, id)).toEqual([commentId]);
  });

  it("keeps the game audience on leave, block and game deletion, even with another shared game", async () => {
    const poster = await person(), player = await person(), id = randomUUID();
    const gameId = await pair(poster, player);
    await pair(poster, player);
    await db.healthPost.create({ data: { id, gameId, authorMemberId: poster.id } });
    const block = { blockerMemberId: player.id, blockedMemberId: poster.id };
    await db.gameBlock.create({ data: block });
    expect((await readPost(player, id)).status).toBe(404);
    await db.gameBlock.deleteMany({ where: block });
    expect((await readPost(player, id)).status).toBe(200);

    const seat = { gameId, memberId: player.id };
    const open = crypto.openHealthTexts;
    vi.spyOn(crypto, "openHealthTexts").mockImplementationOnce(async (...args) => {
      const result = await open(...args);
      await db.gamePlayer.updateMany({ where: seat, data: { leftAt: new Date() } });
      return result;
    });
    expect((await readPost(player, id)).status).toBe(404);
    expect((await (await feed(player.request("feed"))).json()).posts).toEqual([]);
    await db.gamePlayer.updateMany({ where: seat, data: { leftAt: null } });
    expect((await readPost(player, id)).status).toBe(200);
    await db.game.delete({ where: { id: gameId } });
    expect((await readPost(player, id)).status).toBe(404);
    expect((await readPost(poster, id)).status).toBe(200);
  });

  it("lists only the viewer's own hides newest first and removes an undone hide", async () => {
    const viewer = await person(), newest = await person(), oldest = await person(), other = await person();
    const stranger = await person();
    await pair(viewer, newest);
    await pair(viewer, oldest);
    await db.gameProfile.update({ where: { memberId: newest.id }, data: { photoKey: "fixture/portrait.jpg" } });
    await db.gameProfile.update({ where: { memberId: stranger.id }, data: { photoKey: "fixture/private.jpg" } });
    await db.healthFeedHide.createMany({ data: [
      { memberId: viewer.id, hiddenMemberId: oldest.id, createdAt: new Date("2026-03-05") },
      { memberId: other.id, hiddenMemberId: viewer.id, createdAt: new Date("2026-03-07") },
      { memberId: viewer.id, hiddenMemberId: newest.id, createdAt: new Date("2026-03-06") },
      { memberId: viewer.id, hiddenMemberId: stranger.id, createdAt: new Date("2026-03-04") },
    ] });
    const read = () => listHides(viewer.request("hides?memberId=" + other.id));
    const response = await read();
    expect(response.status).toBe(200);
    const oldestIdentity = { memberId: oldest.id, firstName: "Finch", avatarUrl: null };
    const unnamed = { memberId: stranger.id, firstName: null, avatarUrl: null };
    expect(await response.json()).toEqual({ people: [
      { memberId: newest.id, firstName: "Finch", avatarUrl: "/api/game/v1/media/fixture%2Fportrait.jpg" },
      oldestIdentity, unnamed,
    ] });
    const open = gameCrypto.openGameTexts;
    vi.spyOn(gameCrypto, "openGameTexts").mockImplementationOnce(async (...args) => {
      const result = await open(...args);
      expect((await unhide(viewer.request("hides/" + newest.id, "DELETE"), memberContext(newest.id))).ok).toBe(true);
      await db.healthFeedHide.create({ data: { memberId: oldest.id, hiddenMemberId: viewer.id } });
      return result;
    });
    expect(await (await read()).json()).toEqual({ people: [
      { memberId: oldest.id, firstName: null, avatarUrl: null }, unnamed,
    ] });
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", other.id);
    expect((await read()).status).toBe(404);
  });

  it("admits hides for visible commenters without exposing inaccessible people through Settings", async () => {
    const viewer = await person(), poster = await person(), commenter = await person(), stranger = await person();
    await pair(viewer, poster);
    await pair(poster, commenter);
    const postId = await share(poster);
    const addComment = async (visibility: "poster" | "everyone") => {
      const id = randomUUID();
      expect((await comment(commenter.request(`posts/${postId}/comments`, "POST", {
        id, visibility, body: "Made time for the trail.",
      }), context(postId))).status).toBe(200);
      return id;
    };
    const set = async (id: string) => {
      const response = await hide(viewer.request("hides/" + id, "PUT"), memberContext(id));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hidden: true });
    };
    const read = async () => (await listHides(viewer.request("hides"))).json();
    await addComment("poster");
    for (const id of [stranger.id, randomUUID(), commenter.id]) await set(id);
    expect(await read()).toEqual({ people: [] });
    const publicId = await addComment("everyone");
    await set(commenter.id);
    await set(commenter.id);
    expect(await read()).toEqual({ people: [{ memberId: commenter.id, firstName: "Finch", avatarUrl: null }] });
    expect((await deleteComment(commenter.request("comments/" + publicId, "DELETE"), context(publicId))).status).toBe(204);
    expect(await read()).toEqual({ people: [{ memberId: commenter.id, firstName: null, avatarUrl: null }] });
    expect((await unhide(viewer.request("hides/" + commenter.id, "DELETE"), memberContext(commenter.id))).status).toBe(200);
    expect(await read()).toEqual({ people: [] });
  });

  it("identifies refused activity names on writes and preserves a committed post's receipt", async () => {
    const author = await person();
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", author.id);
    const id = randomUUID(), path = `activities/${id}`;
    const summary = { id, kind: "other", startedAt: "2037-10-02T11:20:00Z", movingSec: 214, elapsedSec: 230 };
    const save = (activity: object) => saveActivity(author.request(path, "PUT", { activity }), context(id));

    const refused = await save({ ...summary, name: "Ghost pepper relay" });
    expect(refused.status).toBe(400);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
    expect(await refused.json()).toMatchObject({ error: { code: "HEALTH_ACTIVITY_NAME_INVALID" } });
    const malformed = await save({ ...summary, name: "Hoop relay", elapsedSec: -1 });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(await db.healthActivity.count({ where: { id } })).toBe(0);
    expect(await (await save(summary)).json()).toEqual({ id });

    const activity = { ...summary, id: randomUUID(), name: "Hoop relay" };
    const postId = randomUUID();
    const publish = (id: string) => post(author.request("posts", "POST", { id, activity, caption: "Relay practice" }));
    const receipt = { id: postId, version: 1 };
    expect(await (await publish(postId)).json()).toEqual(receipt);
    vi.spyOn(moderation, "isGameTextRefused").mockReturnValue(true);
    const denied = await publish(randomUUID());
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: { code: "HEALTH_ACTIVITY_NAME_INVALID" } });
    const replay = await publish(postId);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);
  });

  it("advertises route recording to the author and shares the number-free map with a partner", async () => {
    const author = await person(), partner = await person();
    await pair(author, partner);
    vi.stubEnv("MURPH_HEALTH_PAINTED_RUNS", "false");
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", [author.id, partner.id].join(","));
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", author.id);
    const readFeed = async (viewer: Person) => (await feed(viewer.request("feed"))).json();
    expect((await readFeed(author)).record).toEqual({ timed: true, route: true, named: true });
    expect((await readFeed(partner)).record).toEqual({ timed: true, route: false, named: true });

    const paths = [encodePolyline([[-141.2, -32.4], [-141.199, -32.4]])];
    const activity = {
      id: randomUUID(), kind: "walk", startedAt: "2032-04-12T19:18:00Z", movingSec: 622, elapsedSec: 637,
      heartRate: { lowBpm: 92, avgBpm: 104, peakBpm: 121, perMinute: Array(11).fill(null) },
      route: { distanceM: 1000, climbM: 6, splits: [{ distanceM: 1000, seconds: 622 }], paths },
    };
    const preview = await previewActivity(author.request("activities/cards", "POST", { activity }));
    expect(preview.status).toBe(200);
    const { cards } = await preview.json();
    const map = cards.find((card: { kind: string }) => card.kind === "activity_route");
    expect(map.chart.stats?.map((stat: { label: string }) => stat.label)).not.toContain("Heart rate");
    const choice = map.change_options.find((option: { id: string }) => option.id === "hide_numbers");
    const id = randomUUID();
    const pick = { candidateId: map.candidateId, option: choice.id, specRevision: choice.specRevision };
    const publish = (specRevision = pick.specRevision) =>
      post(author.request("posts", "POST", { id, activity, cards: [{ ...pick, specRevision }] }));
    const stale = await publish("a".repeat(64));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("HEALTH_ACTIVITY_CARD_CHANGED");
    const receipt = await publish();
    expect(receipt.status).toBe(200);
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", "");
    expect((await previewActivity(author.request("activities/cards", "POST", { activity }))).status).toBe(404);
    expect(await (await publish()).json()).toEqual(await receipt.json());
    const shared = await readPost(partner, id);
    expect(shared.status).toBe(200);
    expect((await shared.json()).post.cards).toEqual([{ id: map.candidateId, specRevision: choice.specRevision,
      spec: { ...choice.spec, chart: { ...choice.spec.chart, art: { key: expect.stringMatching(/^area:v2:/u) } } } }]);
    expect(choice.spec.chart).toEqual({ type: "route_map", paths, frame: map.chart.frame });
    expect(map.chart).not.toHaveProperty("art");
    expect(deferred).toHaveLength(0);
  });

  it.each(["removed map", "deleted post", "withdrawn before claim", "withdrawn before painting", "admission read failed", "retained map"] as const)(
    "rechecks post and consent after the route post commits: %s", async change => {
      const author = await person();
      vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", author.id);
      vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", author.id);
      vi.stubEnv("MURPH_HEALTH_PAINTED_RUNS", "true");
      const activity = {
        id: randomUUID(), kind: "walk", startedAt: "2033-06-15T09:00:00Z", movingSec: 532, elapsedSec: 540,
        route: { distanceM: 1000, climbM: 0, splits: [{ distanceM: 1000, seconds: 532 }],
          paths: [encodePolyline([[-132, -41], [-131.999, -41]])] },
      };
      const preview = await previewActivity(author.request("activities/cards", "POST", { activity }));
      const { cards } = await preview.json();
      const map = cards.find((card: { kind: string }) => card.kind === "activity_route");
      const choice = map.change_options.find((option: { id: string }) => option.id === "hide_numbers");
      expect(map.chart).not.toHaveProperty("art");
      expect(choice.spec.chart).not.toHaveProperty("art");
      expect(deferred).toHaveLength(0);
      const body = { id: randomUUID(), activity, caption: "An ocean fixture", cards: [
        { candidateId: map.candidateId, option: choice.id, specRevision: choice.specRevision },
      ] };
      const photo = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#125c8c" } }).png().toBuffer();
      vi.stubEnv("OPENAI_API_KEY", "fixture-image-service");
      vi.stubEnv("MAPBOX_ACCESS_TOKEN", "fixture-basemap");
      const providers: string[] = [];
      vi.stubGlobal("fetch", async (input: URL | RequestInfo) => {
        const url = new URL(input instanceof Request ? input.url : input);
        // The image SDK probes local FormData support before its first multipart request.
        if (url.href === "data:,") return new Response("");
        providers.push(url.hostname);
        if (url.origin === "https://api.mapbox.com") {
          if (change === "withdrawn before painting") {
            await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
          }
          return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/png" } });
        }
        if (url.href === "https://api.openai.com/v1/images/edits") {
          return Response.json({ data: [{ b64_json: photo.toString("base64") }] });
        }
        throw new Error("Unexpected provider in painting test.");
      });
      const publish = () => post(author.request("posts", "POST", body));
      expect((await publish()).status).toBe(200);
      expect((await publish()).status).toBe(200);
      expect(deferred).toHaveLength(1);
      const published = await (await readPost(author, body.id)).json();
      const key: string = published.post.cards[0].spec.chart.art.key;
      areaKeys.push(key);
      const painting = () => readArt(author.request("art"), { params: Promise.resolve({ key }) });
      expect((await painting()).status).toBe(404);
      expect(providers).toEqual([]);

      const path = `posts/${body.id}`;
      if (change === "deleted post") {
        expect((await deletePost(author.request(path, "DELETE"), context(body.id))).status).toBe(204);
      } else if (change === "withdrawn before claim") {
        await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
      } else if (change === "removed map" || change === "retained map") {
        const update = change === "removed map" ? { removeCardIds: [map.candidateId] } : { caption: "Revised fixture" };
        expect((await editPost(author.request(path, "PATCH", { expectedVersion: 1, ...update }), context(body.id))).status).toBe(200);
      }
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      if (change === "admission read failed") {
        vi.spyOn(audience, "findVisibleHealthPost").mockRejectedValueOnce(new TypeError("Synthetic private payload", { cause: key }));
      }
      const day = new Date(new Date().toISOString().slice(0, 10));
      const budget = async () => (await db.gamePlaceArtBudget.findUnique({ where: { day } }))?.attempts ?? 0;
      const before = await budget();
      // The first callback claims the key and registers the painter with after().
      for (const task of deferred) await task();
      if (change === "admission read failed") {
        expect(log).toHaveBeenCalledExactlyOnceWith("Health wins area painting failed.", { errorClass: "TypeError" });
      } else {
        expect(log).not.toHaveBeenCalled();
      }
      const response = await painting();
      if (change === "retained map") {
        expect(providers).toEqual(["api.mapbox.com", "api.openai.com"]);
        expect(response.status).toBe(200);
        expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({
          format: "jpeg", width: 768, height: 512,
        });
      } else {
        expect(providers).toEqual(change === "withdrawn before painting" ? ["api.mapbox.com"] : []);
        expect(response.status).toBe(404);
        const row = await db.gamePlaceArt.findUnique({ where: { key }, select: { status: true, attempts: true, failureCode: true } });
        if (change === "withdrawn before painting") {
          expect(row).toEqual({ status: "available", attempts: 0, failureCode: null });
          expect(await budget()).toBe(before);
          expect(await db.gameAreaArtMemberBudget.findUnique({ where: { memberId: author.id } })).toMatchObject({ attempts: 0 });
          expect(await claimArt(key, "map", new Date(), undefined, author.id)).not.toBeNull();
        } else {
          expect(row).toBeNull();
        }
      }
    },
  );

  it("shows a frozen recorded chart to existing game partners and closes it after consent withdrawal", async () => {
    const author = await person(), partner = await person(), stranger = await person();
    await pair(author, partner);
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", author.id);
    const activity = {
      id: randomUUID(), kind: "cold_plunge", startedAt: "2031-06-12T15:34:00Z",
      elapsedSec: 189, movingSec: 163, heartRate: { lowBpm: 83, avgBpm: 94, peakBpm: 109, perMinute: [90, 95, null, 97] },
    };
    const preview = await previewActivity(author.request("activities/cards", "POST", { activity }));
    expect(preview.status).toBe(200);
    const { cards: [card] } = await preview.json();
    const pick = { candidateId: card.candidateId, specRevision: card.specRevision, option: "original" };
    const body = { id: randomUUID(), activity, cards: [pick] };
    expect((await post(author.request("posts", "POST", body))).status).toBe(200);
    const shared = await readPost(partner, body.id);
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({ post: { cards: [{
      id: pick.candidateId, specRevision: pick.specRevision,
      spec: { kind: "activity_heart_rate", chart: { type: "heart_rate", perMinute: activity.heartRate.perMinute } },
    }] } });
    expect((await readPost(stranger, body.id)).status).toBe(404);
    await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
    expect((await readPost(partner, body.id)).status).toBe(404);
    const own = await readPost(author, body.id);
    expect(own.status).toBe(200);
    expect((await own.json()).post).toEqual({ id: body.id, createdAt: expect.any(String), version: 1 });
  });

  it("admits current partners and removes posts in both directions after a hide or block", async () => {
    const author = await person(), partner = await person(), stranger = await person();
    await pair(author, partner);
    const own = await share(author), other = await share(partner);
    expect((await readPost(partner, own)).status).toBe(200);
    expect((await readPost(stranger, own)).status).toBe(404);
    const profileOfAuthor = (viewer: Person) => profile(viewer.request("people/" + author.id + "/profile"), memberContext(author.id));
    vi.spyOn(board, "readPairBoard").mockRejectedValueOnce(new Error("Synthetic board failure"));
    expect(await (await profileOfAuthor(partner)).json()).toMatchObject({ memberId: author.id, numbers: null, posts: [{ id: own }] });
    expect((await profileOfAuthor(stranger)).status).toBe(404);

    const target = memberContext(partner.id);
    expect((await hide(author.request("hides/" + partner.id, "PUT"), target)).ok).toBe(true);
    expect((await readPost(partner, own)).status).toBe(404);
    expect((await readPost(author, other)).status).toBe(404);
    expect((await profileOfAuthor(partner)).status).toBe(404);
    expect((await unhide(author.request("hides/" + partner.id, "DELETE"), target)).ok).toBe(true);
    expect((await readPost(partner, own)).status).toBe(200);

    await db.gameBlock.create({ data: { blockerMemberId: partner.id, blockedMemberId: author.id } });
    expect((await readPost(partner, own)).status).toBe(404);
    expect((await readPost(author, other)).status).toBe(404);
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", partner.id);
    expect((await feed(author.request("feed"))).status).toBe(404);
  });

  it.each(["left game", "withdrawn consent"] as const)("rechecks after opening the page when the author has %s", async change => {
    const author = await person(), viewer = await person();
    const gameId = await pair(author, viewer);
    const id = await share(author);
    const open = crypto.openHealthTexts;
    let changed = false;
    vi.spyOn(crypto, "openHealthTexts").mockImplementation(async (...args) => {
      const values = await open(...args);
      if (!changed && args[0].some(entry => entry.rowId === id)) {
        changed = true;
        if (change === "left game") {
          await db.gamePlayer.updateMany({ where: { gameId, memberId: author.id }, data: { leftAt: new Date() } });
        } else {
          await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
        }
      }
      return values;
    });
    const response = await feed(viewer.request("feed"));
    expect(changed).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ posts: [] });
    expect((await readPost(viewer, id)).status).toBe(404);
    expect((await deletePost(author.request("posts/" + id, "DELETE"), context(id))).status).toBe(204);
    expect(await db.healthPost.findUnique({ where: { id } })).toMatchObject({ deletedAt: expect.any(Date), captionEncrypted: null });
  });

  it("returns 404 for a hidden parent without reading its comment history", async () => {
    const poster = await person(), reader = await person();
    await pair(poster, reader);
    const postId = await share(poster);
    await db.$executeRaw`INSERT INTO health_post_comment (id, post_id, author_member_id, body_encrypted)
      SELECT gen_random_uuid(), ${postId}::uuid, ${poster.id}, 'unopened-fixture' FROM generate_series(1, 1024)`;
    await db.healthFeedHide.create({ data: { memberId: poster.id, hiddenMemberId: reader.id } });

    const query = vi.spyOn(db, "$queryRaw");
    const opening = vi.spyOn(crypto, "openHealthTexts");
    const response = await comments(reader.request(`posts/${postId}/comments`), context(postId));
    expect(response.status).toBe(404);
    const statements = query.mock.calls.map(([sql]) => "sql" in sql ? sql.sql : sql.join(" "));
    expect(statements.some(sql => /\bhealth_post\b/u.test(sql))).toBe(true);
    expect(statements.some(sql => /\bhealth_post_comment\b/u.test(sql))).toBe(false);
    expect(opening).not.toHaveBeenCalled();
  });

  it.each(["poster", "commenter"] as const)("rechecks comments when the %s withdraws consent during opening", async role => {
    const poster = await person(), commenter = await person(), reader = await person();
    await pair(poster, reader);
    await pair(poster, commenter);
    const postId = await share(poster), id = randomUUID();
    expect((await comment(commenter.request(`posts/${postId}/comments`, "POST", {
      id, body: "Synthetic comment for the access check.",
    }), context(postId))).status).toBe(200);
    const open = crypto.openHealthTexts;
    const opening = vi.spyOn(crypto, "openHealthTexts").mockImplementationOnce(async (...args) => {
      expect(args[0].map(entry => entry.rowId)).toEqual([id]);
      const bodies = await open(...args);
      await revokeHostedConsentScope({ memberId: role === "poster" ? poster.id : commenter.id, scope: "launch.health-data", prisma: db });
      return bodies;
    });

    const response = await comments(reader.request(`posts/${postId}/comments`), context(postId));
    expect(opening).toHaveBeenCalledOnce();
    expect(response.status).toBe(role === "poster" ? 404 : 200);
    if (role === "commenter") expect(await response.json()).toEqual({ comments: [], ancestors: [], nextCursor: null });
  });

  it("shows poster-only comments to their two participants and respects commenter hides and blocks", async () => {
    const author = await person(), commenter = await person(), reader = await person();
    await pair(author, commenter);
    await pair(author, reader);
    const postId = await share(author);
    const ids = { everyone: randomUUID(), poster: randomUUID() };
    for (const visibility of ["everyone", "poster"] as const) {
      const result = await comment(commenter.request(`posts/${postId}/comments`, "POST", {
        id: ids[visibility], visibility, body: "That sounds peaceful.",
      }), context(postId));
      expect(result.status).toBe(200);
    }
    expect(new Set(await commentIds(author, postId))).toEqual(new Set(Object.values(ids)));
    expect(new Set(await commentIds(commenter, postId))).toEqual(new Set(Object.values(ids)));
    expect(await commentIds(reader, postId)).toEqual([ids.everyone]);

    await db.healthFeedHide.create({ data: { memberId: commenter.id, hiddenMemberId: reader.id } });
    expect(await commentIds(reader, postId)).toEqual([]);
    await db.healthFeedHide.delete({ where: { memberId_hiddenMemberId: { memberId: commenter.id, hiddenMemberId: reader.id } } });
    await db.gameBlock.create({ data: { blockerMemberId: reader.id, blockedMemberId: commenter.id } });
    expect(await commentIds(reader, postId)).toEqual([]);
    await db.game.deleteMany({ where: { id: { in: games } } });
    await db.hostedMember.delete({ where: { id: commenter.id } });
    expect(await db.healthPostComment.count({ where: { postId } })).toBe(0);
    expect(await db.healthPost.count({ where: { id: postId } })).toBe(1);
  });

  it("keeps a poster's answer with its recipient after the original is removed", async () => {
    const poster = await person("Velpin"), recipient = await person("Rulven"), peer = await person();
    const sharedGame = await pair(poster, recipient);
    await pair(poster, peer);
    const postId = await share(poster);
    const source = await addComment(recipient, postId, { visibility: "poster" });
    const reply = await addComment(poster, postId, { replyTo: source, visibility: "everyone" });
    const publicComment = await addComment(poster, postId);
    const expectedReply = { id: reply, authorMemberId: poster.id, firstName: "Velpin", visibility: "poster",
      recipientMemberId: recipient.id, recipientFirstName: "Rulven" };
    for (const viewer of [poster, recipient]) {
      const rows = await readComments(viewer, postId);
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining(expectedReply),
        expect.objectContaining({ id: source, visibility: "poster", recipientMemberId: null, recipientFirstName: null }),
        expect.objectContaining({ id: publicComment, visibility: "everyone", recipientMemberId: null, recipientFirstName: null }),
      ]));
    }
    expect(await commentIds(peer, postId)).toEqual([publicComment]);

    expect((await deleteComment(recipient.request("comments/" + source, "DELETE"), context(source))).status).toBe(204);
    const replay = await submitComment(poster, postId, reply, { replyTo: source });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id: reply });
    for (const viewer of [poster, recipient]) {
      const rows = await readComments(viewer, postId);
      expect(rows).toHaveLength(2);
      expect(rows.find(row => row.id === reply)).toMatchObject(expectedReply);
    }
    expect(await commentIds(peer, postId)).toEqual([publicComment]);

    await db.game.delete({ where: { id: sharedGame } });
    await db.hostedMember.delete({ where: { id: recipient.id } });
    expect(await db.healthPostComment.findUnique({ where: { id: reply } })).toBeNull();
    expect(await commentIds(poster, postId)).toEqual([publicComment]);
  });

  it("rejects ineligible reply targets and refuses to replay a different audience", async () => {
    const poster = await person(), recipient = await person(), peer = await person();
    await pair(poster, recipient);
    await pair(poster, peer);
    const postId = await share(poster), otherPostId = await share(poster);
    const source = await addComment(recipient, postId, { visibility: "poster" });
    const otherRecipient = await addComment(peer, postId, { visibility: "poster" });
    const foreign = await addComment(recipient, otherPostId, { visibility: "poster" });
    const own = await addComment(poster, postId, { visibility: "poster" });
    const reply = await addComment(poster, postId, { replyTo: source });
    const denied = async (who: Person, replyTo: string) => {
      const id = randomUUID();
      const response = await submitComment(who, postId, id, { replyTo });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "HEALTH_NOT_FOUND" } });
      expect(await db.healthPostComment.findUnique({ where: { id } })).toBeNull();
    };
    await denied(recipient, source);
    await denied(peer, source);
    for (const target of [foreign, own, reply, randomUUID()]) await denied(poster, target);
    for (const response of [
      await submitComment(poster, postId, own, { replyTo: source }),
      await submitComment(poster, postId, reply),
      await submitComment(poster, postId, reply, { replyTo: otherRecipient }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "HEALTH_WRITE_CONFLICT" } });
    }
    expect(await commentIds(peer, postId)).not.toContain(reply);
    expect(await commentIds(recipient, postId)).not.toContain(own);

    await db.healthFeedHide.create({ data: { memberId: recipient.id, hiddenMemberId: poster.id } });
    await denied(poster, source);
    await db.healthFeedHide.deleteMany({ where: { memberId: recipient.id } });
    expect((await deleteComment(recipient.request("comments/" + source, "DELETE"), context(source))).status).toBe(204);
    await denied(poster, source);
  });

  it("fans out public replies from the winning insert and deduplicates the poster and parent author", async () => {
    const poster = await person(), writer = await person(), peer = await person();
    await pair(poster, writer);
    await pair(poster, peer);
    const postId = await share(poster);
    const pushes = await captureCommentPushes([poster, writer, peer]);
    const parent = await addComment(writer, postId);
    await pushes(postId, parent, [[poster, "comment"]]);

    const id = randomUUID();
    expect((await submitComment(peer, postId, id, { replyTo: parent, visibility: "poster" })).status).toBe(400);
    expect(await db.healthPostComment.count({ where: { id } })).toBe(0);
    const send = () => submitComment(peer, postId, id, { replyTo: parent });
    expect((await Promise.all([send(), send()])).map(response => response.status)).toEqual([200, 200]);
    expect(await db.healthPostComment.findUniqueOrThrow({ where: { id } })).toMatchObject({
      parentCommentId: parent, visibility: "everyone", recipientMemberId: null,
    });
    await pushes(postId, id, [[poster, "comment"], [writer, "reply"]]);
    expect((await submitComment(peer, postId, id, { replyTo: parent, visibility: "poster" })).status).toBe(400);
    const self = await addComment(writer, postId, { replyTo: parent });
    await pushes(postId, self, [[poster, "comment"]]);
    const answer = await addComment(poster, postId, { replyTo: parent });
    await pushes(postId, answer, [[writer, "reply"]]);
    const followup = await addComment(peer, postId, { replyTo: answer });
    await pushes(postId, followup, [[poster, "reply"]]);

    const revoked = await addComment(peer, postId, { replyTo: parent });
    await db.healthFeedHide.create({ data: { memberId: writer.id, hiddenMemberId: peer.id } });
    await pushes(postId, revoked, [[poster, "comment"]]);
    const withdrawn = await addComment(poster, postId, { replyTo: parent });
    expect((await deleteComment(poster.request("comments/" + withdrawn, "DELETE"), context(withdrawn))).status).toBe(204);
    await pushes(postId, withdrawn, []);
    const removedPost = await addComment(peer, postId, { replyTo: answer });
    expect((await deletePost(poster.request("posts/" + postId, "DELETE"), context(postId))).status).toBe(204);
    await pushes(postId, removedPost, []);
  });

  it("alternates a private thread between its participants and rechecks the recipient before each push", async () => {
    const poster = await person(), friend = await person(), peer = await person();
    await pair(poster, friend);
    await pair(poster, peer);
    const postId = await share(poster);
    const pushes = await captureCommentPushes([poster, friend, peer]);
    const root = await addComment(friend, postId, { visibility: "poster" });
    await pushes(postId, root, [[poster, "comment"]]);
    const answer = await addComment(poster, postId, { replyTo: root, visibility: "everyone" });
    expect((await deleteComment(friend.request("comments/" + root, "DELETE"), context(root))).status).toBe(204);
    await pushes(postId, answer, [[friend, "reply"]]);
    const followup = await addComment(friend, postId, { replyTo: answer });
    await pushes(postId, followup, [[poster, "reply"]]);
    for (const actor of [poster, peer]) expect((await submitComment(actor, postId, randomUUID(), { replyTo: answer })).status).toBe(404);
    for (const actor of [friend, peer]) expect((await submitComment(actor, postId, randomUUID(), { replyTo: followup })).status).toBe(404);
    const last = await addComment(poster, postId, { replyTo: followup });
    for (const who of [poster, friend]) {
      const page = await commentPage(who, postId);
      expect(page.comments).toMatchObject([
        { id: last, parentId: followup, visibility: "poster", recipientMemberId: friend.id },
        { id: followup, parentId: answer, visibility: "poster", recipientMemberId: null },
        { id: answer, parentId: root, visibility: "poster", recipientMemberId: friend.id },
      ]);
      expect(page.ancestors).toEqual([{ id: root, parentId: null, postId, deleted: true, createdAt: expect.any(String) }]);
    }
    expect(await commentPage(peer, postId)).toEqual({ comments: [], ancestors: [], nextCursor: null });
    await db.healthFeedHide.create({ data: { memberId: friend.id, hiddenMemberId: poster.id } });
    await pushes(postId, last, []);
  });

  it("preserves old unlinked private receipts after withdrawal and binds new receipts to the exact parent", async () => {
    const poster = await person(), friend = await person();
    await pair(poster, friend);
    const postId = await share(poster);
    const source = await addComment(friend, postId, { visibility: "poster" });
    const other = await addComment(friend, postId, { visibility: "poster" });
    const pushes = await captureCommentPushes([poster, friend]);
    const id = await addComment(poster, postId, { replyTo: source });
    expect((await submitComment(poster, postId, id, { replyTo: other })).status).toBe(409);
    // Model a rolling-deploy writer that stored only the recipient and claimed the push.
    await db.healthPostComment.update({ where: { id }, data: { parentCommentId: null } });
    expect((await submitComment(poster, postId, id, { replyTo: source })).status).toBe(200);
    await pushes(postId, id, [[friend, "reply"]]);
    expect((await deleteComment(friend.request("comments/" + source, "DELETE"), context(source))).status).toBe(204);
    const replay = await submitComment(poster, postId, id, { replyTo: source, visibility: "everyone" });
    expect(await replay.json()).toEqual({ id });
    expect(await db.healthPostComment.findUniqueOrThrow({ where: { id } })).toMatchObject({ parentCommentId: null });
    await pushes(postId, id, []);
  });

  it("returns only structural keys for consecutive unavailable ancestors and drops them with the last descendant", async () => {
    const poster = await person(), first = await person(), second = await person(), reader = await person();
    for (const friend of [first, second, reader]) await pair(poster, friend);
    const postId = await share(poster);
    const root = await addComment(first, postId);
    const middle = await addComment(second, postId, { replyTo: root });
    const leaf = await addComment(poster, postId, { replyTo: middle });
    expect((await deleteComment(first.request("comments/" + root, "DELETE"), context(root))).status).toBe(204);
    await db.healthFeedHide.create({ data: { memberId: reader.id, hiddenMemberId: second.id } });
    const open = crypto.openHealthTexts;
    const bodies = vi.spyOn(crypto, "openHealthTexts");
    const identities = vi.spyOn(gameCrypto, "openGameTexts");
    const page = await commentPage(reader, postId);
    expect(page.comments.map(row => row.id)).toEqual([leaf]);
    expect(page.ancestors).toEqual([
      { id: middle, postId, parentId: root, createdAt: expect.any(String), hidden: true },
      { id: root, postId, parentId: null, createdAt: expect.any(String), deleted: true },
    ]);
    expect(bodies.mock.calls.flatMap(([entries]) => entries.map(entry => entry.rowId))).toEqual([leaf]);
    expect(identities.mock.calls.flatMap(([entries]) => entries.map(entry => entry.memberId))).toEqual([poster.id]);
    bodies.mockImplementationOnce(async (...args) => {
      const values = await open(...args);
      await db.healthPostComment.update({ where: { id: leaf }, data: { deletedAt: new Date(), bodyEncrypted: null } });
      return values;
    });
    expect(await commentPage(reader, postId)).toEqual({ comments: [], ancestors: [], nextCursor: null });
  });

  it.each(["hidden", "deleted"] as const)("replaces a parent that becomes %s during opening with a sparse ancestor", async reason => {
    const poster = await person(), writer = await person(), reader = await person();
    await pair(poster, writer);
    await pair(poster, reader);
    const postId = await share(poster);
    const parent = await addComment(writer, postId);
    const child = await addComment(reader, postId, { replyTo: parent });
    const open = crypto.openHealthTexts;
    vi.spyOn(crypto, "openHealthTexts").mockImplementationOnce(async (...args) => {
      const values = await open(...args);
      if (reason === "hidden") await db.healthFeedHide.create({ data: { memberId: reader.id, hiddenMemberId: writer.id } });
      else await db.healthPostComment.update({ where: { id: parent }, data: { deletedAt: new Date(), bodyEncrypted: null } });
      return values;
    });
    const page = await commentPage(reader, postId);
    expect(page.comments.map(row => row.id)).toEqual([child]);
    expect(page.ancestors).toEqual([{ id: parent, postId, parentId: null, createdAt: expect.any(String), [reason]: true }]);
  });

  it("detaches surviving public replies on account erasure and retains the post cascade", async () => {
    const poster = await person(), writer = await person(), friend = await person();
    const shared = await pair(poster, writer);
    await pair(poster, friend);
    const postId = await share(poster);
    const root = await addComment(writer, postId);
    const child = await addComment(friend, postId, { replyTo: root });
    const leaf = await addComment(poster, postId, { replyTo: child });
    await db.game.delete({ where: { id: shared } });
    await db.hostedMember.delete({ where: { id: writer.id } });
    const page = await commentPage(friend, postId);
    expect(page.comments).toMatchObject([{ id: leaf, parentId: child }, { id: child, parentId: null }]);
    expect(page.ancestors).toEqual([]);
    expect((await submitComment(friend, postId, child, { replyTo: root })).status).toBe(409);
    await db.healthPost.delete({ where: { id: postId } });
    expect(await db.healthPostComment.count({ where: { postId } })).toBe(0);
  });

  it("serializes a new reply with withdrawal of its parent", async () => {
    const poster = await person(), friend = await person();
    await pair(poster, friend);
    const postId = await share(poster);
    const parent = await addComment(friend, postId), id = randomUUID();
    const [reply, removal] = await Promise.all([
      submitComment(poster, postId, id, { replyTo: parent }),
      deleteComment(friend.request("comments/" + parent, "DELETE"), context(parent)),
    ]);
    expect(removal.status).toBe(204);
    expect([200, 404]).toContain(reply.status);
    const page = await commentPage(poster, postId);
    expect(page.comments.map(row => row.id)).toEqual(reply.ok ? [id] : []);
    expect(page.ancestors).toEqual(reply.ok ? [{ id: parent, parentId: null, postId, createdAt: expect.any(String), deleted: true }] : []);
  });

  it("pages tied timestamps beyond 300 and adds readable off-page ancestors without changing legacy cursors", async () => {
    const poster = await person(), postId = await share(poster);
    const ids = Array.from({ length: 303 }, () => randomUUID()).sort().reverse();
    const createdAt = new Date();
    const sealed = await crypto.sealHealthTexts(ids.map(rowId => ({
      memberId: poster.id, table: "health_post_comment", rowId, field: "body", value: "Synthetic page entry",
    })));
    const root = ids[302], middle = ids[301];
    await db.healthPostComment.createMany({ data: ids.map((id, index) => ({
      id, postId, authorMemberId: poster.id, createdAt, bodyEncrypted: sealed[index],
      parentCommentId: index < 2 ? middle : id === middle ? root : null,
    })) });
    const page = await commentPage(poster, postId);
    expect(page.comments.map(row => row.id)).toEqual(ids.slice(0, 20));
    expect(page.ancestors).toMatchObject([
      { id: middle, parentId: root, body: "Synthetic page entry", authorMemberId: poster.id },
      { id: root, parentId: null, body: "Synthetic page entry", authorMemberId: poster.id },
    ]);
    // Issue a cursor using the pre-thread wire format and resume through the live route.
    const collection = "comments:" + postId;
    const [legacy] = await crypto.sealHealthTexts([{ memberId: poster.id, table: "health_post", rowId: collection,
      field: "page_cursor", value: [collection, createdAt.toISOString(), ids[19]].join("|") }]);
    let cursor: string | null = Buffer.from(legacy).toString("base64url");
    const chronological = page.comments.map(row => row.id).reverse();
    expect(page.nextCursor).toEqual(expect.any(String));
    while (cursor) {
      const next = await commentPage(poster, postId, cursor);
      expect(next.comments.map(row => row.id)).toEqual(ids.slice(chronological.length, chronological.length + 20));
      chronological.unshift(...next.comments.map(row => row.id).reverse());
      cursor = next.nextCursor;
    }
    expect(chronological).toEqual([...ids].reverse());
  });

  it("masks a recipient's name when access changes while the poster opens a private reply", async () => {
    const poster = await person(), recipient = await person("Eldriq");
    await pair(poster, recipient);
    const postId = await share(poster);
    const source = await addComment(recipient, postId, { visibility: "poster" });
    const reply = await addComment(poster, postId, { replyTo: source });
    expect((await deleteComment(recipient.request("comments/" + source, "DELETE"), context(source))).status).toBe(204);

    const open = gameCrypto.openGameTexts;
    const opening = vi.spyOn(gameCrypto, "openGameTexts").mockImplementation(async (...args) => {
      const result = await open(...args);
      if (args[0].some(entry => entry.memberId === recipient.id && entry.value)) {
        await db.healthFeedHide.create({ data: { memberId: recipient.id, hiddenMemberId: poster.id } });
      }
      return result;
    });
    const expected = [expect.objectContaining({ id: reply, recipientMemberId: recipient.id, recipientFirstName: null })];
    expect(await readComments(poster, postId)).toEqual(expected);
    expect(opening.mock.calls.flatMap(([entries]) => entries)).toContainEqual(
      expect.objectContaining({ memberId: recipient.id, field: "first_name", value: expect.any(String) }),
    );
    opening.mockClear();
    expect(await readComments(poster, postId)).toEqual(expected);
    expect(opening.mock.calls.flatMap(([entries]) => entries)).not.toContainEqual(
      expect.objectContaining({ memberId: recipient.id, field: "first_name", value: expect.any(String) }),
    );
    expect((await comments(recipient.request(`posts/${postId}/comments`), context(postId))).status).toBe(404);
  });

  it("rechecks the commenter's relationship with the poster for a third reader", async () => {
    const author = await person(), commenter = await person(), reader = await person();
    const sharedGame = await pair(author, commenter);
    await pair(author, reader);
    const postId = await share(author), id = randomUUID();
    const response = await comment(commenter.request(`posts/${postId}/comments`, "POST", { id, body: "Great work." }), context(postId));
    expect(response.status).toBe(200);
    expect(await commentIds(reader, postId)).toEqual([id]);

    await db.gameBlock.create({ data: { blockerMemberId: author.id, blockedMemberId: commenter.id } });
    expect(await commentIds(reader, postId)).toEqual([]);
    await db.gameBlock.deleteMany({ where: { blockerMemberId: author.id, blockedMemberId: commenter.id } });
    await db.healthFeedHide.create({ data: { memberId: commenter.id, hiddenMemberId: author.id } });
    expect(await commentIds(reader, postId)).toEqual([]);
    await db.healthFeedHide.deleteMany({ where: { memberId: commenter.id, hiddenMemberId: author.id } });
    expect(await commentIds(reader, postId)).toEqual([id]);
    await db.gamePlayer.updateMany({ where: { gameId: sharedGame, memberId: commenter.id }, data: { leftAt: new Date() } });
    expect(await commentIds(reader, postId)).toEqual([]);
  });

  it("excludes posts, profiles and comments from authors removed from the rollout", async () => {
    const author = await person(), reader = await person();
    await pair(author, reader);
    const authorPost = await share(author), readerPost = await share(reader), id = randomUUID();
    const response = await comment(author.request(`posts/${readerPost}/comments`, "POST", { id, body: "Nicely done." }), context(readerPost));
    expect(response.status).toBe(200);
    expect(await commentIds(reader, readerPost)).toEqual([id]);
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", reader.id);
    expect(await (await feed(reader.request("feed"))).json()).toMatchObject({ posts: [{ id: readerPost }] });
    expect((await readPost(reader, authorPost)).status).toBe(404);
    expect((await profile(reader.request(`people/${author.id}/profile`), memberContext(author.id))).status).toBe(404);
    expect(await commentIds(reader, readerPost)).toEqual([]);
  });

  it("requires the viewer's current health consent to add or remove a cheer", async () => {
    const author = await person(), viewer = await person();
    await pair(author, viewer);
    const first = await share(author), second = await share(author);
    expect((await cheer(viewer.request(`posts/${first}/cheer`, "PUT"), context(first))).status).toBe(204);
    await revokeHostedConsentScope({ memberId: viewer.id, scope: "launch.health-data", prisma: db });

    const add = await cheer(viewer.request(`posts/${second}/cheer`, "PUT"), context(second));
    const remove = await uncheer(viewer.request(`posts/${first}/cheer`, "DELETE"), context(first));
    for (const response of [add, remove]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "HOSTED_CONSENT_REQUIRED" } });
    }
    expect(await db.healthPostCheer.findMany({ where: { memberId: viewer.id }, select: { postId: true } }))
      .toEqual([{ postId: first }]);
    expect(await db.healthPost.findUniqueOrThrow({ where: { id: second }, select: { cheerPushClaimedAt: true } }))
      .toEqual({ cheerPushClaimedAt: null });
  });

  it("keeps only the author's deletion receipt when health consent is withdrawn", async () => {
    const author = await person(), partner = await person();
    await pair(author, partner);
    const id = await share(author);
    const open = crypto.openHealthTexts;
    const opening = vi.spyOn(crypto, "openHealthTexts").mockImplementationOnce(async (...args) => {
      const values = await open(...args);
      await revokeHostedConsentScope({ memberId: author.id, scope: "launch.health-data", prisma: db });
      return values;
    });
    const receipt = { id, createdAt: expect.any(String), version: 1 };
    expect(await (await readPost(author, id)).json()).toEqual({ post: receipt });
    opening.mockClear();
    expect((await (await feed(author.request("feed"))).json()).posts).toEqual([receipt]);
    const ownProfile = await profile(author.request(`people/${author.id}/profile`), memberContext(author.id));
    expect((await ownProfile.json()).posts).toEqual([receipt]);
    expect(opening.mock.calls.flatMap(([entries]) => entries)).toEqual([]);
    expect((await readPost(partner, id)).status).toBe(404);
    expect((await comments(author.request(`posts/${id}/comments`), context(id))).status).toBe(404);
    expect((await deletePost(author.request(`posts/${id}`, "DELETE"), context(id))).status).toBe(204);
    expect((await readPost(author, id)).status).toBe(404);
  });

  it("freezes the selected server variant and conflicts on a replaced win set", async () => {
    const author = await person(), viewer = await person();
    await pair(author, viewer);
    const day = new Date().toISOString().slice(0, 10);
    const candidates = prepareHealthCandidates(author.id, generateHealthWins({
      member: { today: day, age: null, sex: null, wearableProvider: null },
      sessions: Array.from({ length: 3 }, () => ({ date: day, type: "walk", minutes: 23 })),
    }));
    expect(candidates).toHaveLength(1);
    const setRevision = randomUUID();
    const [candidatesEncrypted] = await crypto.sealHealthTexts([{
      memberId: author.id, table: "health_win_set", rowId: setRevision, field: "candidates", value: JSON.stringify(candidates),
    }]);
    await db.healthWinSet.create({ data: {
      memberId: author.id, day, revision: setRevision, sourceRevision: "synthetic-revision", candidatesEncrypted,
    } });
    const pick = await wins(author.request("wins"));
    expect(pick.status).toBe(200);
    const set = await pick.json();
    expect(set.setRevision).toBe(setRevision);
    const candidateId = set.candidates[0].id;
    const selection = { candidateId, option: "hide_numbers" };
    const changed = await change(author.request("wins/" + candidateId + "/change", "POST", {
      setRevision, option: selection.option,
    }), context(candidateId));
    const { card } = await changed.json();
    expect(card.chart.type).toBe("hidden");
    const body = { id: randomUUID(), setRevision, cards: [selection] };
    expect((await post(author.request("posts", "POST", body))).status).toBe(200);
    await db.healthWinSet.update({ where: { memberId_day: { memberId: author.id, day } },
      data: { revision: randomUUID() } });
    expect((await post(author.request("posts", "POST", { ...body, id: randomUUID() }))).status).toBe(409);
    expect((await post(author.request("posts", "POST", body))).status).toBe(200);
    const read = await readPost(viewer, body.id);
    expect(read.status).toBe(200);
    const published = (await read.json()).post.cards;
    expect(published).toMatchObject([{ id: candidateId, specRevision: card.specRevision, spec: { chart: { type: "hidden" } } }]);
    expect(JSON.stringify(published)).not.toContain("totalMinutes");
  });

  it("cascades posts and interactions through both member and post ownership", async () => {
    const owner = await person(), peer = await person(), other = await person();
    const deleted = await share(owner), kept = await share(peer);
    await db.healthPostCheer.createMany({ data: [
      { postId: deleted, memberId: peer.id }, { postId: kept, memberId: owner.id },
    ] });
    await db.healthPostComment.createMany({ data: [
      { id: randomUUID(), postId: deleted, authorMemberId: peer.id, bodyEncrypted: "synthetic-envelope" },
      { id: randomUUID(), postId: kept, authorMemberId: owner.id, bodyEncrypted: "synthetic-envelope" },
    ] });
    await db.healthFeedHide.createMany({ data: [
      { memberId: owner.id, hiddenMemberId: peer.id }, { memberId: other.id, hiddenMemberId: owner.id },
    ] });
    await db.healthWinSet.create({ data: { memberId: owner.id, day: "2032-08-16", revision: randomUUID(),
      sourceRevision: "synthetic-digest", candidatesEncrypted: "synthetic-envelope" } });
    // The account service purges photo objects first. These assertions cover its subsequent member cascade.
    await db.hostedMember.delete({ where: { id: owner.id } });
    expect(await db.healthPost.findUnique({ where: { id: deleted } })).toBeNull();
    expect(await db.healthPost.count({ where: { id: kept } })).toBe(1);
    expect(await db.healthPostCheer.count({ where: { postId: { in: [deleted, kept] } } })).toBe(0);
    expect(await db.healthPostComment.count({ where: { postId: { in: [deleted, kept] } } })).toBe(0);
    expect(await db.healthFeedHide.count({ where: { OR: [{ memberId: owner.id }, { hiddenMemberId: owner.id }] } })).toBe(0);
    expect(await db.healthWinSet.count({ where: { memberId: owner.id } })).toBe(0);
  });

  it("paginates equal timestamps without duplicates when the cursor post is deleted", async () => {
    const author = await person();
    const createdAt = new Date();
    const ids = Array.from({ length: 23 }, () => randomUUID()).sort().reverse();
    await db.healthPost.createMany({ data: ids.map(id => ({ id, createdAt, authorMemberId: author.id })) });
    const page = async (path: string) => {
      const response = await feed(author.request(path));
      expect(response.status).toBe(200);
      return await response.json() as { posts: { id: string }[]; nextCursor: string | null };
    };
    const first = await page("feed");
    expect(first.posts.map(post => post.id)).toEqual(ids.slice(0, 20));
    expect(first.nextCursor).toBeTypeOf("string");
    await db.healthPost.update({ where: { id: first.posts[19].id }, data: { deletedAt: new Date() } });
    const last = await page("feed?cursor=" + encodeURIComponent(first.nextCursor!));
    expect(last.posts.map(post => post.id)).toEqual(ids.slice(20));
    expect(last.nextCursor).toBeNull();
  });
  it("continues past a whole page revoked during opening without disclosing its posts", async () => {
    const author = await person(), viewer = await person();
    await pair(author, viewer);
    const older = await share(viewer);
    const ids = Array.from({ length: 20 }, () => randomUUID());
    const ciphertext = await crypto.sealHealthTexts(ids.map(rowId => ({
      memberId: author.id, table: "health_post", rowId, field: "caption", value: "A morning in the garden.",
    })));
    const createdAt = new Date(Date.now() + 60_000);
    await db.healthPost.createMany({ data: ids.map((id, index) => ({
      id, authorMemberId: author.id, createdAt, captionEncrypted: ciphertext[index],
    })) });
    const open = crypto.openHealthTexts;
    vi.spyOn(crypto, "openHealthTexts").mockImplementation(async (...args) => {
      const values = await open(...args);
      if (args[0].some(entry => entry.memberId === author.id)) {
        await db.healthFeedHide.create({ data: { memberId: viewer.id, hiddenMemberId: author.id } });
      }
      return values;
    });
    const first = await feed(viewer.request("feed"));
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.posts).toEqual([]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const path = "feed?cursor=" + encodeURIComponent(page.nextCursor);
    const second = await feed(viewer.request(path));
    expect(await second.json()).toMatchObject({ posts: [{ id: older }], nextCursor: null });
    expect((await feed(author.request(path))).status).toBe(400);
  });

});
