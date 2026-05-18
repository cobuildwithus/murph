import { hostedOnboardingError } from "./errors";
import type { HostedPrivyIdentity } from "./privy";
import type { HostedPrivyAuthMethod } from "./types";

export function resolveHostedPrivyAuthMethodFromIdentity(input: {
  authMethod?: HostedPrivyAuthMethod;
  identity: HostedPrivyIdentity;
}): HostedPrivyAuthMethod {
  if (input.authMethod) {
    return input.authMethod;
  }

  const [authMethod] = readHostedPrivyVerifiedAuthMethods(input.identity);
  if (authMethod) {
    return authMethod;
  }

  throw hostedOnboardingError({
    code: "PRIVY_ACCOUNT_REQUIRED",
    message: "Use a verified phone number, email address, or Telegram account to continue.",
    httpStatus: 400,
  });
}

export function readHostedPrivyVerifiedAuthMethods(
  identity: HostedPrivyIdentity,
): HostedPrivyAuthMethod[] {
  return [
    ...(identity.phone ? ["phone" as const] : []),
    ...(identity.email?.verifiedAt ? ["email" as const] : []),
    ...(identity.telegram?.telegramUserId ? ["telegram" as const] : []),
  ];
}
