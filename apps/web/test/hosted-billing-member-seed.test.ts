import { beforeEach, describe, expect, it, vi } from "vitest";

import { isHostedMemberMessagingSetupRequired } from "@/src/lib/hosted-onboarding/messaging-state";
import { seedHostedBillingMemberForTest } from "./support/hosted-billing-live-testkit";

const database = vi.hoisted(() => ({
  createMember: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  upsertEmail: vi.fn(async () => undefined),
  upsertIdentity: vi.fn(async (_input: {
    phoneLookupKey: string | null;
    phoneNumber: string | null;
    phoneNumberVerifiedAt: Date | null;
    privyUserId: string | null;
  }) => undefined),
}));

vi.mock("@/src/lib/prisma", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/prisma")>(),
  createPrismaClient: () => ({
    $disconnect: database.disconnect,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      hostedMember: {
        findUnique: async () => null,
        update: async () => undefined,
      },
    }),
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/hosted-member-store")>(),
  createHostedMember: database.createMember,
  upsertHostedMemberEmailAuthorization: database.upsertEmail,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/hosted-member-identity-store")>(),
  upsertHostedMemberIdentity: database.upsertIdentity,
}));

describe("billing fixture messaging readiness", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, "+12025550173"])(
    "preserves onboarding messaging requirements with phone %s",
    async (verifiedPhoneNumber) => {
      await seedHostedBillingMemberForTest({
        billingStatus: "not_started",
        environment: {
          DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
          NODE_ENV: "test",
        },
        memberId: "member_billing_seed",
        previouslyActivated: false,
        privyUserId: "did:privy:billing_seed",
        verifiedEmail: "billing-seed@example.invalid",
        verifiedPhoneNumber,
      });

      expect(database.upsertIdentity).toHaveBeenCalledOnce();
      const identity = database.upsertIdentity.mock.calls[0]?.[0];
      expect(identity).toBeDefined();
      if (!identity) throw new Error("Missing seeded identity");
      expect(identity.privyUserId).toBe("did:privy:billing_seed");
      expect(identity.phoneNumber).toBe(verifiedPhoneNumber ?? null);
      expect(identity.phoneNumberVerifiedAt instanceof Date)
        .toBe(verifiedPhoneNumber !== undefined);
      expect(isHostedMemberMessagingSetupRequired({
        identity: { ...identity, emailLinked: true },
        routing: null,
      })).toBe(verifiedPhoneNumber === undefined);
      expect(database.disconnect).toHaveBeenCalledOnce();
    },
  );
});
