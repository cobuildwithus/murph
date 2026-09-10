import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), prisma: {} }));
vi.mock("@/src/lib/hosted-onboarding/linq-production-canary-outcome", () => ({
  readHostedLinqProductionCanaryOutcome: mocks.read,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));

import { GET } from "@/app/api/internal/hosted-onboarding/linq/production-canary/outcome/route";

const endpoint = "https://example.test/api/internal/hosted-onboarding/linq/production-canary/outcome";

describe("fixed-target production canary outcome route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER", "+15555550123");
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_RESET_SECRET", "synthetic-canary-bearer");
    mocks.read.mockResolvedValue({ ready: true, totalGoalCount: 1, matchingGoalCount: 1, matchingGoalIdCount: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the existing fixed bearer and exposes only uncached outcome metadata", async () => {
    const response = await GET(new Request(endpoint, {
      headers: { authorization: "Bearer synthetic-canary-bearer" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, outcome: {
      ready: true, totalGoalCount: 1, matchingGoalCount: 1, matchingGoalIdCount: 1,
    } });
    expect(mocks.read).toHaveBeenCalledWith({ prisma: mocks.prisma });
  });

  it("authenticates before inspecting a caller-supplied member selector or body", async () => {
    const request = new Request(`${endpoint}?memberId=unrelated-member`, { method: "POST", body: "{}" });
    const readBody = vi.spyOn(request, "arrayBuffer");
    expect((await GET(request)).status).toBe(401);
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(["memberId=unrelated-member", "phone=%2B15555550000", "run=untrusted", "title=untrusted"])(
    "rejects every query selector (%s)", async (query) => {
      const response = await GET(new Request(`${endpoint}?${query}`, {
        headers: { authorization: "Bearer synthetic-canary-bearer" },
      }));
      expect(response.status).toBe(400);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it.each(["x", "{}"])("rejects nonempty bodies before reading canonical data", async (body) => {
    const response = await GET(new Request(endpoint, {
      method: "POST", body, headers: { authorization: "Bearer synthetic-canary-bearer" },
    }));
    expect([400, 413]).toContain(response.status);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("fails closed without the configured canary target", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER", "");
    expect((await GET(new Request(endpoint, {
      headers: { authorization: "Bearer synthetic-canary-bearer" },
    }))).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
