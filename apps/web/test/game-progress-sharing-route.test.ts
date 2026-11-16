import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }) }));
vi.mock("@/src/lib/game/progress/friends-reader", () => ({ setProgressFriendSharing: mocks.share }));
import { PUT } from "../app/api/game/v1/progress/friends/sharing/route";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const request = (body: object) => new Request("https://example.test/api/game/v1/progress/friends/sharing", {
  method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});
beforeEach(() => vi.resetAllMocks());

it.each([
  { metrics: ["steps"], share: true },
  { metrics: ["restingHeartRate"], share: true, audience: ["leo"] },
  { metrics: ["steps", "steps"], share: true, audience: ["leo"] },
  { metrics: ["steps"], share: true, audience: ["leo", "leo"] },
  { metrics: ["steps"], share: true, audience: ["leo"], memberId: "sam" },
])("rejects an invalid consent payload before effects: %j", async body => {
  expect((await PUT(request(body))).status).toBe(400);
  expect(mocks.share).not.toHaveBeenCalled();
});

it("passes the exact approved audience once and returns only committed recipients", async () => {
  const body = { metrics: ["steps", "sleep"], share: true, audience: ["leo"] };
  const sharedWith = [{ memberId: "leo", firstName: "Leo", avatarUrl: null, metrics: body.metrics }];
  mocks.share.mockResolvedValueOnce({ ok: true, sharedWith });
  const response = await PUT(request(body));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: true, sharedWith });
  expect(mocks.share).toHaveBeenCalledExactlyOnceWith({ member: { id: "ava" } }, body, expect.any(AbortSignal));
});

it("preserves committed outcomes in a partial failure response", async () => {
  const sharedWith = [{ memberId: "leo", firstName: "Leo", avatarUrl: null, metrics: ["steps"] }];
  mocks.share.mockRejectedValueOnce(hostedOnboardingError({ code: "PROGRESS_SHARING_AUDIENCE_CHANGED", httpStatus: 409,
    message: "Your sharing audience changed. Reload before sharing.", details: { sharedWith } }));
  const response = await PUT(request({ metrics: ["steps"], share: true, audience: ["leo", "sam"] }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "PROGRESS_SHARING_AUDIENCE_CHANGED", details: { sharedWith } } });
});
