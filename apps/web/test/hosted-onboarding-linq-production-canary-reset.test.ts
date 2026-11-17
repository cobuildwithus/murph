import { createHash } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { PrismaHostedWebInternalRequestNonceStore } from "@/src/lib/hosted-execution/internal-request-nonces";
import { LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createParticipantContact: vi.fn(),
  deleteAccountData: vi.fn(),
  lookupIdentity: vi.fn(),
  resetAdmission: vi.fn(),
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedLinqProductionCanaryAccountData: mocks.deleteAccountData,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-first-contact-admission", () => ({
  resetHostedLinqFirstContactAdmissionForCanaryTx: mocks.resetAdmission,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-participant-contact", () => ({
  createHostedLinqParticipantContact: mocks.createParticipantContact,
}));

import {
  requireHostedLinqProductionCanaryResetRequest,
  resetHostedLinqProductionCanary,
} from "@/src/lib/hosted-onboarding/linq-production-canary-reset";
import {
  readHostedLinqProductionCanaryMemberId,
  readHostedLinqProductionCanaryPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-production-canary";

const CONFIGURED_ENVIRONMENT = {
  HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER: "+15551234567",
};

function asCanaryResetPrismaClient(value: object): PrismaClient {
  return value as PrismaClient;
}

describe("Hosted Linq production canary identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupIdentity.mockResolvedValue(null);
  });

  it("normalizes the configured phone", () => {
    const source = {
      HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER: "+1 (555) 123-4567",
    };

    expect(readHostedLinqProductionCanaryPhoneNumber(source))
      .toBe("+15551234567");
  });

  it("resolves the current canary member through the canonical identity lookup", async () => {
    const prisma = asCanaryResetPrismaClient({});
    mocks.lookupIdentity.mockResolvedValue({ core: { id: "member_canary" } });

    await expect(readHostedLinqProductionCanaryMemberId({
      prisma,
      source: CONFIGURED_ENVIRONMENT,
    })).resolves.toBe("member_canary");
    expect(mocks.lookupIdentity).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma,
      projection: "core",
    });
  });

  it("does no identity lookup when the canary is not configured", async () => {
    await expect(readHostedLinqProductionCanaryMemberId({
      prisma: asCanaryResetPrismaClient({}),
      source: {},
    })).resolves.toBeNull();
    expect(mocks.lookupIdentity).not.toHaveBeenCalled();
  });
});

describe("Hosted Linq production canary reset authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createParticipantContact.mockReturnValue({
      kind: "phone",
      lookupKey: "blind:test-canary",
      value: "+15551234567",
    });
    mocks.resetAdmission.mockResolvedValue({
      admissionBudgetCount: 1,
      admissionDecisionCount: 1,
      deliveryClaimCount: 1,
    });
    mocks.lookupIdentity.mockResolvedValue(null);
    mocks.deleteAccountData.mockResolvedValue({});
  });

  it("rejects a non-OIDC bearer without exposing the target", async () => {
    const request = new Request("https://example.test/internal", {
      headers: { authorization: "Bearer incorrect-secret" },
      method: "POST",
    });

    await expect(requireHostedLinqProductionCanaryResetRequest(
      request,
      CONFIGURED_ENVIRONMENT,
    )).rejects.toThrow(expect.objectContaining({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_UNAUTHORIZED",
      httpStatus: 401,
    }));
  });

  it("fails closed when the fixed target is absent", async () => {
    const request = new Request("https://example.test/internal", {
      headers: { authorization: "Bearer test-reset-secret" },
      method: "POST",
    });

    await expect(requireHostedLinqProductionCanaryResetRequest(request, {}))
      .rejects.toThrow(expect.objectContaining({
        code: "HOSTED_LINQ_PRODUCTION_CANARY_CONFIGURATION_REQUIRED",
        httpStatus: 503,
      }));
  });
});

describe("Hosted Linq production canary reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createParticipantContact.mockReturnValue({
      kind: "phone",
      lookupKey: "blind:test-canary",
      value: "+15551234567",
    });
    mocks.resetAdmission.mockResolvedValue({
      admissionBudgetCount: 1,
      admissionDecisionCount: 1,
      deliveryClaimCount: 1,
    });
    mocks.lookupIdentity.mockResolvedValue(null);
    mocks.deleteAccountData.mockResolvedValue({});
  });

  it("clears safe first-contact residue before deleting the canonical canary account", async () => {
    const transaction = vi.fn(async (
      callback: (tx: object) => Promise<unknown>,
    ) => callback({}));
    const prisma = asCanaryResetPrismaClient({ $transaction: transaction });
    const request = new Request("https://example.test/internal", {
      method: "POST",
    });
    mocks.lookupIdentity.mockResolvedValue({ core: { id: "member_canary" } });

    await expect(resetHostedLinqProductionCanary({
      phoneNumber: "+15551234567",
      prisma,
      request,
    })).resolves.toEqual({
      accountDeleted: true,
      admissionBudgetCount: 1,
      admissionDecisionCount: 1,
      deliveryClaimCount: 1,
    });
    expect(mocks.resetAdmission).toHaveBeenCalledOnce();
    expect(mocks.lookupIdentity).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma,
      projection: "core",
    });
    expect(mocks.deleteAccountData).toHaveBeenCalledWith({
      memberId: "member_canary",
      prisma,
      request,
    });
    expect(mocks.resetAdmission.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.lookupIdentity.mock.invocationCallOrder[0]);
    expect(mocks.lookupIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deleteAccountData.mock.invocationCallOrder[0]);
  });

  it("is idempotent when the canary account is already absent", async () => {
    const prisma = asCanaryResetPrismaClient({
      $transaction: vi.fn(async (
        callback: (tx: object) => Promise<unknown>,
      ) => callback({})),
    });

    await expect(resetHostedLinqProductionCanary({
      phoneNumber: "+15551234567",
      prisma,
      request: new Request("https://example.test/internal", { method: "POST" }),
    })).resolves.toMatchObject({ accountDeleted: false });
    expect(mocks.deleteAccountData).not.toHaveBeenCalled();
  });

  it("does not inspect or delete the account when delivery ownership is unsafe", async () => {
    const unsafe = new Error("unsafe-delivery");
    mocks.resetAdmission.mockRejectedValueOnce(unsafe);
    const prisma = asCanaryResetPrismaClient({
      $transaction: vi.fn(async (
        callback: (tx: object) => Promise<unknown>,
      ) => callback({})),
    });

    await expect(resetHostedLinqProductionCanary({
      phoneNumber: "+15551234567",
      prisma,
      request: new Request("https://example.test/internal", { method: "POST" }),
    })).rejects.toBe(unsafe);
    expect(mocks.lookupIdentity).not.toHaveBeenCalled();
    expect(mocks.deleteAccountData).not.toHaveBeenCalled();
  });
});


describe("GitHub OIDC canary authorization", () => {
  const issuer = "https://token.actions.githubusercontent.com";
  const now = Date.parse("2026-11-16T12:00:00Z");
  const claims: JWTPayload = {
    iss: issuer, aud: LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE,
    repository_owner: "cobuildwithus", repository: "cobuildwithus/murph",
    workflow_ref: "cobuildwithus/murph/.github/workflows/linq-production-canary.yml@refs/heads/main",
    ref: "refs/heads/main", event_name: "schedule", jti: "synthetic-reset-jti",
    environment: "production", sub: "repo:cobuildwithus/murph:environment:production",
    iat: now / 1_000, nbf: now / 1_000, exp: now / 1_000 + 300,
  };
  const source = { HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER: "+15551234567" };
  const keys = generateKeyPair("RS256");
  async function harness() {
    const { privateKey, publicKey } = await keys;
    const keyResolver = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" }] });
    const consumed = new Set<string>();
    const queryRaw = vi.fn(async (_sql: TemplateStringsArray, hash: string) => {
      if (consumed.has(hash)) return [];
      consumed.add(hash);
      return [{ admitted: true }];
    });
    const nonceStore = new PrismaHostedWebInternalRequestNonceStore(asCanaryResetPrismaClient({ $queryRaw: queryRaw }));
    const dependencies = { keyResolver, nonceStore, now: () => now };
    return {
      queryRaw, dependencies,
      sign: (overrides: JWTPayload = {}) => new SignJWT({ ...claims, ...overrides })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey),
      authorize: (token: string, method = "POST", environment = source) => requireHostedLinqProductionCanaryResetRequest(
        new Request(`https://example.test/internal/${method === "POST" ? "reset" : "outcome"}`, {
          method, headers: { authorization: `Bearer ${token}` },
        }), environment, dependencies,
      ),
    };
  }

  it.each(["schedule", "workflow_dispatch"])("accepts the trusted %s workflow without a static key", async (event_name) => {
    const h = await harness();
    await expect(h.authorize(await h.sign({ event_name }))).resolves.toBe("+15551234567");
  });

  it.each([
    ["iss", "https://untrusted.test"], ["aud", "other-audience"],
    ["aud", [LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE, "other-audience"]],
    ["repository_owner", "other-owner"], ["repository", "cobuildwithus/other"],
    ["workflow_ref", "cobuildwithus/murph/.github/workflows/other.yml@refs/heads/main"],
    ["workflow_ref", "cobuildwithus/murph/.github/workflows/linq-production-canary.yml@refs/heads/feature"],
    ["ref", "refs/heads/feature"], ["environment", "preview"], ["environment", undefined],
    ["sub", "repo:cobuildwithus/murph:ref:refs/heads/main"], ["event_name", "pull_request"], ["event_name", ["schedule"]],
    ["exp", now / 1_000 - 1], ["exp", now / 1_000], ["exp", undefined],
    ["iat", now / 1_000 + 60], ["nbf", now / 1_000 + 60],
    ["jti", undefined], ["jti", ""],
  ])("rejects invalid %s claims before nonce consumption", async (claim, value) => {
    const h = await harness();
    await expect(h.authorize(await h.sign({ [claim as string]: value }))).rejects.toMatchObject({ httpStatus: 401 });
    expect(h.queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a bad signature", async () => {
    const h = await harness();
    const other = await generateKeyPair("RS256");
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(other.privateKey);
    await expect(h.authorize(token, "POST", CONFIGURED_ENVIRONMENT)).rejects.toMatchObject({ httpStatus: 401 });
    expect(h.queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a non-RS256 signature", async () => {
    const h = await harness();
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" })
      .sign(new Uint8Array(32).fill(1));
    await expect(h.authorize(token)).rejects.toMatchObject({ httpStatus: 401 });
    expect(h.queryRaw).not.toHaveBeenCalled();
  });

  it("allows five seconds of not-before skew without extending expiry", async () => {
    const h = await harness();
    await expect(h.authorize(await h.sign({ nbf: now / 1_000 + 4, iat: now / 1_000 + 4 }), "GET"))
      .resolves.toBe("+15551234567");
    expect(h.queryRaw).not.toHaveBeenCalled();
  });

  it("admits exactly one concurrent reset and permits repeated status reads of that token", async () => {
    const h = await harness();
    const token = await h.sign();
    const results = await Promise.allSettled([h.authorize(token), h.authorize(token)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(h.queryRaw).toHaveBeenCalledTimes(2);
    expect(h.queryRaw.mock.calls[0]?.slice(1)).toEqual([
      createHash("sha256").update(`${issuer}\n${claims.jti}`).digest("hex"),
      "github-actions:linq-production-canary", "POST", "/internal/reset", "",
      new Date(now).toISOString(), new Date(now + 300_000).toISOString(),
    ]);
    await expect(h.authorize(token, "GET")).resolves.toBe("+15551234567");
    await expect(h.authorize(token, "GET")).resolves.toBe("+15551234567");
    expect(h.queryRaw).toHaveBeenCalledTimes(2);
    h.dependencies.now = () => now + 300_001;
    await expect(h.authorize(token, "GET")).rejects.toMatchObject({ httpStatus: 401 });
  });

  it("fails closed on nonce-store failure", async () => {
    const h = await harness();
    h.queryRaw.mockRejectedValueOnce(new Error("Synthetic storage failure"));
    await expect(h.authorize(await h.sign())).rejects.toThrow("Synthetic storage failure");
  });

  it("ignores the retired static reset secret even if it is configured again", async () => {
    const h = await harness();
    const retired = { ...source, HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_RESET_SECRET: "test-reset-secret" };
    await expect(h.authorize("test-reset-secret", "POST", retired)).rejects.toMatchObject({ httpStatus: 401 });
    expect(h.queryRaw).not.toHaveBeenCalled();
  });
});
