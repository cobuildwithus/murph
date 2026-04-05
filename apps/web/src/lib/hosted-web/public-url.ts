import {
  normalizeHostedExecutionBaseUrl,
  readHostedExecutionVercelProductionBaseUrl,
} from "@murphai/hosted-execution";

import { normalizeNullableString } from "../device-sync/shared";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return resolveHostedPublicUrl(readHostedPublicBaseUrl, source);
}

export function readHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return (
    normalizeConfiguredBaseUrl(source.HOSTED_ONBOARDING_PUBLIC_BASE_URL)
    ?? normalizeConfiguredBaseUrl(source.HOSTED_WEB_BASE_URL)
    ?? readHostedExecutionVercelProductionBaseUrl(source, {
      allowHttpLocalhost: true,
    })
  );
}

export function resolveHostedPublicOrigin(
  source: EnvSource = process.env,
): string | null {
  return resolveHostedPublicUrl(readHostedPublicOrigin, source);
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
  return resolveHostedPublicUrl(readHostedDeviceSyncPublicBaseUrl, source);
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

function resolveHostedPublicUrl(
  read: (source: EnvSource) => string | null,
  source: EnvSource,
): string | null {
  try {
    return read(source);
  } catch {
    return null;
  }
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
