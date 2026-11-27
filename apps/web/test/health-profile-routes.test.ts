import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as candidates } from "../app/api/game/v1/health/me/pin-candidates/route";
import { PUT as pins } from "../app/api/game/v1/health/me/pins/route";
import { GET as options } from "../app/api/game/v1/health/me/working-on/options/route";
import { PUT as working } from "../app/api/game/v1/health/me/working-on/route";
import { DELETE as remove, PUT as cheer } from "../app/api/game/v1/health/people/[memberId]/working-on/[factor]/cheer/route";
import { parseGameCommand } from "../src/lib/game/command";

import * as access from "../src/lib/health-profile/access";
import { profileAge } from "../src/lib/health-profile/age";
import * as streaks from "../src/lib/health-profile/streaks";
import * as storage from "../src/lib/health-profile/storage";
import * as wins from "../src/lib/health-wins/wins";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const api = vi.hoisted(() => ({ pinCandidates: vi.fn(), setPins: vi.fn(), workingOptions: vi.fn(), setWorking: vi.fn(),
  setWorkingCheer: vi.fn(), readExtendedProfile: vi.fn() }));
vi.mock("../src/lib/better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: async () => ({ allowed: true }) }) }));
const auth = { member: { id: "fixture-owner" } };
vi.mock("../src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => auth }));
vi.mock("../src/lib/health-profile/pins", () => api);
vi.mock("../src/lib/health-profile/working-on", () => api);
vi.mock("../src/lib/health-profile/profile", () => api);
const ctx = { params: Promise.resolve({ memberId: "fixture-other", factor: "steps" }) };
const request = (body?: unknown) => new Request("https://example.invalid/profile", { method: body ? "PUT" : "GET", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
  vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", auth.member.id);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("gates every read and write before parsing, including retraction", async () => {
  vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", "");
  const req = request({ broken: true });
  for (const response of [await candidates(req), await options(req), await pins(req), await working(req), await cheer(req, ctx), await remove(req, ctx)]) {
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(req.bodyUsed).toBe(false);
  for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
});
it("rejects unversioned picks, duplicate or excessive selections, and unknown factors", async () => {
  const pick = { key: "fixture", revision: "fixture-set" };
  for (const body of [{ keys: [] }, { picks: [{ key: "fixture" }] }, { picks: [pick, pick] }]) expect((await pins(request(body))).status).toBe(400);
  for (const factors of [["steps", "steps"], ["unknown"], ["steps", "sleepTime", "bedtime", "cardioFitness"]]) {
    expect((await working(request({ factors }))).status).toBe(400);
  }
  expect(api.setPins).not.toHaveBeenCalled();
  expect(api.setWorking).not.toHaveBeenCalled();
});
it("returns bare profile extras and viewer-only cheer state", async () => {
  api.readExtendedProfile.mockResolvedValue({ extras: { isMe: true, pins: [] } });
  api.pinCandidates.mockResolvedValue({ pinned: [], candidates: [] });
  api.workingOptions.mockResolvedValue({ options: [] });
  api.setWorkingCheer.mockImplementation(async (_auth, _owner, _factor, cheered) => ({ cheered }));
  expect(await (await candidates(request())).json()).toEqual({ pinned: [], candidates: [] });
  expect(await (await options(request())).json()).toEqual({ options: [] });
  expect(await (await pins(request({ picks: [] }))).json()).toEqual({ isMe: true, pins: [] });
  expect(await (await working(request({ factors: ["steps"] }))).json()).toEqual({ isMe: true, pins: [] });
  expect(await (await cheer(request(), ctx)).json()).toEqual({ cheered: true });
  expect(await (await remove(request(), ctx)).json()).toEqual({ cheered: false });
});
it("offers both live pin types even when the wins feed has no available set", async () => {
  const pins = await vi.importActual<typeof import("../src/lib/health-profile/pins")>("../src/lib/health-profile/pins");
  api.pinCandidates.mockImplementationOnce(pins.pinCandidates);
  vi.spyOn(access, "assertProfileAccess").mockResolvedValue(undefined);
  vi.spyOn(wins, "readHealthWins").mockRejectedValue(hostedOnboardingError({
    code: "HEALTH_WINS_UNAVAILABLE", httpStatus: 503, message: "Fixture unavailable.",
  }));
  vi.spyOn(storage, "storedPins").mockResolvedValue([]);
  vi.spyOn(profileAge, "read").mockResolvedValue({ value: 45.2, gap: -1.1, timeZone: "UTC", revision: "age-revision" });
  vi.spyOn(streaks, "readProfileStreaks").mockResolvedValue([{
    row: { gameId: "fixture-game", title: "Stretch after lunch", count: 2, days: ["done", "done"], partner: null },
    monday: "2031-04-07", revision: "streak-revision", peerCount: undefined,
  }]);
  const response = await candidates(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ pinned: [], candidates: [
    { filter: "streaks", revision: "streak-revision", card: { kind: "game_streak", title: { number: "2" } } },
    { filter: "age", revision: "age-revision", card: { kind: "biological_age", chart: { value: 45.2 } } },
  ] });
});
it("parses one cover operation without changing other profile fields", () => {
  expect(parseGameCommand({ type: "setProfile", cover: null })).toEqual({ type: "setProfile", cover: null });
  expect(parseGameCommand({ type: "setProfile", coverArt: "leaf" })).toEqual({ type: "setProfile", coverArt: "leaf" });
  expect(() => parseGameCommand({ type: "setProfile", coverArt: "leaf", cover: null })).toThrow();
  expect(() => parseGameCommand({ type: "setProfile", coverArt: "blue" })).toThrow();
});
