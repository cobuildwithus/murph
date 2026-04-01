const HOSTED_VERIFIED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const HOSTED_USER_VERIFIED_EMAIL_ENV_KEY = "HOSTED_USER_VERIFIED_EMAIL";
export const HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY = "HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT";

export interface HostedVerifiedEmail {
  address: string;
  verifiedAt: string | null;
}

export function createHostedVerifiedEmailUserEnv(input: {
  address: string;
  verifiedAt?: string | null;
}): Record<string, string> {
  const address = normalizeHostedVerifiedEmailAddress(input.address);

  if (!address) {
    throw new TypeError("Hosted verified email address must be a valid email address.");
  }

  const verifiedAt = normalizeHostedVerifiedEmailTimestamp(input.verifiedAt);

  return verifiedAt
    ? {
        [HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]: address,
        [HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY]: verifiedAt,
      }
    : {
        [HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]: address,
      };
}

export function readHostedVerifiedEmailFromEnv(
  source: Readonly<Record<string, string | undefined>> = resolveDefaultHostedVerifiedEmailSource(),
): HostedVerifiedEmail | null {
  const address = normalizeHostedVerifiedEmailAddress(source[HOSTED_USER_VERIFIED_EMAIL_ENV_KEY]);

  if (!address) {
    return null;
  }

  return {
    address,
    verifiedAt: normalizeHostedVerifiedEmailTimestamp(
      source[HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT_ENV_KEY],
    ),
  };
}

function resolveDefaultHostedVerifiedEmailSource(): Readonly<Record<string, string | undefined>> {
  if (
    typeof process === "object"
    && process !== null
    && "env" in process
    && process.env
    && typeof process.env === "object"
  ) {
    return process.env;
  }

  return {};
}

export function normalizeHostedVerifiedEmailAddress(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized && HOSTED_VERIFIED_EMAIL_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeHostedVerifiedEmailTimestamp(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
