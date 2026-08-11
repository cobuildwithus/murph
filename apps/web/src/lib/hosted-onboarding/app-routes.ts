import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

export const HOSTED_APP_HOME_PATH = "/home";

/** Canonical billing surface: the Subscription controls on Settings. */
export const HOSTED_APP_SUBSCRIPTION_PATH = "/settings#subscription";
export const HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE_ERROR_CODE =
  "HOSTED_FAMILY_DRAFT_CHECKOUT_ACTIVE";
export const HOSTED_FAMILY_INVITE_RETURN_PARAM = "familyInviteReturn";

const HOSTED_FAMILY_INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/u;
const HOSTED_FAMILY_INVITE_ACCEPT_PATH_PREFIX = "/family/accept/";

export function buildHostedFamilyInviteAcceptancePath(inviteCode: string): string {
  return `${HOSTED_FAMILY_INVITE_ACCEPT_PATH_PREFIX}${encodeURIComponent(inviteCode)}`;
}

export function buildHostedFamilyInviteRecoveryPath(inviteCode: string): string {
  return buildHostedFamilyInviteRecoveryPathFromValidatedReturn(
    buildHostedFamilyInviteAcceptancePath(inviteCode),
  );
}

export function buildHostedFamilyInviteRecoveryPathFromReturnPath(
  value: unknown,
): string | null {
  const returnPath = parseHostedFamilyInviteReturnPath(value);
  if (!returnPath) {
    return null;
  }
  return buildHostedFamilyInviteRecoveryPathFromValidatedReturn(returnPath);
}

function buildHostedFamilyInviteRecoveryPathFromValidatedReturn(
  returnPath: string,
): string {
  const query = new URLSearchParams({
    [HOSTED_FAMILY_INVITE_RETURN_PARAM]: returnPath,
  });
  return `/settings?${query.toString()}#subscription`;
}

export function buildHostedFamilyInviteRecoveryUrl(inviteCode: string): string {
  return new URL(
    buildHostedFamilyInviteRecoveryPath(inviteCode),
    `${MURPH_PRODUCT_ORIGIN}/`,
  ).toString();
}

export function parseHostedFamilyInviteCode(value: unknown): string | null {
  return typeof value === "string"
    && HOSTED_FAMILY_INVITE_CODE_PATTERN.test(value)
    ? value
    : null;
}

export function parseHostedFamilyInviteReturnPath(value: unknown): string | null {
  if (
    typeof value !== "string"
    || !value.startsWith(HOSTED_FAMILY_INVITE_ACCEPT_PATH_PREFIX)
  ) {
    return null;
  }
  return parseHostedFamilyInviteCode(
    value.slice(HOSTED_FAMILY_INVITE_ACCEPT_PATH_PREFIX.length),
  )
    ? value
    : null;
}
