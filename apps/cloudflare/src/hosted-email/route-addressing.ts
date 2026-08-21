/**
 * Hosted email route addressing owns public sender identity checks plus alias
 * address parsing/formatting. Routing orchestration can depend on this module
 * without also pulling in storage or token-signing concerns.
 */

import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import type { HostedEmailConfig } from "./config.ts";

export function isHostedEmailPublicSenderAddress(
  address: string | null | undefined,
  config: HostedEmailConfig,
): boolean {
  const publicSenderAddress = normalizeHostedEmailAddress(config.fromAddress);
  const normalizedAddress = normalizeHostedEmailAddress(address);

  return publicSenderAddress !== null && normalizedAddress === publicSenderAddress;
}

export function isHostedEmailPublicBootstrapAddress(
  address: string | null | undefined,
  config: HostedEmailConfig,
): boolean {
  const publicBootstrapAddress = normalizeHostedEmailAddress(config.publicAddress);
  const normalizedAddress = normalizeHostedEmailAddress(address);

  return publicBootstrapAddress !== null
    && normalizedAddress === publicBootstrapAddress;
}

export function parseHostedEmailRouteCandidate(
  value: string | null | undefined,
  config: HostedEmailConfig,
): { address: string; detail: string } | null {
  const addressCandidate = parseHostedEmailAddressCandidate(value, config);
  if (addressCandidate) {
    return addressCandidate;
  }

  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (!/^[A-Za-z0-9_-]+$/u.test(normalized)) {
    return null;
  }

  return {
    address: formatHostedEmailAddress(config, normalized),
    detail: normalized,
  };
}

export function formatHostedEmailAddress(config: HostedEmailConfig, detail: string): string {
  const domain = normalizeHostedEmailRouteDomain(config.domain);
  if (!domain) {
    throw new Error("Hosted email domain is not configured.");
  }

  const localPart = normalizeHostedEmailRouteLocalPart(config.localPart);
  if (!localPart) {
    throw new Error("Hosted email local part is not configured.");
  }

  return `${localPart}+${detail}@${domain}`;
}

function parseHostedEmailAddressCandidate(
  value: string | null | undefined,
  config: HostedEmailConfig,
): { address: string; detail: string } | null {
  const address = normalizeHostedEmailAddress(value);
  const domain = normalizeHostedEmailRouteDomain(config.domain);
  const configuredLocalPart = normalizeHostedEmailRouteLocalPart(config.localPart);
  if (!address || !domain || !configuredLocalPart) {
    return null;
  }

  const expectedSuffix = `@${domain}`;
  if (!address.endsWith(expectedSuffix)) {
    return null;
  }

  const addressLocalPart = address.slice(0, -expectedSuffix.length);
  const prefix = `${configuredLocalPart}+`;
  if (!addressLocalPart.startsWith(prefix)) {
    return null;
  }

  const detail = addressLocalPart.slice(prefix.length).trim();
  if (!detail) {
    return null;
  }

  return {
    address,
    detail,
  };
}

function normalizeHostedEmailRouteDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedEmailRouteLocalPart(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}
