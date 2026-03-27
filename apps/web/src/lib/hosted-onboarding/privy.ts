import { verifyIdentityToken } from "@privy-io/node";

import { hostedOnboardingError } from "./errors";
import {
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyWalletAccount,
  type HostedPrivyPhoneAccount,
  type HostedPrivyWalletAccount,
  type PrivyLinkedAccountLike,
} from "./privy-shared";
import { getHostedOnboardingEnvironment } from "./runtime";

interface HostedPrivyUser {
  id: string;
  linked_accounts?: unknown;
}

const HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME = "privy-id-token";

export interface HostedPrivyIdentity {
  linkedAccounts: PrivyLinkedAccountLike[];
  phone: HostedPrivyPhoneAccount;
  userId: string;
  wallet: HostedPrivyWalletAccount;
}

export async function requireHostedPrivyIdentity(identityToken: string): Promise<HostedPrivyIdentity> {
  const user = await verifyHostedPrivyIdentityToken(identityToken);
  const linkedAccounts = coerceLinkedAccounts(user.linked_accounts);
  const phone = extractHostedPrivyPhoneAccount(linkedAccounts);
  const wallet = extractHostedPrivyWalletAccount(linkedAccounts, "ethereum");

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
    linkedAccounts,
    phone,
    userId: user.id,
    wallet,
  };
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

export function readHostedPrivyIdentityTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const entries = cookieHeader.split(/;\s*/u);

  for (const entry of entries) {
    const [name, ...valueParts] = entry.split("=");

    if (name === HOSTED_PRIVY_IDENTITY_TOKEN_COOKIE_NAME) {
      return valueParts.join("=") || null;
    }
  }

  return null;
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

function coerceLinkedAccounts(input: unknown): PrivyLinkedAccountLike[] {
  if (Array.isArray(input)) {
    return input.filter((value): value is PrivyLinkedAccountLike => Boolean(value) && typeof value === "object");
  }

  return [];
}
