import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";

export type HostedLinqProviderEventOrder = {
  eventId: string;
  providerCreatedAt: Date;
};

export function createHostedLinqProviderEventOrderId(eventId: string): string {
  return createHostedLinqProviderEventLookupKey(eventId);
}

export function compareHostedLinqProviderEventOrder(
  left: HostedLinqProviderEventOrder,
  right: HostedLinqProviderEventOrder,
): number {
  const createdAtDelta = left.providerCreatedAt.getTime() - right.providerCreatedAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return createHostedLinqProviderEventOrderId(left.eventId)
    .localeCompare(createHostedLinqProviderEventOrderId(right.eventId));
}
