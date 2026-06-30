import { createHash } from "node:crypto";

import {
  normalizeHostedOpaqueInput,
} from "./contact-privacy";

const HOSTED_LINQ_OBSERVABILITY_IDENTIFIER_VERSION = "s1";

export function createHostedLinqProviderEventLookupKey(eventId: string): string {
  return requireHostedStableObservabilityIdentifier("linq.provider-event", eventId);
}

export function createHostedLinqDeliveryIdempotencyLookupKey(
  idempotencyKey: string | null | undefined,
): string | null {
  return createNullableHostedStableObservabilityIdentifier(
    "linq.delivery-idempotency",
    idempotencyKey,
  );
}

export function createHostedLinqDeliverySourceRefLookupKey(
  sourceRef: string | null | undefined,
): string | null {
  return createNullableHostedStableObservabilityIdentifier("linq.delivery-source-ref", sourceRef);
}

function requireHostedStableObservabilityIdentifier(kind: string, value: string): string {
  const normalized = normalizeHostedOpaqueInput(value);
  const lookupKey = normalized && isHostedLinqStableObservabilityIdentifierForKind(kind, normalized)
    ? normalized
    : createHostedStableObservabilityIdentifier(kind, normalized);
  if (!lookupKey) {
    throw new TypeError(`Hosted Linq observability ${kind} lookup key requires a value.`);
  }
  return lookupKey;
}

function createNullableHostedStableObservabilityIdentifier(
  kind: string,
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);
  if (!normalized) {
    return null;
  }

  return requireHostedStableObservabilityIdentifier(kind, normalized);
}

function createHostedStableObservabilityIdentifier(
  kind: string,
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }
  const digest = createHash("sha256")
    .update("murph.hosted-linq-observability")
    .update("\0")
    .update(kind)
    .update("\0")
    .update(value)
    .digest("hex");
  return `hbid:${kind}:${HOSTED_LINQ_OBSERVABILITY_IDENTIFIER_VERSION}:${digest}`;
}

function isHostedLinqStableObservabilityIdentifierForKind(kind: string, value: string): boolean {
  return new RegExp(
    `^hbid:${escapeRegExp(kind)}:${HOSTED_LINQ_OBSERVABILITY_IDENTIFIER_VERSION}:[0-9a-f]{64}$`,
    "u",
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
