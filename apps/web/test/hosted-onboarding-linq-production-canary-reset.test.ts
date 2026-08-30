import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createParticipantContact: vi.fn(),
  deleteAccountData: vi.fn(),
  lookupIdentity: vi.fn(),
  resetAdmission: vi.fn(),
}));

vi.mock("@/src/lib/hosted-privacy/account-data-service", () => ({
  deleteHostedAccountData: mocks.deleteAccountData,
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
  HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_RESET_SECRET: "test-reset-secret",
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

  it("returns the fixed normalized target for the dedicated bearer secret", () => {
    const request = new Request("https://example.test/internal", {
      headers: { authorization: "Bearer test-reset-secret" },
      method: "POST",
    });

    expect(requireHostedLinqProductionCanaryResetRequest(
      request,
      CONFIGURED_ENVIRONMENT,
    )).toBe("+15551234567");
  });

  it("rejects an incorrect bearer secret without exposing the target", () => {
    const request = new Request("https://example.test/internal", {
      headers: { authorization: "Bearer incorrect-secret" },
      method: "POST",
    });

    expect(() => requireHostedLinqProductionCanaryResetRequest(
      request,
      CONFIGURED_ENVIRONMENT,
    )).toThrow(expect.objectContaining({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_UNAUTHORIZED",
      httpStatus: 401,
    }));
  });

  it("fails closed when either fixed-target setting is absent", () => {
    const request = new Request("https://example.test/internal", {
      headers: { authorization: "Bearer test-reset-secret" },
      method: "POST",
    });

    expect(() => requireHostedLinqProductionCanaryResetRequest(request, {}))
      .toThrow(expect.objectContaining({
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
      exitFeedback: null,
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
