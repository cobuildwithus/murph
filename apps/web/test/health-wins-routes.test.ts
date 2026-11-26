import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as feed } from "../app/api/game/v1/health/feed/route";
import { GET as wins } from "../app/api/game/v1/health/wins/route";
import { POST as change } from "../app/api/game/v1/health/wins/[id]/change/route";
import { POST as post } from "../app/api/game/v1/health/posts/route";
import { DELETE as remove, GET as readPost, PATCH as patch } from "../app/api/game/v1/health/posts/[id]/route";
import { DELETE as uncheer, PUT as cheer } from "../app/api/game/v1/health/posts/[id]/cheer/route";
import { GET as comments, POST as comment } from "../app/api/game/v1/health/posts/[id]/comments/route";
import { DELETE as removeComment } from "../app/api/game/v1/health/comments/[id]/route";
import { GET as profile } from "../app/api/game/v1/health/people/[memberId]/profile/route";
import { GET as hides } from "../app/api/game/v1/health/hides/route";
import { DELETE as unhide, PUT as hide } from "../app/api/game/v1/health/hides/[memberId]/route";
import { DELETE as removePhoto, GET as readPhoto, PUT as photo } from "../app/api/game/v1/health/photos/[id]/route";
import { getHostedDomainRootUnwrapCache } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const auth = { member: { id: "synthetic-reader" } };
const service = vi.hoisted(() => ({
  feed: vi.fn(), wins: vi.fn(), change: vi.fn(), readPost: vi.fn(), create: vi.fn(), patch: vi.fn(),
  remove: vi.fn(), cheer: vi.fn(), comments: vi.fn(), comment: vi.fn(), removeComment: vi.fn(),
  profile: vi.fn(), hides: vi.fn(), hide: vi.fn(), photo: vi.fn(), readPhoto: vi.fn(), removePhoto: vi.fn(),
}));
vi.mock("../src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => auth }));
vi.mock("../src/lib/health-wins/read", () => ({
  readHealthFeed: service.feed, readHealthPost: service.readPost,
  readHealthComments: service.comments, readHealthProfile: service.profile,
}));
vi.mock("../src/lib/health-wins/wins", () => ({ readHealthWins: service.wins, changeHealthWin: service.change }));
vi.mock("../src/lib/health-wins/hides", () => ({ readHealthHides: service.hides, setHealthHide: service.hide }));
vi.mock("../src/lib/health-wins/media", () => ({
  uploadHealthPhoto: service.photo, readHealthPhoto: service.readPhoto, discardHealthPhoto: service.removePhoto,
}));
vi.mock("../src/lib/health-wins/writes", () => ({
  createHealthPost: service.create, patchHealthPost: service.patch, deleteHealthPost: service.remove,
  setHealthCheer: service.cheer, createHealthComment: service.comment, deleteHealthComment: service.removeComment,
}));

const id = "876fca95-2b56-43bb-b5d5-a3e0f39cc1be";
const revision = "7237198e-bb2f-48ac-8131-fab80425dbfa";
const postContext = { params: Promise.resolve({ id }) };
const personContext = { params: Promise.resolve({ memberId: "synthetic-peer" }) };
function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://fixture.test/api/game/v1/health/${path}`, { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", auth.member.id);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("per-member route gate", () => {
  it("returns private 404s before any service or body validation on every disabled route", async () => {
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "synthetic-other");
    const invalid = request("posts", "POST", { unrelated: true });
    const responses = await Promise.all([
      feed(invalid), wins(invalid), change(invalid, postContext), post(invalid),
      readPost(invalid, postContext), patch(invalid, postContext), remove(invalid, postContext),
      cheer(invalid, postContext), uncheer(invalid, postContext),
      comments(invalid, postContext), comment(invalid, postContext), removeComment(invalid, postContext),
      profile(invalid, personContext), hides(invalid), hide(invalid, personContext), unhide(invalid, personContext),
      photo(invalid, postContext), readPhoto(invalid, postContext), removePhoto(invalid, postContext),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
    expect(invalid.bodyUsed).toBe(false);
  });
});

it("passes a bounded cursor and scopes decryption to the current request", async () => {
  service.feed.mockImplementation(async () => {
    expect(getHostedDomainRootUnwrapCache()).toBeDefined();
    return { posts: [], nextCursor: null };
  });
  const response = await feed(request("feed?cursor=opaque-cursor"));
  expect(await response.json()).toEqual({ posts: [], nextCursor: null });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
  expect(service.feed).toHaveBeenCalledExactlyOnceWith(auth, "opaque-cursor");
  expect((await feed(request("feed?cursor=" + "a".repeat(2049)))).status).toBe(400);
});

it("logs only a known error class when a private dependency fails", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    class SyntheticCustomError extends Error {}
    for (const [failure, errorClass] of [
      [new TypeError("Synthetic private detail", { cause: "Synthetic private cause" }), "TypeError"],
      [new SyntheticCustomError("Synthetic private detail"), "UnknownError"],
    ] as const) {
      service.feed.mockRejectedValueOnce(failure);
      const response = await feed(request("feed"));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: {
        code: "HEALTH_FEED_UNAVAILABLE", retryable: true, message: "Health wins could not load. Try again.",
      } });
      expect(log).toHaveBeenCalledExactlyOnceWith("Health wins request failed.", { errorClass });
      log.mockClear();
    }
  } finally {
    log.mockRestore();
  }
});

it("passes the winning set and a chosen option without accepting client-declared card specs", async () => {
  service.wins.mockResolvedValue({ day: "2026-02-09", setRevision: revision, candidates: [] });
  const refresh = request("wins?refresh=1");
  expect((await wins(refresh)).status).toBe(200);
  expect(service.wins).toHaveBeenCalledExactlyOnceWith(auth, { refresh: true, signal: refresh.signal });
  const selection = { candidateId: "slot:forest", option: "hide_numbers" };
  const body = { id, setRevision: revision, cards: [selection] };
  service.create.mockResolvedValue({ id, version: 1 });
  expect(await (await post(request("posts", "POST", body))).json()).toEqual({ id, version: 1 });
  expect(service.create).toHaveBeenCalledExactlyOnceWith(auth, body);
  for (const invalid of [
    { id, cards: [selection] }, { ...body, cards: [selection, selection] },
    { ...body, cards: [{ ...selection, title: "Untrusted title" }] },
    { id, caption: "  " }, { ...body, renderedImageKey: "synthetic-key" },
  ]) {
    expect((await post(request("posts", "POST", invalid))).status).toBe(400);
  }
  expect(service.create).toHaveBeenCalledTimes(1);
});

it("requires an explicit option for each posted or edited card, including the original", async () => {
  const missingOption = { setRevision: revision, cards: [{ candidateId: "slot:forest" }] };
  expect((await post(request("posts", "POST", { ...missingOption, id }))).status).toBe(400);
  expect((await patch(request("posts", "PATCH", { ...missingOption, expectedVersion: 1 }), postContext)).status).toBe(400);
  expect(service.create).not.toHaveBeenCalled();
  expect(service.patch).not.toHaveBeenCalled();

  service.create.mockResolvedValue({ id, version: 1 });
  for (const fields of [{ caption: "Fresh air this morning." }, { attachmentId: id }]) {
    expect((await post(request("posts", "POST", { id, ...fields }))).status).toBe(200);
  }
  const changed = { expectedVersion: 1, setRevision: revision, cards: [{ candidateId: "slot:forest", option: "original" }] };
  service.patch.mockResolvedValue({ id, version: 2 });
  expect((await patch(request("posts", "PATCH", changed), postContext)).status).toBe(200);
  expect(service.patch).toHaveBeenCalledExactlyOnceWith(auth, id, changed);
});

it("returns the set conflict unchanged on an otherwise valid card change", async () => {
  service.change.mockRejectedValue(hostedOnboardingError({ code: "HEALTH_WIN_SET_CHANGED", httpStatus: 409, message: "Choose from the current set." }));
  const changeContext = { params: Promise.resolve({ id: "slot:forest" }) };
  const response = await change(request("wins/slot:forest/change", "POST", { setRevision: revision, option: "original" }), changeContext);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "HEALTH_WIN_SET_CHANGED" } });
  expect(service.change).toHaveBeenCalledExactlyOnceWith(auth, { candidateId: "slot:forest", setRevision: revision, option: "original" });
});

it("requires a version for edits and a valid visibility on every comment", async () => {
  expect((await patch(request("posts", "PATCH", { caption: null }), postContext)).status).toBe(400);
  expect((await patch(request("posts", "PATCH", { expectedVersion: 2 }), postContext)).status).toBe(400);
  expect(service.patch).not.toHaveBeenCalled();
  service.comment.mockResolvedValue({ id });
  const body = { id, body: "A good afternoon for a walk." };
  expect((await comment(request("comments", "POST", body), postContext)).status).toBe(200);
  expect(service.comment).toHaveBeenCalledExactlyOnceWith(auth, id, { ...body, visibility: "everyone" });
  expect((await comment(request("comments", "POST", { ...body, visibility: "global" }), postContext)).status).toBe(400);
});
