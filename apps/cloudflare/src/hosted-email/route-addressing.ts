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

export function resolveHostedEmailRouteIdentity(
  fallbackIdentityId: string,
  config: HostedEmailConfig,
): string {
  return normalizeHostedEmailAddress(config.fromAddress) ?? fallbackIdentityId;
}

export function parseHostedEmailRouteCandidate(
  value: string | null | undefined,
  config: HostedEmailConfig,
): { address: string; detail: string } | null {
  const detailFromAddress = parseHostedEmailAddressDetail(value ?? "", config);
  if (detailFromAddress) {
    const normalizedAddress = normalizeHostedEmailAddress(value);

    if (!normalizedAddress) {
      return null;
    }

    return {
      address: normalizedAddress,
      detail: detailFromAddress,
    };
  }

  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (!/^[A-Za-z0-9-]+$/u.test(normalized)) {
    return null;
  }

  return {
    address: formatHostedEmailAddress(config, normalized),
    detail: normalized,
  };
}

export function formatHostedEmailAddress(config: HostedEmailConfig, detail: string): string {
  if (!config.domain) {
    throw new Error("Hosted email domain is not configured.");
  }

  return `${config.localPart}+${detail}@${config.domain}`;
}

function parseHostedEmailAddressDetail(address: string, config: HostedEmailConfig): string | null {
  const normalized = normalizeHostedEmailAddress(address);
  if (!normalized || !config.domain) {
    return null;
  }

  const expectedSuffix = `@${config.domain}`;
  if (!normalized.endsWith(expectedSuffix)) {
    return null;
  }

  const localPart = normalized.slice(0, -expectedSuffix.length);
  const prefix = `${config.localPart}+`;
  if (!localPart.startsWith(prefix)) {
    return null;
  }

  const detail = localPart.slice(prefix.length).trim();
  return detail.length > 0 ? detail : null;
}
