import {
  type HostedExecutionBaseUrlNormalizationOptions,
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

import { normalizeNullableString } from "../primitives";

type EnvSource = Readonly<Record<string, string | undefined>>;

export const hostedNativeIosE2eVercelTargetEnvironment = "native-ios-e2e";

export function resolveHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return resolveHostedPublicUrl(readHostedPublicBaseUrl, source);
}

export function readHostedPublicBaseUrl(
  source: EnvSource = process.env,
): string | null {
  if (isHostedNativeIosE2eVercelTarget(source)) {
    return readHostedNativeIosE2eVercelDeploymentBaseUrl(source, {
      allowHttpLocalhost: false,
      requireOriginOnly: true,
    });
  }

  return (
    normalizeConfiguredPublicBaseUrl(source.HOSTED_ONBOARDING_PUBLIC_BASE_URL)
    ?? normalizeConfiguredPublicBaseUrl(source.HOSTED_WEB_BASE_URL)
    ?? readHostedWebVercelProductionBaseUrl(source, {
      allowHttpLocalhost: true,
      requireOriginOnly: true,
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
  if (isHostedNativeIosE2eVercelTarget(source)) {
    return appendHostedPath(readHostedPublicOrigin(source), "/api/device-sync");
  }

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

function normalizeConfiguredPublicBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  return normalizeHostedExecutionBaseUrl(normalized, {
    allowHttpLocalhost: true,
    requireOriginOnly: true,
  });
}

function isHostedNativeIosE2eVercelTarget(source: EnvSource): boolean {
  return normalizeHostedExecutionString(source.VERCEL_TARGET_ENV)
    === hostedNativeIosE2eVercelTargetEnvironment;
}

function readHostedNativeIosE2eVercelDeploymentBaseUrl(
  source: EnvSource,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string | null {
  const deploymentUrl = normalizeHostedExecutionString(source.VERCEL_URL);
  if (!deploymentUrl) {
    return null;
  }

  const normalizedInput = /^[a-z][a-z\d+.-]*:\/\//iu.test(deploymentUrl)
    ? deploymentUrl
    : `https://${deploymentUrl}`;

  return normalizeHostedExecutionBaseUrl(normalizedInput, options);
}

function readHostedWebVercelProductionBaseUrl(
  source: EnvSource,
  options?: HostedExecutionBaseUrlNormalizationOptions,
): string | null {
  const productionUrl = normalizeHostedExecutionString(source.VERCEL_PROJECT_PRODUCTION_URL);

  if (!productionUrl) {
    return null;
  }

  const normalizedInput = /^[a-z][a-z\d+.-]*:\/\//iu.test(productionUrl)
    ? productionUrl
    : `https://${productionUrl}`;

  return normalizeHostedExecutionBaseUrl(normalizedInput, options);
}
