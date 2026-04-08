import { verifyAccessToken, verifyIdentityToken } from "@privy-io/node";
import { cookies } from "next/headers";

import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyPhoneAccount,
  type HostedPrivyWalletAccount,
  resolveHostedPrivyLinkedAccountState,
} from "./privy-shared";
import { isHostedOnboardingRevnetEnabled } from "./revnet";
import { getHostedOnboardingEnvironment } from "./runtime";

export interface HostedPrivyUser extends HostedPrivyLinkedAccountContainer {
  id: string;
}

export interface HostedPrivyCookieStore {
  get(name: string): { value?: string } | undefined;
}

export const HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME = "x-privy-identity-token";
const HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME = "privy-id-token";

export interface HostedPrivyIdentity {
  phone: HostedPrivyPhoneAccount;
  userId: string;
  wallet: HostedPrivyWalletAccount | null;
}

export interface HostedPrivyAccessTokenClaims {
  appId: string;
  expiration: number;
  issuedAt: number;
  issuer: string;
  sessionId: string;
  userId: string;
}

export async function requireHostedPrivyIdentity(identityToken: string): Promise<HostedPrivyIdentity> {
  const user = await verifyHostedPrivyIdentityToken(identityToken);
  return resolveHostedPrivyIdentityFromVerifiedUser(user);
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

export async function requireHostedPrivyCompletionIdentityFromCookies(): Promise<HostedPrivyIdentity> {
  try {
    return await requireHostedPrivyIdentityFromCookies();
  } catch (error) {
    throw remapHostedPrivyCompletionLagError(error);
  }
}

export async function requireHostedPrivyIdentityFromRequest(request: Request): Promise<HostedPrivyIdentity> {
  const identityToken = readHostedPrivyIdentityTokenFromRequest(request);

  if (!identityToken) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
      httpStatus: 401,
    });
  }

  return requireHostedPrivyIdentity(identityToken);
}

export async function requireHostedPrivyCompletionIdentityFromRequest(request: Request): Promise<HostedPrivyIdentity> {
  try {
    return await requireHostedPrivyIdentityFromRequest(request);
  } catch (error) {
    throw remapHostedPrivyCompletionLagError(error);
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

export function resolveHostedPrivyIdentityFromVerifiedUser(user: HostedPrivyUser): HostedPrivyIdentity {
  const { phone, wallet } = resolveHostedPrivyLinkedAccountState(user, HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE);

  if (!phone) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_REQUIRED",
      message: "Finish phone verification before continuing.",
      httpStatus: 400,
    });
  }

  if (!wallet && isHostedOnboardingRevnetEnabled()) {
    throw hostedOnboardingError({
      code: "PRIVY_WALLET_REQUIRED",
      message: "Finish setup before continuing.",
      httpStatus: 400,
    });
  }

  return {
    phone,
    userId: user.id,
    wallet: wallet ?? null,
  };
}

export function readHostedPrivyIdentityTokenFromCookieStore(cookieStore: HostedPrivyCookieStore): string | null {
  const value = cookieStore.get(HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME)?.value;
  return normalizeEnvValue(value);
}

export function readHostedPrivyIdentityTokenFromRequest(request: Request): string | null {
  return normalizeEnvValue(request.headers.get(HOSTED_PRIVY_IDENTITY_TOKEN_HEADER_NAME));
}

export function readHostedPrivyAccessTokenFromRequest(request: Request): string | null {
  return normalizeHostedPrivyAccessToken(request.headers.get("authorization"));
}

export async function verifyHostedPrivyAccessToken(accessToken: string): Promise<HostedPrivyAccessTokenClaims> {
  const token = accessToken.trim();

  if (!token) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  const { appId, verificationKey } = requireHostedPrivyVerificationConfig();

  try {
    const claims = await verifyAccessToken({
      access_token: token,
      app_id: appId,
      verification_key: verificationKey,
    });

    return {
      appId: claims.app_id,
      expiration: claims.expiration,
      issuedAt: claims.issued_at,
      issuer: claims.issuer,
      sessionId: claims.session_id,
      userId: claims.user_id,
    };
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

function normalizeHostedPrivyAccessToken(value: string | null | undefined): string | null {
  const normalized = normalizeEnvValue(value);

  if (!normalized) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(normalized);
  return normalizeEnvValue(match?.[1]);
}

export function remapHostedPrivyCompletionLagError(error: unknown): unknown {
  if (!isHostedOnboardingError(error)) {
    return error;
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

  if (error.code === "PRIVY_WALLET_REQUIRED") {
    return hostedOnboardingError({
      code: "PRIVY_WALLET_NOT_READY",
      message:
        "Your setup has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  return error;
}
