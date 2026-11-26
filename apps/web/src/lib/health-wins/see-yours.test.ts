import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../../app/api/game/v1/health/posts/[id]/see-yours/route";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type { CardSpec, HealthWinRankResult, HealthWinsInput } from "./engine/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ member: { id: "fixture-viewer" } })), frozen: vi.fn(), inputs: vi.fn(),
  recheck: vi.fn(async () => {}),
}));
vi.mock("../game/http/auth", () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock("../better-auth/rate-limit", () => ({ hostedAuthRateLimitStorage: () => ({ consume: async () => ({ allowed: true }) }) }));
vi.mock("../prisma", () => ({ getPrisma: () => ({ gameProfile: { findUnique: async () => ({ timeZone: "UTC" }) } }) }));
vi.mock("./read", () => ({ readVisibleFrozenCard: mocks.frozen, assertVisibleFrozenCardCurrent: mocks.recheck }));
vi.mock("./inputs", () => ({ readMeasureInputs: mocks.inputs }));

const member: HealthWinsInput["member"] = { today: "2032-08-14", age: 42, sex: "female", wearableProvider: "oura" };
const postId = "c2e1feba-98fb-4342-b70f-99cb90917b1e";
const frozenLab: Extract<CardSpec, { kind: "percentile" }> = {
  kind: "percentile", measure: "insulin", id: "fixture-card", filter: "Labs", theme: "labs", share: { caption_tips: [] },
  title: { number: "Top 17%", measure: "insulin" }, subtitle: "", source_note: "",
  chart: { type: "percentile", value: 4.1, unit: "µIU/mL", group: "Fixture cohort", cuts: [], topPercent: 17, lowerIsBetter: true },
};
const labInput: HealthWinsInput = {
  member, labs: [{ date: member.today, analyte: "insulin", unit: "uIU/mL", value: 7.3, fasting: true, referenceRange: { low: 1, high: 20 } }],
};

beforeEach(() => vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "fixture-viewer"));
afterEach(() => vi.unstubAllEnvs());

function requestCard() {
  const request = new Request(`https://fixture.test/api/game/v1/health/posts/${postId}/see-yours?card=fixture-card`);
  return GET(request, { params: Promise.resolve({ id: postId }) });
}

async function openCard(spec: CardSpec, input: HealthWinsInput) {
  mocks.frozen.mockResolvedValueOnce({ spec, authorMemberId: "fixture-poster", version: 2 });
  mocks.inputs.mockResolvedValueOnce({ input, observed: true });
  const response = await requestCard();
  expect(response.status).toBe(200);
  return response.json();
}

it.each([
  ["oura_sleeping_hr", { value: 54, unit: "bpm" }],
  ["apple_resting_hr", null],
  [undefined, null],
] as const)("includes only matching resting heart rate methods (friend reference %s)", async (referenceKey, friend) => {
  const frozen: CardSpec = { ...frozenLab, filter: "Heart", theme: "heart", measure: "rhr_bpm",
    chart: { ...frozenLab.chart, value: 54, unit: "bpm", referenceKey } };
  const daily = Array.from({ length: 14 }, (_, i) => ({
    metric: "rhr_bpm" as const, date: `2032-08-${String(i + 1).padStart(2, "0")}`, provider: "oura", value: 61,
  }));
  const result = await openCard(frozen, { member, daily });
  expect(result.card.chart).toMatchObject({ referenceKey: "oura_sleeping_hr", value: 61 });
  expect(result.friend).toEqual(friend);
  const rank = (): HealthWinRankResult => ({ source: "Fixture study", betterShare: 70, group: "Fixture cohort", cuts: [], lowerIsBetter: true });
  const missingViewerKey = await openCard(frozen, { member, daily, rank });
  expect(missingViewerKey.card.kind).toBe("percentile");
  expect(missingViewerKey.friend).toBeNull();
});

it("requires initial authentication and conceals the post if viewer authority is lost during the read", async () => {
  const signedOut = hostedOnboardingError({ code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in." });
  const revoked = hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." });
  mocks.auth.mockRejectedValueOnce(signedOut);
  expect((await requestCard()).status).toBe(401);

  const frozen = { spec: frozenLab, authorMemberId: "fixture-poster", version: 1 };
  mocks.frozen.mockResolvedValueOnce(frozen).mockResolvedValueOnce(frozen);
  // The replica reader rechecks authority in finally, before the post's final visibility check.
  mocks.inputs.mockRejectedValueOnce(revoked);
  const duringLoad = await requestCard();
  mocks.inputs.mockResolvedValueOnce({ input: labInput, observed: true });
  mocks.recheck.mockRejectedValueOnce(signedOut);
  const afterLoad = await requestCard();
  for (const response of [duringLoad, afterLoad]) {
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: { code: "GAME_NOT_FOUND" } });
  }
});

it("compares units using their normalized key and returns only the frozen value and unit", async () => {
  const matched = await openCard(frozenLab, labInput);
  expect(matched.card.chart).toMatchObject({ type: "percentile", unit: "uIU/mL", value: 7.3 });
  expect(matched.friend).toEqual({ value: 4.1, unit: "µIU/mL" });
  const different = await openCard({ ...frozenLab, chart: { ...frozenLab.chart, unit: "pmol/L" } }, labInput);
  expect(different.card.kind).toBe("percentile");
  expect(different.friend).toBeNull();
});

it("omits the marker on a viewer's range fallback or a friend's non-percentile card", async () => {
  const fallback = await openCard(frozenLab, { ...labInput, member: { ...member, age: null } });
  expect(fallback.card.kind).toBe("lab_range");
  expect(fallback.friend).toBeNull();
  const change: CardSpec = { ...frozenLab, kind: "lab_change", chart: {
    type: "lab_trend", unit: "µIU/mL", baseline: { value: 8.1, draws: 3 }, latest: { date: member.today, value: 4.1 },
  } };
  const result = await openCard(change, labInput);
  expect(result.card.kind).toBe("percentile");
  expect(result.friend).toBeNull();
});
