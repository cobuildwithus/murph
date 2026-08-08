import { createHmac, timingSafeEqual } from "node:crypto";

import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { normalizeNullableString } from "../primitives";

type HostedGroupUsageFundingEnvironment = Readonly<
  Record<string, string | undefined>
>;

// The signed form is funding-only: it identifies one runtime container to the
// funding page without granting group enrollment or resolving to a group row.
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX = "gf1";
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_DOMAIN =
  "murph.hosted-group-usage-funding-locator";
const HOSTED_GROUP_USAGE_FUNDING_LOCATOR_VERSION = 1;

export function buildHostedGroupUsageFundingLocatorForRuntimeMember(
  runtimeMemberId: string,
  environment: HostedGroupUsageFundingEnvironment = process.env,
): string | null {
  const normalized = normalizeNullableString(runtimeMemberId);
  if (!normalized) {
    return null;
  }

  try {
    return [
      HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX,
      normalized,
      buildHostedGroupUsageFundingLocatorSignature(normalized, environment),
    ].join(".");
  } catch {
    return null;
  }
}

export function readHostedGroupUsageFundingLocatorRuntimeMemberId(
  value: unknown,
  environment: HostedGroupUsageFundingEnvironment = process.env,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split(".");
  if (
    parts.length !== 3
    || parts[0] !== HOSTED_GROUP_USAGE_FUNDING_LOCATOR_PREFIX
    || !parts[1]
    || !parts[2]
  ) {
    return null;
  }

  try {
    const supplied = Buffer.from(parts[2], "utf8");
    const expected = Buffer.from(
      buildHostedGroupUsageFundingLocatorSignature(parts[1], environment),
      "utf8",
    );
    if (
      supplied.byteLength !== expected.byteLength
      || !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return parts[1];
}

export function normalizeHostedGroupUsageFundingLocator(
  value: unknown,
  environment: HostedGroupUsageFundingEnvironment = process.env,
): string | null {
  const joinCode = normalizeHostedGroupUsageJoinCode(value);
  if (joinCode) {
    return joinCode;
  }
  return readHostedGroupUsageFundingLocatorRuntimeMemberId(
    value,
    environment,
  ) !== null
    ? (value as string)
    : null;
}

export function buildHostedGroupUsageFundingUrl(input: {
  environment?: HostedGroupUsageFundingEnvironment;
  joinCode: string;
  publicBaseUrl?: string | null;
}): string | null {
  const locator = normalizeHostedGroupUsageFundingLocator(
    input.joinCode,
    input.environment,
  );
  const publicBaseUrl = input.publicBaseUrl === undefined
    ? resolveHostedPublicBaseUrl(input.environment)
    : input.publicBaseUrl;
  if (!locator || !publicBaseUrl) {
    return null;
  }

  try {
    return new URL(
      buildHostedGroupUsageFundingPath(locator),
      `${publicBaseUrl.replace(/\/+$/u, "")}/`,
    ).toString();
  } catch {
    return null;
  }
}

export function buildHostedGroupUsageFundingPath(joinCode: string): string {
  return `/groups/fund/${encodeURIComponent(joinCode)}`;
}

export function normalizeHostedGroupUsageJoinCode(value: unknown): string | null {
  const normalized = typeof value === "string"
    ? normalizeNullableString(value)
    : null;
  return normalized && /^[A-Za-z0-9_-]{16,128}$/u.test(normalized)
    ? normalized
    : null;
}

function buildHostedGroupUsageFundingLocatorSignature(
  runtimeMemberId: string,
  environment: HostedGroupUsageFundingEnvironment,
): string {
  const payload = JSON.stringify([
    HOSTED_GROUP_USAGE_FUNDING_LOCATOR_DOMAIN,
    HOSTED_GROUP_USAGE_FUNDING_LOCATOR_VERSION,
    runtimeMemberId,
  ]);
  return createHmac("sha256", readHostedAppSessionHmacKey(environment))
    .update(payload, "utf8")
    .digest("base64url");
}
