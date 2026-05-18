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

  if (input.identity.phone) {
    return "phone";
  }

  if (input.identity.email?.verifiedAt) {
    return "email";
  }

  if (input.identity.telegram?.telegramUserId) {
    return "telegram";
  }

  throw hostedOnboardingError({
    code: "PRIVY_ACCOUNT_REQUIRED",
    message: "Use a verified phone number, email address, or Telegram account to continue.",
    httpStatus: 400,
  });
}
