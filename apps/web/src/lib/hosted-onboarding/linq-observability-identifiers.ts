import {
  createHostedOpaqueIdentifier,
  normalizeHostedOpaqueInput,
} from "./contact-privacy";

const HOSTED_LINQ_OPAQUE_IDENTIFIER_VERSION_PATTERN = "v[0-9]+";

export function createHostedLinqProviderEventLookupKey(eventId: string): string {
  return requireHostedOpaqueIdentifier("linq.provider-event", eventId);
}

export function createHostedLinqDeliveryIdempotencyLookupKey(
  idempotencyKey: string | null | undefined,
): string | null {
  return createNullableHostedOpaqueIdentifier("linq.delivery-idempotency", idempotencyKey);
}

export function createHostedLinqDeliverySourceRefLookupKey(
  sourceRef: string | null | undefined,
): string | null {
  return createNullableHostedOpaqueIdentifier("linq.delivery-source-ref", sourceRef);
}

function requireHostedOpaqueIdentifier(kind: string, value: string): string {
  const normalized = normalizeHostedOpaqueInput(value);
  const lookupKey = normalized && isHostedLinqOpaqueIdentifierForKind(kind, normalized)
    ? normalized
    : createHostedOpaqueIdentifier(kind, normalized ? `raw:${normalized}` : null);
  if (!lookupKey) {
    throw new TypeError(`Hosted Linq observability ${kind} lookup key requires a value.`);
  }
  return lookupKey;
}

function createNullableHostedOpaqueIdentifier(
  kind: string,
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);
  if (!normalized) {
    return null;
  }

  return requireHostedOpaqueIdentifier(kind, normalized);
}

function isHostedLinqOpaqueIdentifierForKind(kind: string, value: string): boolean {
  return new RegExp(
    `^hbid:${escapeRegExp(kind)}:${HOSTED_LINQ_OPAQUE_IDENTIFIER_VERSION_PATTERN}:[0-9a-f]+$`,
    "u",
  ).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
