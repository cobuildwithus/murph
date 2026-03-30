import { normalizeHostedExecutionBaseUrl } from "@murph/hosted-execution";

import { normalizeNullableString } from "../device-sync/shared";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  try {
    return readHostedPublicBaseUrl(source);
  } catch {
    return null;
  }
}

export function readHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return (
    normalizeConfiguredBaseUrl(source.HOSTED_ONBOARDING_PUBLIC_BASE_URL)
    ?? normalizeConfiguredBaseUrl(source.NEXT_PUBLIC_SITE_URL)
    ?? normalizeConfiguredBaseUrl(source.HOSTED_WEB_BASE_URL)
    ?? normalizeVercelProductionBaseUrl(source.VERCEL_PROJECT_PRODUCTION_URL)
  );
}

export function resolveHostedPublicOrigin(
  source: EnvSource = process.env,
): string | null {
  try {
    return readHostedPublicOrigin(source);
  } catch {
    return null;
  }
}

export function readHostedPublicOrigin(
  source: EnvSource = process.env,
): string | null {
  const baseUrl = readHostedPublicBaseUrl(source);
  return baseUrl ? new URL(baseUrl).origin : null;
}

export function resolveHostedDeviceSyncPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  try {
    return readHostedDeviceSyncPublicBaseUrl(source);
  } catch {
    return null;
  }
}

export function readHostedDeviceSyncPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return normalizeConfiguredBaseUrl(source.DEVICE_SYNC_PUBLIC_BASE_URL)
    ?? appendHostedPath(readHostedPublicOrigin(source), "/api/device-sync");
}

function appendHostedPath(
  origin: string | null,
  pathname: string,
): string | null {
  if (!origin) {
    return null;
  }

  return new URL(pathname, `${origin}/`).toString().replace(/\/$/u, "");
}

function normalizeConfiguredBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  return normalizeHostedExecutionBaseUrl(normalized, {
    allowHttpLocalhost: true,
  });
}

function normalizeVercelProductionBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  return normalizeConfiguredBaseUrl(
    /^[a-z]+:\/\//iu.test(normalized) ? normalized : `https://${normalized}`,
  );
}
