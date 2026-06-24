import {
  PrivyClient,
  verifyIdentityToken,
} from "@privy-io/node";

import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { requireHostedPrivyIdentityToken } from "./privy-token";
import {
  HOSTED_PRIVY_MEMBER_ID_METADATA_KEY,
  readHostedPrivyMemberIdFromVerifiedUser,
  resolveHostedPrivyIdentityFromVerifiedUser,
  type HostedPrivyIdentity,
  type HostedPrivyUser,
} from "./privy-user";
import { getHostedOnboardingEnvironment } from "./runtime";

const globalForHostedPrivy = globalThis as typeof globalThis & {
  __murphHostedPrivyManagementClient?: PrivyClient | null;
};

type HostedPrivyCustomMetadata = NonNullable<HostedPrivyUser["custom_metadata"]>;

export {
  HOSTED_PRIVY_MEMBER_ID_METADATA_KEY,
  resolveHostedPrivyIdentityFromVerifiedUser,
} from "./privy-user";
export type {
  HostedPrivyIdentity,
  HostedPrivyUser,
} from "./privy-user";

export async function requireHostedPrivyIdentity(identityToken: string): Promise<HostedPrivyIdentity> {
  return resolveHostedPrivyIdentityFromVerifiedUser(
    await verifyHostedPrivyIdentityToken(identityToken),
  );
}

export async function verifyHostedPrivyIdentityToken(identityToken: string): Promise<HostedPrivyUser> {
  const token = requireHostedPrivyIdentityToken(identityToken);
  const { appId, verificationKey } = requireHostedPrivyPhoneAuthConfig();

  try {
    const user = await verifyIdentityToken({
      app_id: appId,
      identity_token: token,
      verification_key: verificationKey,
    });

    if (!user || typeof user !== "object" || typeof (user as { id?: unknown }).id !== "string") {
      throw new TypeError("Privy identity verification did not return a valid user object.");
    }

    return user as HostedPrivyUser;
  } catch (error) {
    throw hostedOnboardingError({
      code: "PRIVY_AUTH_FAILED",
      message: "We could not verify your Privy session. Request a fresh code and try again.",
      httpStatus: 401,
      details: {
        cause: error instanceof Error ? error.name : typeof error,
      },
    });
  }
}

export async function syncHostedPrivyMemberIdMetadata(input: {
  memberId: string;
  privyUserId: string;
  verifiedPrivyUser?: HostedPrivyUser | null;
}): Promise<boolean> {
  if (input.verifiedPrivyUser && readHostedPrivyMemberIdFromVerifiedUser(input.verifiedPrivyUser) === input.memberId) {
    return false;
  }

  const client = getHostedPrivyManagementClient();

  if (!client) {
    return false;
  }

  const customMetadata: HostedPrivyCustomMetadata = {
    ...(input.verifiedPrivyUser?.custom_metadata ?? {}),
    [HOSTED_PRIVY_MEMBER_ID_METADATA_KEY]: input.memberId,
  };

  await client.users().setCustomMetadata(input.privyUserId, {
    custom_metadata: customMetadata,
  });

  return true;
}

export async function readHostedPrivyUserById(privyUserId: string): Promise<HostedPrivyUser> {
  const client = getHostedPrivyManagementClient();

  if (!client) {
    throw hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      httpStatus: 503,
      message: "Secure approval is temporarily unavailable.",
      retryable: true,
    });
  }

  try {
    const user = await client.users()._get(privyUserId);
    if (!user || typeof user !== "object" || Reflect.get(user, "id") !== privyUserId) {
      throw new TypeError("Privy user lookup returned an unexpected user.");
    }
    return user as HostedPrivyUser;
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      throw error;
    }
    throw hostedOnboardingError({
      code: "PRIVY_USER_LOOKUP_FAILED",
      httpStatus: 503,
      message: "Secure approval is temporarily unavailable.",
      retryable: true,
    });
  }
}

// Deletes the Privy user record itself (account deletion). Returns false when
// the management client is not configured; throws when the Privy API call fails.
export async function deleteHostedPrivyUser(privyUserId: string): Promise<boolean> {
  const client = getHostedPrivyManagementClient();

  if (!client) {
    return false;
  }

  await client.users().delete(privyUserId);
  return true;
}

export function hasHostedPrivyPhoneAuthConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return readHostedPrivyVerificationConfig({
    appId: source.NEXT_PUBLIC_PRIVY_APP_ID,
    verificationKey: source.PRIVY_VERIFICATION_KEY,
  }) !== null;
}

export function requireHostedPrivyPhoneAuthConfig(): {
  appId: string;
  verificationKey: string;
} {
  const environment = getHostedOnboardingEnvironment();
  const config = readHostedPrivyVerificationConfig({
    appId: environment.privyAppId,
    verificationKey: environment.privyVerificationKey,
  });

  if (!config) {
    throw hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      message:
        "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_VERIFICATION_KEY must be configured for hosted phone signup.",
      httpStatus: 500,
    });
  }

  return config;
}

function normalizeEnvValue(value: string | null | undefined): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function readHostedPrivyVerificationConfig(input: {
  appId: string | null | undefined;
  verificationKey: string | null | undefined;
}): {
  appId: string;
  verificationKey: string;
} | null {
  const appId = normalizeEnvValue(input.appId);
  const verificationKey = normalizeHostedPrivyVerificationKey(input.verificationKey);

  if (!appId || !verificationKey) {
    return null;
  }

  return {
    appId,
    verificationKey,
  };
}

function normalizeHostedPrivyVerificationKey(value: string | null | undefined): string | null {
  const normalized = normalizeEnvValue(value);

  if (!normalized) {
    return null;
  }

  return normalizeEnvValue(normalized.replace(/\\n/g, "\n"));
}

function getHostedPrivyManagementClient(): PrivyClient | null {
  if (globalForHostedPrivy.__murphHostedPrivyManagementClient !== undefined) {
    return globalForHostedPrivy.__murphHostedPrivyManagementClient;
  }

  const environment = getHostedOnboardingEnvironment();
  const client = environment.privyAppId && environment.privyAppSecret
    ? createHostedPrivyClient({
        appId: environment.privyAppId,
        appSecret: environment.privyAppSecret,
      })
    : null;

  if (process.env.NODE_ENV !== "production") {
    globalForHostedPrivy.__murphHostedPrivyManagementClient = client;
  }

  return client;
}

function createHostedPrivyClient(input: {
  appId: string;
  appSecret: string;
}): PrivyClient {
  return new PrivyClient(input);
}

export function remapHostedPrivyCompletionLagError(error: unknown): unknown {
  if (!isHostedOnboardingError(error)) {
    return error;
  }

  if (error.code === "PRIVY_ACCOUNT_REQUIRED") {
    return hostedOnboardingError({
      code: "PRIVY_ACCOUNT_NOT_READY",
      message:
        "Your verified Privy account has not reached the server-side session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  if (error.code === "PRIVY_PHONE_REQUIRED") {
    return hostedOnboardingError({
      code: "PRIVY_PHONE_NOT_READY",
      message:
        "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  if (error.code === "PRIVY_EMAIL_REQUIRED") {
    return hostedOnboardingError({
      code: "PRIVY_EMAIL_NOT_READY",
      message:
        "Your verified email address has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  if (error.code === "PRIVY_TELEGRAM_REQUIRED") {
    return hostedOnboardingError({
      code: "PRIVY_TELEGRAM_NOT_READY",
      message:
        "Your verified Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  return error;
}
