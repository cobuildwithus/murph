import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptHostedWebNullableString: vi.fn(),
  encryptHostedWebNullableStringFromPreparedRoot: vi.fn(),
  revalidatePreparedHostedDomainRootForWebTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-web/encryption", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-web/encryption")
  >();
  return {
    ...actual,
    decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
    encryptHostedWebNullableStringFromPreparedRoot:
      mocks.encryptHostedWebNullableStringFromPreparedRoot,
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    revalidatePreparedHostedDomainRootForWebTx:
      mocks.revalidatePreparedHostedDomainRootForWebTx,
  };
});

import {
  readHostedMemberSignupNotificationContext,
  writeHostedMemberSignupNotificationContextIfPendingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { activeHostedMemberAccessWhere } from "@/src/lib/hosted-onboarding/member-access";

const CONTEXT = {
  schema: "murph.hosted-signup-notification-context.v1" as const,
  occurredAt: "2026-08-21T00:07:00.000Z",
  surface: "website" as const,
  timeZone: "America/New_York",
  location: {
    city: "Atlanta",
    country: "US",
    countryRegion: "GA",
  },
};

describe("hosted signup notification context store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revalidatePreparedHostedDomainRootForWebTx.mockResolvedValue({
      root: Promise.resolve({
        envelope: { rootKeyId: "root_control_123" },
        rootKey: new Uint8Array(32),
      }),
      rootKeyId: "root_control_123",
    });
    mocks.encryptHostedWebNullableStringFromPreparedRoot.mockResolvedValue(
      "encrypted-context",
    );
  });

  it("encrypts the first pending context under the member control root", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      hostedMember: { updateMany },
    };
    const preparedControlRoot = {
      domain: "control",
      rootKeyId: "root_control_123",
      userId: "member_123",
    };

    await expect(writeHostedMemberSignupNotificationContextIfPendingTx({
      context: CONTEXT,
      memberId: "member_123",
      preparedControlRoot: preparedControlRoot as never,
      prisma: tx as never,
    })).resolves.toBe(true);

    expect(mocks.revalidatePreparedHostedDomainRootForWebTx).toHaveBeenCalledWith({
      prepared: preparedControlRoot,
      tx,
    });
    expect(mocks.encryptHostedWebNullableStringFromPreparedRoot).toHaveBeenCalledWith({
      field: "hosted-member.signup-notification-context",
      memberId: "member_123",
      prepared: {
        preparedRoot: expect.any(Promise),
        preparedRootKeyId: "root_control_123",
      },
      value: JSON.stringify(CONTEXT),
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        signupNotificationContextEncrypted: "encrypted-context",
        signupNotificationContextExpiresAt: new Date("2026-08-22T00:07:00.000Z"),
      },
      where: {
        NOT: activeHostedMemberAccessWhere(),
        id: "member_123",
        signupNotificationContextEncrypted: null,
        signupNotificationEmailAttemptedAt: null,
      },
    });
  });

  it("decrypts and validates the pending context without returning its ciphertext", async () => {
    const createdAt = new Date("2026-08-21T00:07:00.000Z");
    const findUnique = vi.fn().mockResolvedValue({
      createdAt,
      id: "member_123",
      signupNotificationContextEncrypted: "encrypted-context",
      signupNotificationContextExpiresAt: new Date("2026-08-22T00:07:00.000Z"),
    });
    mocks.decryptHostedWebNullableString.mockResolvedValue(JSON.stringify(CONTEXT));

    await expect(readHostedMemberSignupNotificationContext({
      memberId: "member_123",
      now: new Date("2026-08-21T12:00:00.000Z"),
      prisma: { hostedMember: { findUnique } } as never,
    })).resolves.toEqual({
      context: CONTEXT,
      createdAt,
    });

    expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledWith({
      field: "hosted-member.signup-notification-context",
      memberId: "member_123",
      prisma: expect.any(Object),
      value: "encrypted-context",
    });
  });

  it("treats malformed decrypted context as optional projection data", async () => {
    const createdAt = new Date("2026-08-21T00:07:00.000Z");
    mocks.decryptHostedWebNullableString.mockResolvedValue("{not-json");

    await expect(readHostedMemberSignupNotificationContext({
      memberId: "member_123",
      prisma: {
        hostedMember: {
          findUnique: vi.fn().mockResolvedValue({
            createdAt,
            id: "member_123",
            signupNotificationContextEncrypted: "encrypted-context",
            signupNotificationContextExpiresAt: new Date("2026-08-22T00:07:00.000Z"),
          }),
        },
      } as never,
      now: new Date("2026-08-21T12:00:00.000Z"),
    })).resolves.toEqual({
      context: null,
      createdAt,
    });
  });

  it("treats unreadable encrypted context as optional projection data", async () => {
    const createdAt = new Date("2026-08-21T00:07:00.000Z");
    mocks.decryptHostedWebNullableString.mockRejectedValue(
      new Error("synthetic decrypt failure"),
    );

    await expect(readHostedMemberSignupNotificationContext({
      memberId: "member_123",
      prisma: {
        hostedMember: {
          findUnique: vi.fn().mockResolvedValue({
            createdAt,
            id: "member_123",
            signupNotificationContextEncrypted: "encrypted-context",
            signupNotificationContextExpiresAt: new Date("2026-08-22T00:07:00.000Z"),
          }),
        },
      } as never,
      now: new Date("2026-08-21T12:00:00.000Z"),
    })).resolves.toEqual({
      context: null,
      createdAt,
    });
  });

  it("does not decrypt context after its disclosure window expires", async () => {
    const createdAt = new Date("2026-08-21T00:07:00.000Z");

    await expect(readHostedMemberSignupNotificationContext({
      memberId: "member_123",
      now: new Date("2026-08-22T00:07:00.000Z"),
      prisma: {
        hostedMember: {
          findUnique: vi.fn().mockResolvedValue({
            createdAt,
            id: "member_123",
            signupNotificationContextEncrypted: "encrypted-context",
            signupNotificationContextExpiresAt: new Date("2026-08-22T00:07:00.000Z"),
          }),
        },
      } as never,
    })).resolves.toEqual({
      context: null,
      createdAt,
    });
    expect(mocks.decryptHostedWebNullableString).not.toHaveBeenCalled();
  });
});
