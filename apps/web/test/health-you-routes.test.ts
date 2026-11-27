import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as you } from "../app/api/game/v1/health/you/route";
import { GET as age } from "../app/api/game/v1/health/you/age/route";
import { GET as week } from "../app/api/game/v1/health/you/week/route";
import { GET as sleep } from "../app/api/game/v1/health/you/sleep/route";
import { GET as fitness } from "../app/api/game/v1/health/you/fitness/route";
import { GET as blood } from "../app/api/game/v1/health/you/blood/route";
import { GET as marker } from "../app/api/game/v1/health/you/markers/[key]/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
const { read, auth } = vi.hoisted(() => ({ read: vi.fn(), auth: { member: { id: "synthetic-owner" } } }));
vi.mock("../src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => auth }));
vi.mock("../src/lib/health-you/read", () => ({ readPrivateYou: read }));
const req = new Request("https://you.example.test/api/game/v1/health/you");
const routes = {
  you,
  age,
  week,
  sleep,
  fitness,
  blood,
  marker: (r: Request) => marker(r, { params: Promise.resolve({ key: "albumin" }) }),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
  vi.stubEnv("MURPH_HEALTH_YOU_MEMBER_IDS", " synthetic-owner ");
});
afterEach(() => vi.unstubAllEnvs());
describe("private You routes", () => {
  it.each(["MURPH_HEALTH_FEED_MEMBER_IDS", "MURPH_HEALTH_YOU_MEMBER_IDS"])(
    "gates every read before service access with %s",
    async (flag) => {
      vi.stubEnv(flag, "other-member");
      for (const handler of Object.values(routes)) {
        const response = await handler(req);
        expect(response.status).toBe(404);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(Object.entries(routes))("serves the bare %s view for the authenticated owner", async (kind, handler) => {
    read.mockResolvedValue({ version: "synthetic" });
    const response = await handler(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "synthetic" });
    expect(read.mock.calls[0].slice(0, 3)).toEqual([auth, kind, req.signal]);
  });
  it("preserves a consent denial", async () => {
    read.mockRejectedValue(
      hostedOnboardingError({ httpStatus: 403, code: "CONSENT_REQUIRED", message: "Consent required." }),
    );
    expect((await you(req)).status).toBe(403);
  });
});
