import {
  PrivyClient,
  type User as PrivyUser,
  verifyIdentityToken,
} from "@privy-io/node";
import { cookies } from "next/headers";

import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyPhoneAccount,
  type HostedPrivyTelegramAccount,
  type HostedPrivyWalletAccount,
  extractHostedPrivyPreferredEmailAccount,
  resolveHostedPrivyLinkedAccountState,
  resolveHostedPrivyTelegramAccountSelection,
} from "./privy-shared";
import { isHostedOnboardingRevnetEnabled } from "./revnet";
import { getHostedOnboardingEnvironment } from "./runtime";

const globalForHostedPrivy = globalThis as typeof globalThis & {
  __murphHostedPrivyManagementClient?: PrivyClient | null;
};

export const HOSTED_PRIVY_MEMBER_ID_METADATA_KEY = "murph_member_id";

export type HostedPrivyUser = PrivyUser & HostedPrivyLinkedAccountContainer;
type HostedPrivyCustomMetadata = NonNullable<HostedPrivyUser["custom_metadata"]>;

export interface HostedPrivyCookieStore {
  get(name: string): { value?: string } | undefined;
}

export const HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME = "privy-id-token";

export interface HostedPrivyIdentity {
  phone: HostedPrivyPhoneAccount | null;
  telegram: HostedPrivyTelegramAccount | null;
  userId: string;
  wallet: HostedPrivyWalletAccount | null;
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
      message: "A Privy identity cookie is required to continue. Refresh and sign in again.",
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
  const identityToken = readHostedPrivyIdentityTokenFromRequestCookies(request);

  if (!identityToken) {
    throw hostedOnboardingError({
      code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
      message: "A Privy identity cookie is required to continue. Refresh and sign in again.",
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

export function readHostedPrivyMemberIdFromVerifiedUser(user: HostedPrivyUser): string | null {
  const memberId = user.custom_metadata?.[HOSTED_PRIVY_MEMBER_ID_METADATA_KEY];

  return typeof memberId === "string" ? normalizeEnvValue(memberId) : null;
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

export function resolveHostedPrivyIdentityFromVerifiedUser(user: HostedPrivyUser): HostedPrivyIdentity {
  const linkedAccountState = resolveHostedPrivyLinkedAccountState(user, HOSTED_PRIVY_EMBEDDED_WALLET_CHAIN_TYPE);
  const { phone, wallet } = linkedAccountState;
  const email = extractHostedPrivyPreferredEmailAccount(linkedAccountState.linkedAccounts);
  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(user);

  if (telegramSelection.ambiguous) {
    throw hostedOnboardingError({
      code: "PRIVY_TELEGRAM_AMBIGUOUS",
      message: "Reconnect Telegram in Privy before continuing.",
      httpStatus: 409,
    });
  }

  if (!phone && !telegramSelection.account && !email) {
    throw hostedOnboardingError({
      code: "PRIVY_ACCOUNT_REQUIRED",
      message: "Finish email, phone, or Telegram verification before continuing.",
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
    telegram: telegramSelection.account,
    userId: user.id,
    wallet: wallet ?? null,
  };
}

export function readHostedPrivyIdentityTokenFromCookieStore(cookieStore: HostedPrivyCookieStore): string | null {
  const value = cookieStore.get(HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME)?.value;
  return normalizeEnvValue(value);
}

export function readHostedPrivyIdentityTokenFromCookieHeader(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  for (const entry of value.split(/;\s*/u)) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    if (entry.slice(0, separatorIndex).trim() !== HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME) {
      continue;
    }

    const rawCookieValue = entry.slice(separatorIndex + 1);

    try {
      return normalizeEnvValue(decodeURIComponent(rawCookieValue));
    } catch {
      return normalizeEnvValue(rawCookieValue);
    }
  }

  return null;
}

export function readHostedPrivyIdentityTokenFromRequestCookies(request: Request): string | null {
  return readHostedPrivyIdentityTokenFromCookieHeader(request.headers.get("cookie"));
}

export function hasHostedPrivyPhoneAuthConfig(source: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    normalizeEnvValue(source.NEXT_PUBLIC_PRIVY_APP_ID)
      && normalizeEnvValue(source.PRIVY_VERIFICATION_KEY),
  );
}

export function requireHostedPrivyPhoneAuthConfig(): {
  appId: string;
  verificationKey: string;
} {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.privyAppId || !environment.privyVerificationKey) {
    throw hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      message:
        "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_VERIFICATION_KEY must be configured for hosted phone signup.",
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
