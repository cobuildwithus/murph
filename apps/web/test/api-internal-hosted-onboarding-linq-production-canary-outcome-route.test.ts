import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  prisma: { $queryRaw: vi.fn(async () => [{ admitted: true }]) },
  keys: null as JWTVerifyGetKey | null,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-production-canary-outcome", () => ({
  readHostedLinqProductionCanaryOutcome: mocks.read,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
// GitHub's JWKS is replaced by a local test key; claim checks stay real.
vi.mock("jose", async (importOriginal) => ({
  ...await importOriginal<typeof import("jose")>(),
  createRemoteJWKSet: () => ((...args: Parameters<JWTVerifyGetKey>) => mocks.keys!(...args)) as JWTVerifyGetKey,
}));

import { GET } from "@/app/api/internal/hosted-onboarding/linq/production-canary/outcome/route";
import { LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";

let token = "";
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  mocks.keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" }] });
  const now = Math.floor(Date.now() / 1_000);
  token = await new SignJWT({
    aud: LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE, repository_owner: "cobuildwithus", repository: "cobuildwithus/murph",
    workflow_ref: "cobuildwithus/murph/.github/workflows/linq-production-canary.yml@refs/heads/main",
    ref: "refs/heads/main", event_name: "schedule", environment: "production",
    sub: "repo:cobuildwithus/murph:environment:production", jti: "synthetic-outcome-jti",
  }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://token.actions.githubusercontent.com")
    .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 3_600).sign(privateKey);
});

const endpoint = "https://example.test/api/internal/hosted-onboarding/linq/production-canary/outcome";

describe("fixed-target production canary outcome route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER", "+15555550123");
    mocks.read.mockResolvedValue({ ready: true, totalGoalCount: 1, matchingGoalCount: 1, matchingGoalIdCount: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the trusted workflow OIDC token and exposes only uncached outcome metadata", async () => {
    const response = await GET(new Request(endpoint, {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, outcome: {
      ready: true, totalGoalCount: 1, matchingGoalCount: 1, matchingGoalIdCount: 1,
    } });
    expect(mocks.read).toHaveBeenCalledWith({ prisma: mocks.prisma });
  });

  it("rejects the retired static bearer even if it is configured again", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_RESET_SECRET", "synthetic-canary-bearer");
    expect((await GET(new Request(endpoint, { headers: { authorization: "Bearer synthetic-canary-bearer" } }))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
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
        headers: { authorization: `Bearer ${token}` },
      }));
      expect(response.status).toBe(400);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it.each(["x", "{}"])("rejects nonempty bodies before reading canonical data", async (body) => {
    const response = await GET(new Request(endpoint, {
      method: "POST", body, headers: { authorization: `Bearer ${token}` },
    }));
    expect([400, 413]).toContain(response.status);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("fails closed without the configured canary target", async () => {
    vi.stubEnv("HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER", "");
    expect((await GET(new Request(endpoint, {
      headers: { authorization: `Bearer ${token}` },
    }))).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
