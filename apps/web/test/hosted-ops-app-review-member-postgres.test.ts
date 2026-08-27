import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const privyProvider = vi.hoisted(() => ({
  deleteAfterInitialRead: false,
  exactReads: vi.fn(),
  initialReads: vi.fn(),
  missingUserIds: new Set<string>(),
  usersByEmail: new Map<string, {
    id: string;
    linked_accounts: Array<{
      address: string;
      type: "email";
      verified_at: number;
    }>;
  }>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@privy-io/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@privy-io/node")>();

  return {
    ...actual,
    PrivyClient: class PrivyClient {
      users() {
        return {
          _get: async (userId: string, options?: unknown) => {
            privyProvider.exactReads(userId, options);
            if (privyProvider.missingUserIds.has(userId)) {
              throw Object.assign(new Error("Privy user was deleted."), {
                headers: new Headers({ "x-should-retry": "false" }),
                status: 404,
              });
            }
            const user = [...privyProvider.usersByEmail.values()]
              .find((candidate) => candidate.id === userId);
            if (!user) {
              throw new Error("Privy test user is not configured.");
            }
            return user;
          },
          getByEmailAddress: async ({ address }: { address: string }) => {
            privyProvider.initialReads(address);
            const user = privyProvider.usersByEmail.get(address);
            if (!user) {
              throw new Error("Privy test email is not configured.");
            }
            if (privyProvider.deleteAfterInitialRead) {
              privyProvider.missingUserIds.add(user.id);
            }
            return user;
          },
        };
      }
    },
  };
});

vi.mock("@/src/lib/hosted-crypto/env", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/env")
  >();
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<
    typeof import("@murphai/runtime-state")
  >("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName =
    "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    NODE_ENV: "test",
  });

  return {
    ...actual,
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName,
      authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({
        activeKeyVersionName: authoritySignKeyVersionName,
        activePublicKeyPem: authorityKey.publicKey,
      }),
      env: "test",
      gcpKms,
      webWrapKmsKeyName:
        "projects/example/locations/global/keyRings/hosted/cryptoKeys/app-review",
    }),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    prepareHostedCryptoDomainRootCandidates: vi.fn(async () => new Map()),
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForPositiveSourceTx: vi.fn(async () => ({
    activated: false,
  })),
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/legal/consent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/legal/consent")>();
  return {
    ...actual,
    readHostedConsentStatus: vi.fn(async () => ({
      launchScopes: [
        { granted: true, scope: "launch.legal" },
        { granted: true, scope: "launch.health-data" },
      ],
    })),
    recordHostedLaunchRequiredConsent: vi.fn(async () => undefined),
  };
});

import {
  provisionActiveHostedDomainRootEnvelopeForUserOnly,
  readActiveHostedDomainRootEnvelopeOrThrow,
} from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  readHostedMemberIdentityControlRootKeyIds,
  readHostedMemberIdentityRecord,
  upsertHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { createHostedPrivyUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { prepareHostedOpsAppReviewMember } from "@/src/lib/hosted-ops/app-review-member";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The hosted App Review member proof requires a local DATABASE_URL.");
}

const previousPrivyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const previousPrivyAppSecret = process.env.PRIVY_APP_SECRET;

function buildPrivyUser(input: { email: string; userId: string }) {
  return {
    id: input.userId,
    linked_accounts: [{
      address: input.email,
      type: "email" as const,
      verified_at: 1_775_203_200,
    }],
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "cm_app_review_test";
  process.env.PRIVY_APP_SECRET = "synthetic-app-review-secret";
  Reflect.deleteProperty(globalThis, "__murphHostedPrivyManagementClient");
  privyProvider.deleteAfterInitialRead = false;
  privyProvider.exactReads.mockClear();
  privyProvider.initialReads.mockClear();
  privyProvider.missingUserIds.clear();
  privyProvider.usersByEmail.clear();
  setHostedSecureBoxStringTestCodecForTests(null);
});

afterEach(() => {
  restoreEnvironment("NEXT_PUBLIC_PRIVY_APP_ID", previousPrivyAppId);
  restoreEnvironment("PRIVY_APP_SECRET", previousPrivyAppSecret);
  Reflect.deleteProperty(globalThis, "__murphHostedPrivyManagementClient");
  setHostedSecureBoxStringTestCodecForTests(null);
});

describe.skipIf(!runPostgresProof)(
  "hosted Ops App Review member PostgreSQL authority",
  () => {
    it("rejects a Privy user deleted after the initial principal read before member mutation", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const email = `app-review-deleted-${fixtureId}@example.test`;
      const userId = `did:privy:app-review-deleted-${fixtureId}`;
      const privyUserLookupKey = createHostedPrivyUserLookupKey(userId);
      privyProvider.usersByEmail.set(email, buildPrivyUser({ email, userId }));
      privyProvider.deleteAfterInitialRead = true;

      try {
        await expect(prepareHostedOpsAppReviewMember({
          mode: "apply",
          principal: { kind: "email", value: email },
          prisma,
        })).rejects.toMatchObject({
          code: "PRIVY_USER_LOOKUP_FAILED",
        });

        expect(privyProvider.initialReads).toHaveBeenCalledOnce();
        expect(privyProvider.exactReads).toHaveBeenCalledOnce();
        await expect(prisma.hostedMemberIdentity.count({
          where: { privyUserLookupKey },
        })).resolves.toBe(0);
      } finally {
        const unexpectedMembers = await prisma.hostedMemberIdentity.findMany({
          select: { memberId: true },
          where: { privyUserLookupKey },
        });
        await prisma.hostedMember.deleteMany({
          where: {
            id: { in: unexpectedMembers.map(({ memberId }) => memberId) },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("preloads an existing member identity sealed under its historical control root", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const fixtureId = randomUUID();
      const memberId = `hbm_app_review_historical_${fixtureId}`;
      const email = `app-review-historical-${fixtureId}@example.test`;
      const userId = `did:privy:app-review-historical-${fixtureId}`;
      privyProvider.usersByEmail.set(email, buildPrivyUser({ email, userId }));

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await provisionActiveHostedDomainRootEnvelopeForUserOnly({
          domain: "control",
          prisma,
          reason: "test.app-review-historical-root",
          userId: memberId,
        });
        const historicalRoot = await readActiveHostedDomainRootEnvelopeOrThrow({
          domain: "control",
          prisma,
          userId: memberId,
        });
        await runWithHostedDomainRootUnwrapCache(() => prisma.$transaction((tx) =>
          upsertHostedMemberIdentity({
            maskedPhoneNumberHint: null,
            memberId,
            phoneLookupKey: null,
            phoneNumber: null,
            phoneNumberVerifiedAt: null,
            prisma: tx,
            privyUserId: userId,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumber: null,
          })
        ));
        await prisma.hostedUserCryptoEnvelope.updateMany({
          data: {
            decryptOnlyAt: new Date("2026-08-26T12:00:00.000Z"),
            status: "decrypt_only",
          },
          where: {
            domain: "control",
            rootKeyId: historicalRoot.rootKeyId,
            userId: memberId,
          },
        });
        await provisionActiveHostedDomainRootEnvelopeForUserOnly({
          domain: "control",
          prisma,
          reason: "test.app-review-current-root",
          userId: memberId,
        });
        const currentRoot = await readActiveHostedDomainRootEnvelopeOrThrow({
          domain: "control",
          prisma,
          userId: memberId,
        });
        const identityRecord = await readHostedMemberIdentityRecord({ memberId, prisma });

        expect(currentRoot.rootKeyId).not.toBe(historicalRoot.rootKeyId);
        expect(readHostedMemberIdentityControlRootKeyIds(identityRecord))
          .toContain(historicalRoot.rootKeyId);

        await expect(prepareHostedOpsAppReviewMember({
          mode: "apply",
          principal: { kind: "email", value: email },
          prisma,
        })).resolves.toMatchObject({
          action: "applied",
          member: expect.any(String),
        });
        expect(privyProvider.initialReads).toHaveBeenCalledOnce();
        expect(privyProvider.exactReads).toHaveBeenCalledOnce();
      } finally {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
