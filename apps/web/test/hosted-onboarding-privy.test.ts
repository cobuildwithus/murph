import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createPrivyClient = vi.fn();
  const privyUsersSetCustomMetadata = vi.fn();
  class PrivyClient {
    constructor(input: unknown) {
      createPrivyClient(input);
    }

    users() {
      return {
        setCustomMetadata: privyUsersSetCustomMetadata,
      };
    }
  }

  return {
    createPrivyClient,
    privyUsersSetCustomMetadata,
    PrivyClient,
    runtimeEnv: {
      privyAppId: "cm_app_123" as string | null,
      privyAppSecret: "app_secret_123" as string | null,
      privyVerificationKey: "line-1\\nline-2" as string | null,
      telegramBotUsername: null as string | null,
      telegramWebhookSecret: null as string | null,
    },
    verifyIdentityToken: vi.fn(),
  };
});

vi.mock("@privy-io/node", () => ({
  PrivyClient: mocks.PrivyClient,
  verifyIdentityToken: mocks.verifyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
}));

import {
  hasHostedPrivyPhoneAuthConfig,
  requireHostedPrivyIdentity,
  requireHostedPrivyPhoneAuthConfig,
  remapHostedPrivyCompletionLagError,
  syncHostedPrivyMemberIdMetadata,
  verifyHostedPrivyIdentityToken,
} from "@/src/lib/hosted-onboarding/privy";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedPrivyIdentityTokenFromCookieHeader,
  readHostedPrivyIdentityTokenFromCookieStore,
  readHostedPrivyIdentityTokenFromRequestCookies,
} from "@/src/lib/hosted-onboarding/privy-token";
import {
  buildHostedPrivySessionState,
  readHostedPrivyMemberIdFromVerifiedUser,
} from "@/src/lib/hosted-onboarding/privy-user";

describe("hosted Privy verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & {
      __murphHostedPrivyManagementClient?: unknown;
    }).__murphHostedPrivyManagementClient;
    mocks.runtimeEnv.privyAppId = "cm_app_123";
    mocks.runtimeEnv.privyAppSecret = "app_secret_123";
    mocks.runtimeEnv.privyVerificationKey = "line-1\\nline-2";
  });

  it("reads the Murph member id from verified Privy custom metadata", () => {
    expect(readHostedPrivyMemberIdFromVerifiedUser({
      custom_metadata: {
        murph_member_id: "member_123",
      },
      id: "did:privy:user_123",
    } as never)).toBe("member_123");
    expect(readHostedPrivyMemberIdFromVerifiedUser({
      custom_metadata: {
        murph_member_id: 123,
      },
      id: "did:privy:user_123",
    } as never)).toBeNull();
  });

  it("builds the shared hosted Privy session state from a verified user", () => {
    expect(buildHostedPrivySessionState({
      custom_metadata: {
        murph_member_id: "member_123",
      },
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    } as never)).toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        telegram: null,
        userId: "did:privy:user_123",
      },
      linkedAccounts: [
        {
          type: "phone",
        },
        {
          type: "wallet",
        },
      ],
      memberId: "member_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
  });

  it("derives server-side phone-auth readiness from the app id plus verification key", () => {
    expect(hasHostedPrivyPhoneAuthConfig({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      hasHostedPrivyPhoneAuthConfig(
        createProcessEnv({
          NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
        }),
      ),
    ).toBe(false);
    expect(
      hasHostedPrivyPhoneAuthConfig(
        createProcessEnv({
          NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
          PRIVY_VERIFICATION_KEY: "privy-verification-key",
        }),
      ),
    ).toBe(true);
  });

  it("rejects verifier config that normalizes to an empty verification key", () => {
    expect(
      hasHostedPrivyPhoneAuthConfig(
        createProcessEnv({
          NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
          PRIVY_VERIFICATION_KEY: "   ",
        }),
      ),
    ).toBe(false);

    mocks.runtimeEnv.privyVerificationKey = "\\n";

    try {
      requireHostedPrivyPhoneAuthConfig();
      expect.fail("Expected an empty normalized verification key to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "PRIVY_CONFIG_REQUIRED",
        httpStatus: 500,
      });
    }
  });

  it("fails fast when the hosted phone-auth config is incomplete", () => {
    mocks.runtimeEnv.privyVerificationKey = null;

    try {
      requireHostedPrivyPhoneAuthConfig();
      expect.fail("Expected hosted phone-auth config to be required.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "PRIVY_CONFIG_REQUIRED",
        httpStatus: 500,
      });
    }
  });

  it("verifies the identity token directly and uses the verified linked accounts", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("  signed-identity-token  ")).resolves.toEqual({
      email: null,
      phone: {
        number: "+14155552671",
        verifiedAt: 1741194420,
      },
      telegram: null,
      userId: "did:privy:user_123",
    });

    expect(mocks.verifyIdentityToken).toHaveBeenCalledWith({
      app_id: "cm_app_123",
      identity_token: "signed-identity-token",
      verification_key: "line-1\nline-2",
    });
    expect(mocks.createPrivyClient).not.toHaveBeenCalled();
  });

  it("verifies the identity token without requiring the app secret on the read path", async () => {
    mocks.runtimeEnv.privyAppSecret = null;
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
      ],
    });

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).resolves.toMatchObject({
      id: "did:privy:user_123",
    });

    expect(mocks.verifyIdentityToken).toHaveBeenCalledWith({
      app_id: "cm_app_123",
      identity_token: "signed-identity-token",
      verification_key: "line-1\nline-2",
    });
    expect(mocks.createPrivyClient).not.toHaveBeenCalled();
  });

  it("reads the hosted Privy identity token from the cookie header", () => {
    expect(readHostedPrivyIdentityTokenFromCookieHeader(null)).toBeNull();
    expect(readHostedPrivyIdentityTokenFromCookieHeader("other=value")).toBeNull();
    expect(readHostedPrivyIdentityTokenFromCookieHeader("privy-id-token=cookie-token")).toBe("cookie-token");
    expect(
      readHostedPrivyIdentityTokenFromCookieHeader("foo=bar; privy-id-token=encoded%2Etoken; hello=world"),
    ).toBe("encoded.token");
  });

  it("reads the hosted Privy identity token from request cookies", () => {
    const request = new Request("https://join.example.test/api/settings/email/sync", {
      headers: {
        cookie: "foo=bar; privy-id-token=cookie-token",
      },
    });

    expect(readHostedPrivyIdentityTokenFromRequestCookies(request)).toBe("cookie-token");
  });

  it("requires a non-empty Privy identity token for hosted verification", async () => {
    await expect(verifyHostedPrivyIdentityToken("   ")).rejects.toMatchObject({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      httpStatus: 401,
    });
    expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
  });

  it("requires the Privy verification key config for hosted verification", async () => {
    mocks.runtimeEnv.privyVerificationKey = null;

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_CONFIG_REQUIRED",
      httpStatus: 500,
    });
    expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
  });

  it("maps direct verifier failures to hosted auth errors", async () => {
    mocks.verifyIdentityToken.mockRejectedValue(new Error("bad token"));

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("syncs the Murph member id into Privy custom metadata when app-secret config is present", async () => {
    await expect(syncHostedPrivyMemberIdMetadata({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      verifiedPrivyUser: {
        custom_metadata: {
          existing_flag: true,
        },
        id: "did:privy:user_123",
      } as never,
    })).resolves.toBe(true);

    expect(mocks.createPrivyClient).toHaveBeenCalledWith({
      appId: "cm_app_123",
      appSecret: "app_secret_123",
    });
    expect(mocks.privyUsersSetCustomMetadata).toHaveBeenCalledWith("did:privy:user_123", {
      custom_metadata: {
        existing_flag: true,
        murph_member_id: "member_123",
      },
    });
  });

  it("skips custom-metadata sync when the verified token already carries the Murph member id", async () => {
    await expect(syncHostedPrivyMemberIdMetadata({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      verifiedPrivyUser: {
        custom_metadata: {
          murph_member_id: "member_123",
        },
        id: "did:privy:user_123",
      } as never,
    })).resolves.toBe(false);

    expect(mocks.privyUsersSetCustomMetadata).not.toHaveBeenCalled();
  });

  it("skips custom-metadata sync when the server-side app secret is unavailable", async () => {
    mocks.runtimeEnv.privyAppSecret = null;

    await expect(syncHostedPrivyMemberIdMetadata({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
      verifiedPrivyUser: null,
    })).resolves.toBe(false);

    expect(mocks.createPrivyClient).not.toHaveBeenCalled();
    expect(mocks.privyUsersSetCustomMetadata).not.toHaveBeenCalled();
  });

  it("maps missing server-side account state to a retryable not-ready error for completion", () => {
    expect(remapHostedPrivyCompletionLagError(hostedOnboardingError({
      code: "PRIVY_ACCOUNT_REQUIRED",
      message: "account required",
      httpStatus: 400,
    }))).toMatchObject({
      code: "PRIVY_ACCOUNT_NOT_READY",
      httpStatus: 409,
      retryable: true,
    });
  });

  it("maps missing server-side phone state to a retryable not-ready error for completion", () => {
    expect(remapHostedPrivyCompletionLagError(hostedOnboardingError({
      code: "PRIVY_PHONE_REQUIRED",
      message: "phone required",
      httpStatus: 400,
    }))).toMatchObject({
      code: "PRIVY_PHONE_NOT_READY",
      httpStatus: 409,
      retryable: true,
    });
  });

  it("does not remap missing server-side wallet state for completion", () => {
    const error = hostedOnboardingError({
      code: "PRIVY_WALLET_REQUIRED",
      message: "wallet required",
      httpStatus: 400,
    });

    expect(remapHostedPrivyCompletionLagError(error)).toBe(error);
  });

  it("passes through non-hosted errors when remapping completion lag failures", () => {
    const error = new Error("boom");
    expect(remapHostedPrivyCompletionLagError(error)).toBe(error);
  });

  it("rejects malformed verifier results", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({});

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("rejects verified sessions whose linked phone account is not actually verified", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_ACCOUNT_REQUIRED",
      httpStatus: 400,
    });
  });

  it("allows verified sessions without an embedded wallet account", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          type: "wallet",
          wallet_client: "metamask",
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("signed-identity-token")).resolves.toMatchObject({
      phone: {
        number: "+14155552671",
      },
      telegram: null,
      userId: "did:privy:user_123",
    });
  });

  it("allows verified sessions that only include a non-ethereum embedded wallet", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "So11111111111111111111111111111111111111112",
          chain_type: "solana",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_solana",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("signed-identity-token")).resolves.toMatchObject({
      phone: {
        number: "+14155552671",
      },
      telegram: null,
      userId: "did:privy:user_123",
    });
  });

  it("reads the Privy identity token from a cookie store", () => {
    expect(
      readHostedPrivyIdentityTokenFromCookieStore({
        get: (name: string) =>
          name === "privy-id-token" ? { value: "identity-token" } : undefined,
      }),
    ).toBe("identity-token");
    expect(
      readHostedPrivyIdentityTokenFromCookieStore({
        get: () => undefined,
      }),
    ).toBeNull();
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
