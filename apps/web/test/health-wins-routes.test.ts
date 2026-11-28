import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as feed } from "../app/api/game/v1/health/feed/route";
import { POST as previewActivity } from "../app/api/game/v1/health/activities/cards/route";
import { POST as activityKind } from "../app/api/game/v1/health/activities/kind/route";
import { PUT as saveActivity } from "../app/api/game/v1/health/activities/[id]/route";
import { GET as wins } from "../app/api/game/v1/health/wins/route";
import { POST as change } from "../app/api/game/v1/health/wins/[id]/change/route";
import { POST as post } from "../app/api/game/v1/health/posts/route";
import { DELETE as remove, GET as readPost, PATCH as patch } from "../app/api/game/v1/health/posts/[id]/route";
import { GET as seeYours } from "../app/api/game/v1/health/posts/[id]/see-yours/route";
import { DELETE as uncheer, PUT as cheer } from "../app/api/game/v1/health/posts/[id]/cheer/route";
import { GET as comments, POST as comment } from "../app/api/game/v1/health/posts/[id]/comments/route";
import { DELETE as removeComment } from "../app/api/game/v1/health/comments/[id]/route";
import { GET as profile } from "../app/api/game/v1/health/people/[memberId]/profile/route";
import { GET as hides } from "../app/api/game/v1/health/hides/route";
import { DELETE as unhide, PUT as hide } from "../app/api/game/v1/health/hides/[memberId]/route";
import { DELETE as removePhoto, GET as readPhoto, PUT as photo } from "../app/api/game/v1/health/photos/[id]/route";
import { encodePolyline } from "../src/lib/game/progress/route-geometry";
import { getHostedDomainRootUnwrapCache } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const auth = { member: { id: "synthetic-reader" } };
const service = vi.hoisted(() => ({
  feed: vi.fn(), wins: vi.fn(), change: vi.fn(), readPost: vi.fn(), create: vi.fn(), patch: vi.fn(),
  remove: vi.fn(), cheer: vi.fn(), comments: vi.fn(), comment: vi.fn(), removeComment: vi.fn(),
  profile: vi.fn(), hides: vi.fn(), hide: vi.fn(), photo: vi.fn(), readPhoto: vi.fn(), removePhoto: vi.fn(),
  previewActivity: vi.fn(), saveActivity: vi.fn(), seeYours: vi.fn(),
}));
vi.mock("../src/lib/health-wins/see-yours", () => ({ readSeeYours: service.seeYours }));
vi.mock("../src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => auth }));
vi.mock("../src/lib/health-wins/read", () => ({
  readHealthFeed: service.feed, readHealthPost: service.readPost,
  readHealthComments: service.comments, readHealthProfile: service.profile,
}));
vi.mock("../src/lib/health-wins/wins", () => ({ readHealthWins: service.wins, changeHealthWin: service.change }));
vi.mock("../src/lib/health-wins/hides", () => ({ readHealthHides: service.hides, setHealthHide: service.hide }));
vi.mock("../src/lib/health-wins/recorded-activities", () => ({
  previewRecordedActivity: service.previewActivity, saveRecordedActivity: service.saveActivity,
}));
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
  vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", "");
  vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("per-member route gate", () => {
  it("returns private 404s before any service or body validation on every disabled route", async () => {
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "synthetic-other");
    vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", auth.member.id);
    const invalid = request("posts", "POST", { unrelated: true });
    const responses = await Promise.all([
      feed(invalid), wins(invalid), change(invalid, postContext), post(invalid),
      readPost(invalid, postContext), patch(invalid, postContext), remove(invalid, postContext), seeYours(invalid, postContext),
      cheer(invalid, postContext), uncheer(invalid, postContext),
      comments(invalid, postContext), comment(invalid, postContext), removeComment(invalid, postContext),
      profile(invalid, personContext), hides(invalid), hide(invalid, personContext), unhide(invalid, personContext),
      photo(invalid, postContext), readPhoto(invalid, postContext), removePhoto(invalid, postContext),
      activityKind(invalid), previewActivity(invalid), saveActivity(invalid, postContext),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
    expect(invalid.bodyUsed).toBe(false);
  });
  it("requires the recording allowlist even when the member can open the feed", async () => {
    const invalid = request("activities/cards", "POST", { extra: true });
    for (const response of [await activityKind(invalid), await previewActivity(invalid), await saveActivity(invalid, postContext)]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(invalid.bodyUsed).toBe(false);
    expect(service.previewActivity).not.toHaveBeenCalled();
    expect(service.saveActivity).not.toHaveBeenCalled();
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

it("accepts one bounded card selector and passes reader units and cancellation to See yours", async () => {
  const selected = request(`posts/${id}/see-yours?card=shared-fixture`);
  selected.headers.set("X-Murph-Client-Units", "metric");
  const empty = { measure: { key: "insulin", label: "insulin", source: "labs" }, card: null, reason: "no_labs", friend: null };
  service.seeYours.mockResolvedValue(empty);
  const response = await seeYours(selected, postContext);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(empty);
  expect(service.seeYours).toHaveBeenCalledExactlyOnceWith(auth, id, "shared-fixture", "metric", selected.signal);
  for (const query of ["", "?card=", "?card=" + "a".repeat(257), "?card=shared-fixture&friend=unknown"]) {
    expect((await seeYours(request(`posts/${id}/see-yours${query}`), postContext)).status).toBe(400);
  }
  expect(service.seeYours).toHaveBeenCalledTimes(1);
  service.seeYours.mockRejectedValue(hostedOnboardingError({
    code: "HEALTH_SEE_YOURS_UNAVAILABLE", httpStatus: 503, retryable: true, message: "Try again.",
  }));
  const failure = await seeYours(selected, postContext);
  expect(failure.status).toBe(503);
  expect(await failure.json()).toMatchObject({ error: { code: "HEALTH_SEE_YOURS_UNAVAILABLE", retryable: true } });
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
  refresh.headers.set("X-Murph-Client-Units", "metric");
  expect((await wins(refresh)).status).toBe(200);
  expect(service.wins).toHaveBeenCalledExactlyOnceWith(auth, { refresh: true, signal: refresh.signal, units: "metric" });
  const selection = { candidateId: "slot:forest", option: "hide_numbers" };
  const body = { id, setRevision: revision, cards: [selection] };
  service.create.mockResolvedValue({ id, version: 1 });
  expect(await (await post(request("posts", "POST", body))).json()).toEqual({ id, version: 1 });
  expect(service.create).toHaveBeenCalledExactlyOnceWith(auth, body, "us", expect.any(AbortSignal));
  for (const invalid of [
    { id, cards: [selection] }, { ...body, cards: [selection, selection] },
    { ...body, cards: [{ ...selection, title: "Untrusted title" }] },
    { id, caption: "  " }, { ...body, renderedImageKey: "synthetic-key" },
  ]) {
    expect((await post(request("posts", "POST", invalid))).status).toBe(400);
  }
  expect(service.create).toHaveBeenCalledTimes(1);
});

it("admits one digest-bound See yours pick on create and refuses it on edit", async () => {
  const mine = { candidateId: "mine:hdl:lab_range", option: "original", specRevision: "9b".repeat(32) };
  const set = { candidateId: "fixture-set-card", option: "original" };
  const body = { id, cards: [mine] };
  service.create.mockResolvedValue({ id, version: 1 });
  const create = request("posts", "POST", body);
  create.headers.set("X-Murph-Client-Units", "metric");
  expect((await post(create)).status).toBe(200);
  expect(service.create).toHaveBeenCalledExactlyOnceWith(auth, body, "metric", create.signal);
  expect((await post(request("posts", "POST", { id, cards: [mine, set], setRevision: revision }))).status).toBe(200);
  for (const cards of [
    [mine, set], [{ ...mine, specRevision: undefined }], [{ ...mine, specRevision: revision }],
    [mine, { ...mine, candidateId: "mine:glucose:lab_range" }],
  ]) {
    expect((await post(request("posts", "POST", { id, cards }))).status).toBe(400);
  }
  expect((await patch(request("posts", "PATCH", { cards: [mine], expectedVersion: 1, setRevision: revision }), postContext)).status).toBe(400);
  expect((await patch(request("posts", "PATCH", { expectedVersion: 1, removeCardIds: [mine.candidateId] }), postContext)).status).toBe(400);
  expect(service.create).toHaveBeenCalledTimes(2);
  expect(service.patch).not.toHaveBeenCalled();
});

it("accepts a single payoff with its photo and digest, and rejects payoff selections on edits", async () => {
  vi.stubEnv("MURPH_HEALTH_PAYOFF_MEMBER_IDS", auth.member.id);
  const pick = { candidateId: `game:${revision}`, option: "original", specRevision: "eb".repeat(32) };
  const input = { id, attachmentId: revision, cards: [pick] };
  service.create.mockResolvedValue({ id, version: 1 });
  expect((await post(request("posts", "POST", input))).status).toBe(200);
  expect(service.create).toHaveBeenCalledExactlyOnceWith(auth, input, "us", expect.any(AbortSignal));
  for (const invalid of [
    { ...input, attachmentId: undefined },
    { ...input, cards: [{ ...pick, specRevision: undefined }] },
    { ...input, cards: [{ ...pick, specRevision: revision }] },
    { ...input, setRevision: revision, cards: [pick, { candidateId: "slot:willow", option: "original" }] },
    { ...input, cards: [pick, { candidateId: "mine:hdl:lab_range", option: "original", specRevision: "9b".repeat(32) }] },
  ]) {
    expect((await post(request("posts", "POST", invalid))).status).toBe(400);
  }
  expect(service.create).toHaveBeenCalledTimes(1);
  const edit = { expectedVersion: 1, setRevision: revision, cards: [pick] };
  expect((await patch(request("posts", "PATCH", edit), postContext)).status).toBe(400);
  const removal = { expectedVersion: 1, removeCardIds: [pick.candidateId] };
  expect((await patch(request("posts", "PATCH", removal), postContext)).status).toBe(400);
  expect(service.patch).not.toHaveBeenCalled();
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

it("requires a version for edits and validates visibility on ordinary comments", async () => {
  expect((await patch(request("posts", "PATCH", { caption: null }), postContext)).status).toBe(400);
  expect((await patch(request("posts", "PATCH", { expectedVersion: 2 }), postContext)).status).toBe(400);
  expect(service.patch).not.toHaveBeenCalled();
  service.comment.mockResolvedValue({ id });
  const body = { id, body: "A good afternoon for a walk." };
  expect((await comment(request("comments", "POST", body), postContext)).status).toBe(200);
  expect(service.comment).toHaveBeenCalledExactlyOnceWith(auth, id, { ...body, visibility: "everyone" });
  expect((await comment(request("comments", "POST", { ...body, visibility: "global" }), postContext)).status).toBe(400);
});

it.each([{}, { visibility: "everyone" }, { visibility: "poster" }, { visibility: { ignored: true } }])(
  "preserves the reply audience for the locked parent check", async fields => {
    service.comment.mockResolvedValue({ id });
    const replyTo = "4bd94cef-6ac5-42d6-a80d-d089fb3d966b";
    const body = "Synthetic reply text";
    const response = await comment(request("comments", "POST", { id, body, replyTo: replyTo.toUpperCase(), ...fields }), postContext);
    expect(await response.json()).toEqual({ id });
    expect(service.comment).toHaveBeenCalledExactlyOnceWith(auth, id, { id, body, replyTo, ...fields });
  },
);

it.each([{ replyTo: "bad-id" }, { replyTo: null }, { replyTo: revision, recipientMemberId: "synthetic-peer" }])(
  "rejects malformed reply targets and client-selected recipients", async fields => {
    const response = await comment(request("comments", "POST", { id, body: "Synthetic reply text", ...fields }), postContext);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(service.comment).not.toHaveBeenCalled();
  },
);

describe("timed recording requests", () => {
  const id = "6c01966b-b318-4cc7-96d3-c007a116b2c9";
  const context = { params: Promise.resolve({ id }) };
  const heartRate = { avgBpm: 87.5, lowBpm: 79, peakBpm: 96 };
  const summary = {
    id, kind: "lift", startedAt: "2026-06-13T16:10:00+02:00", elapsedSec: 182,
    movingSec: 173, timerSec: 180, heartRate,
  };
  const activity = { ...summary, heartRate: { ...heartRate, perMinute: [83, null, 91] } };
  const candidateId = `activity:${id}:activity_heart_rate`;
  const selection = { candidateId, option: "original", specRevision: "ae".repeat(32) };
  const selectionFromSet = { candidateId: "slot:spruce", option: "original" };
  beforeEach(() => vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", auth.member.id));

  it("advertises named and timed recording on an enabled member's feed", async () => {
    service.feed.mockResolvedValue({ posts: [], nextCursor: null });
    expect(await (await feed(request("feed"))).json()).toEqual({
      posts: [], nextCursor: null, record: { timed: true, route: false, named: true },
    });
  });

  it("returns the cleaned name and a usable recorder with Decisions off", async () => {
    vi.stubEnv("MURPH_HEALTH_ACTIVITY_DECISIONS", "false");
    const response = await activityKind(request("activities/kind", "POST", { name: "  Ridge   hike  " }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ name: "Ridge hike", kind: "other", timer: false, decided: false });
    for (const body of [{ name: "h".repeat(201) }, { name: "Hike", kind: "walk" }, {}]) {
      const malformed = await activityKind(request("activities/kind", "POST", body));
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    }
  });

  it("keeps malformed activity-name input out of the request error log", async () => {
    const name = "Paddle drills";
    const response = await activityKind(new Request("https://fixture.test/api/game/v1/health/activities/kind", {
      method: "POST", body: name,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(name);
  });

  it("returns a distinct error for refused names and requires a canonical name on preview", async () => {
    const name = "Ghost pepper circuit";
    const responses = [
      await activityKind(request("activities/kind", "POST", { name })),
      await previewActivity(request("activities/cards", "POST", { activity: { ...activity, name } })),
      await previewActivity(request("activities/cards", "POST", { activity: { ...activity, name: " Wall ball " } })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: {
        code: "HEALTH_ACTIVITY_NAME_INVALID", message: "This can't be used as an activity name.",
      } });
    }
    expect(service.previewActivity).not.toHaveBeenCalled();
    service.previewActivity.mockResolvedValue({ cards: [] });
    const named = { ...activity, name: "Wall ball" };
    expect((await previewActivity(request("activities/cards", "POST", { activity: named }))).status).toBe(200);
    expect(service.previewActivity).toHaveBeenCalledExactlyOnceWith(auth, named, "us");
  });

  it("passes display data and presentation units to preview, and only summaries to save", async () => {
    const preview = request("activities/cards", "POST", { activity });
    preview.headers.set("X-Murph-Client-Units", "metric");
    const result = { suggestedTitle: "Afternoon lift", cards: [] };
    service.previewActivity.mockResolvedValue(result);
    const response = await previewActivity(preview);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
    expect(service.previewActivity).toHaveBeenCalledExactlyOnceWith(auth, activity, "metric");
    expect(service.saveActivity).not.toHaveBeenCalled();

    service.saveActivity.mockResolvedValue({ id });
    expect((await saveActivity(request(`activities/${id}`, "PUT", { activity: summary }), context)).ok).toBe(true);
    expect(service.saveActivity).toHaveBeenCalledExactlyOnceWith(auth, summary);
    expect((await saveActivity(request("activities", "PUT", { activity: summary }), postContext)).status).toBe(400);
    expect(service.saveActivity).toHaveBeenCalledTimes(1);
  });

  it("rejects raw sensor fields, malformed routes, and oversized bodies before passing health data to services", async () => {
    for (const extra of [
      { samples: [] }, { points: [] }, { fixes: [] }, { paths: [] },
      { route: { distanceM: 340 } }, { heartRate: { ...activity.heartRate, samples: [] } },
    ]) {
      const invalid = { ...activity, ...extra };
      expect((await previewActivity(request("activities/cards", "POST", { activity: invalid }))).status).toBe(400);
      expect((await post(request("posts", "POST", { id, activity: invalid, cards: [selection] }))).status).toBe(400);
    }
    for (const invalid of [activity, { ...summary, paths: [] }, { ...summary, perMinute: [] }]) {
      expect((await saveActivity(request("activities", "PUT", { activity: invalid }), context)).status).toBe(400);
    }
    expect((await previewActivity(request("activities/cards", "POST", {
      activity, padding: "x".repeat(32 * 1024),
    }))).status).toBe(413);
    expect(service.previewActivity).not.toHaveBeenCalled();
    expect(service.saveActivity).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it("accepts a recorded pick independently or interleaved with picks from a set", async () => {
    service.create.mockResolvedValue({ id, version: 1 });
    for (const fields of [
      { cards: [selection] },
      { setRevision: revision, cards: [selectionFromSet, selection] },
    ]) {
      const body = { id, activity, ...fields };
      expect((await post(request("posts", "POST", body))).status).toBe(200);
      expect(service.create).toHaveBeenLastCalledWith(auth, body, "us", expect.any(AbortSignal));
    }
    for (const invalid of [
      { id, cards: [selection] }, { id, activity, cards: [{ candidateId, option: "original" }] },
      { id, activity, cards: [selection, selectionFromSet] },
      { id, activity, cards: [{ ...selection, specRevision: "malformed" }] },
    ]) {
      expect((await post(request("posts", "POST", invalid))).status).toBe(400);
    }
    expect(service.create).toHaveBeenCalledTimes(2);
  });

  it("passes recorded card revision conflicts and health consent denials through the private envelope", async () => {
    service.create.mockRejectedValue(hostedOnboardingError({
      code: "HEALTH_ACTIVITY_CARD_CHANGED", httpStatus: 409, message: "Preview the current card.",
    }));
    const conflict = await post(request("posts", "POST", { id, activity, cards: [selection] }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "HEALTH_ACTIVITY_CARD_CHANGED" } });

    service.previewActivity.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Health consent is required.",
    }));
    const denied = await previewActivity(request("activities/cards", "POST", { activity }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
  });

  it("accepts frozen card removal as a distinct edit operation", async () => {
    service.patch.mockResolvedValue({ id, version: 4 });
    const edit = { expectedVersion: 3, removeCardIds: [candidateId] };
    expect((await patch(request("posts", "PATCH", edit), postContext)).status).toBe(200);
    for (const invalid of [
      { ...edit, cards: [] }, { ...edit, setRevision: revision }, { ...edit, removeCardIds: [] },
      { ...edit, removeCardIds: [candidateId, candidateId] }, { ...edit, activity },
    ]) {
      expect((await patch(request("posts", "PATCH", invalid), postContext)).status).toBe(400);
    }
    expect(service.patch).toHaveBeenCalledExactlyOnceWith(auth, (await postContext.params).id, edit);
  });
});

describe("GPS recording requests", () => {
  const summary = { id, kind: "walk", startedAt: "2033-04-07T09:00:00Z", elapsedSec: 780, movingSec: 750 };
  const route = { distanceM: 1000, climbM: 3, splits: [{ distanceM: 1000, seconds: 750 }] };
  // Synthetic open-ocean grid.
  const paths = [encodePolyline([[-132, -39], [-132.0004, -39.0008]])];
  const activity = { ...summary, route: { ...route, paths } };
  const selection = { candidateId: `activity:${id}:activity_route`, option: "original", specRevision: "ab".repeat(32) };

  beforeEach(() => vi.stubEnv("MURPH_HEALTH_RECORD_MEMBER_IDS", auth.member.id));

  it("requires the route allowlist for a route preview or private route summary", async () => {
    const preview = await previewActivity(request("activities/cards", "POST", { activity }));
    const save = await saveActivity(request(`activities/${id}`, "PUT", { activity: { ...summary, route } }), postContext);
    for (const response of [preview, save]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(service.previewActivity).not.toHaveBeenCalled();
    expect(service.saveActivity).not.toHaveBeenCalled();
  });

  it("accepts display paths for preview and publication, and only route summaries for private saves", async () => {
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", auth.member.id);
    service.previewActivity.mockResolvedValue({ cards: [] });
    service.create.mockResolvedValue({ id, version: 1 });
    service.saveActivity.mockResolvedValue({ id });
    expect((await previewActivity(request("activities/cards", "POST", { activity }))).status).toBe(200);
    expect(service.previewActivity).toHaveBeenCalledExactlyOnceWith(auth, activity, "us");
    const body = { id, activity, cards: [selection] };
    expect((await post(request("posts", "POST", body))).status).toBe(200);
    expect(service.create).toHaveBeenCalledExactlyOnceWith(auth, body, "us", expect.any(AbortSignal));
    expect((await saveActivity(request("activities", "PUT", { activity }), postContext)).status).toBe(400);
    const saved = { ...summary, route };
    expect((await saveActivity(request("activities", "PUT", { activity: saved }), postContext)).status).toBe(200);
    expect(service.saveActivity).toHaveBeenCalledExactlyOnceWith(auth, saved);
  });

  it("rejects unknown fields on route and split objects before preview or publication", async () => {
    vi.stubEnv("MURPH_HEALTH_ROUTE_MEMBER_IDS", auth.member.id);
    for (const extra of [{ fixes: [] }, { points: [] }, { splits: [{ ...route.splits[0], points: [] }] }]) {
      const invalid = { ...activity, route: { ...activity.route, ...extra } };
      expect((await previewActivity(request("activities/cards", "POST", { activity: invalid }))).status).toBe(400);
      expect((await post(request("posts", "POST", { id, activity: invalid, cards: [selection] }))).status).toBe(400);
    }
    expect(service.previewActivity).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });
});
