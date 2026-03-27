import { verifyIdentityToken } from "@privy-io/node";
import { cookies } from "next/headers";

import { hostedOnboardingError } from "./errors";
import {
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyPhoneAccount,
  type HostedPrivyWalletAccount,
  resolveHostedPrivyLinkedAccountState,
} from "./privy-shared";
import { getHostedOnboardingEnvironment } from "./runtime";

interface HostedPrivyUser extends HostedPrivyLinkedAccountContainer {
  id: string;
}

interface HostedPrivyCookieStore {
  get(name: string): { value?: string } | undefined;
}

const HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME = "privy-id-token";

export interface HostedPrivyIdentity {
  phone: HostedPrivyPhoneAccount;
  userId: string;
  wallet: HostedPrivyWalletAccount;
}

export async function requireHostedPrivyIdentity(identityToken: string): Promise<HostedPrivyIdentity> {
  const user = await verifyHostedPrivyIdentityToken(identityToken);
  const { phone, wallet } = resolveHostedPrivyLinkedAccountState(user, "ethereum");

  if (!phone) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_REQUIRED",
      message: "Finish phone verification before continuing.",
      httpStatus: 400,
    });
  }

  if (!wallet) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_REQUIRED",
      message: "Create your rewards wallet before continuing.",
      httpStatus: 400,
    });
  }

  return {
    phone,
    userId: user.id,
    wallet,
  };
}

export async function requireHostedPrivyIdentityFromCookies(): Promise<HostedPrivyIdentity> {
  const cookieStore = await cookies();
  const identityToken = readHostedPrivyIdentityTokenFromCookieStore(cookieStore);

  if (!identityToken) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      message: "A Privy identity cookie is required to continue. Refresh and verify your phone again.",
      httpStatus: 401,
    });
  }

  return requireHostedPrivyIdentity(identityToken);
}

export async function getOptionalHostedPrivyIdentityFromCookies(): Promise<HostedPrivyIdentity | null> {
  const cookieStore = await cookies();
  const identityToken = readHostedPrivyIdentityTokenFromCookieStore(cookieStore);

  if (!identityToken) {
    return null;
  }

  try {
    return await requireHostedPrivyIdentity(identityToken);
  } catch (error) {
    if (isOptionalHostedPrivyIdentityError(error)) {
      return null;
    }

    throw error;
  }
}

export async function verifyHostedPrivyIdentityToken(identityToken: string): Promise<HostedPrivyUser> {
  const token = identityToken.trim();

  if (!token) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      message: "A Privy identity token is required to continue.",
      httpStatus: 401,
    });
  }

  const { appId, verificationKey } = requireHostedPrivyVerificationConfig();

  try {
    const user = await verifyIdentityToken({
      identity_token: token,
      app_id: appId,
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

export function readHostedPrivyIdentityTokenFromCookieStore(cookieStore: HostedPrivyCookieStore): string | null {
  const value = cookieStore.get(HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME)?.value;
  return normalizeEnvValue(value);
}

export function hasHostedPrivyPhoneAuthConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeEnvValue(source.NEXT_PUBLIC_PRIVY_APP_ID) && normalizeEnvValue(source.PRIVY_VERIFICATION_KEY));
}

function requireHostedPrivyVerificationConfig(): { appId: string; verificationKey: string } {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.privyAppId || !environment.privyVerificationKey) {
    throw hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      message: "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_VERIFICATION_KEY must be configured for hosted phone signup.",
      httpStatus: 500,
    });
  }

  return {
    appId: environment.privyAppId,
    verificationKey: environment.privyVerificationKey.replace(/\\n/g, "\n").trim(),
  };
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

function isOptionalHostedPrivyIdentityError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : null;
  return (
    code === "PRIVY_AUTH_FAILED" ||
    code === "PRIVY_PHONE_REQUIRED" ||
    code === "PRIVY_WALLET_REQUIRED"
  );
}
