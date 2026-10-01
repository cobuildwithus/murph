import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pending: vi.fn(), workspace: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/linq-production-canary", () => ({
  readHostedLinqProductionCanaryMemberId: async () => "member_synthetic_canary",
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxLatestPendingConversationItem: mocks.pending,
}));
vi.mock("@/src/lib/hosted-workspace/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-workspace/store")>(),
  readHostedWorkspace: mocks.workspace,
}));

import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { readHostedLinqProductionCanaryOutcome } from "@/src/lib/hosted-onboarding/linq-production-canary-outcome";
import { createPrismaClient } from "@/src/lib/prisma";

const notReady = { ready: false, totalGoalCount: 0, matchingGoalCount: 0, matchingGoalIdCount: 0 };
const clients: ReturnType<typeof createPrismaClient>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.pending.mockResolvedValue({ id: "synthetic-uncheckpointed-turn" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

function fixture(input?: { absent?: boolean; suspended?: boolean; inactive?: boolean; withdrawn?: boolean }) {
  const member = input?.absent ? null : {
    accountGroupMemberships: [],
    billingRef: null,
    billingStatus: input?.inactive ? HostedBillingStatus.not_started : HostedBillingStatus.active,
    consentGrants: input?.withdrawn ? [{ scope: "launch.health-data", status: "revoked" }] : [],
    suspendedAt: input?.suspended ? new Date("2026-01-01T00:00:00Z") : null,
    threadContainer: null,
  };
  const findUnique = vi.fn().mockResolvedValue(member);
  const findMany = vi.fn().mockResolvedValue([]);
  // Real client shape, with only the reached read delegates replaced. No database
  // connection is opened; unexpected database work targets a closed loopback port.
  const prisma = createPrismaClient({ databaseUrl: "postgresql://test:test@127.0.0.1:1/test" });
  clients.push(prisma);
  Object.defineProperty(prisma, "hostedMember", { value: { findUnique } });
  Object.defineProperty(prisma, "hostedConsentGrant", { value: { findMany } });
  return { prisma, findUnique, findMany };
}

it("admits a fresh messaging-only canary without manufacturing browser consent", async () => {
  const { prisma, findUnique, findMany } = fixture();
  await expect(readHostedLinqProductionCanaryOutcome({ prisma })).resolves.toEqual(notReady);
  expect(mocks.pending).toHaveBeenCalledOnce();
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(findUnique).toHaveBeenCalledTimes(2);
  expect(findMany).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
});

it.each([
  { absent: true }, { suspended: true }, { inactive: true }, { withdrawn: true },
])("refuses disallowed runtime authority before reading canonical state: %j", async (state) => {
  await expect(readHostedLinqProductionCanaryOutcome({ prisma: fixture(state).prisma }))
    .rejects.toMatchObject({ code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE", httpStatus: 503 });
  expect(mocks.pending).not.toHaveBeenCalled();
  expect(mocks.workspace).not.toHaveBeenCalled();
});

it("keeps current launch consent mandatory for the actual Browser Vault authority", async () => {
  const { prisma } = fixture();
  await expect(assertBrowserVaultMemberAuthority({ memberId: "member_synthetic_canary", prisma }))
    .rejects.toMatchObject({ code: "HOSTED_CONSENT_REQUIRED" });
});
