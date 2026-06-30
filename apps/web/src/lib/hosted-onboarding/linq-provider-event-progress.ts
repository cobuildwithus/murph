import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";

export type HostedLinqProviderEventProgress = {
  eventLookupKey: string;
  providerCreatedAt: Date;
  rank: number;
};

export function createHostedLinqProviderEventProgress(input: {
  eventId: string;
  providerCreatedAt: Date;
  rank?: number;
}): HostedLinqProviderEventProgress {
  return {
    eventLookupKey: createHostedLinqProviderEventLookupKey(input.eventId),
    providerCreatedAt: input.providerCreatedAt,
    rank: input.rank ?? 0,
  };
}

export function compareHostedLinqProviderEventProgress(
  left: HostedLinqProviderEventProgress,
  right: HostedLinqProviderEventProgress,
): number {
  const createdAtDelta = left.providerCreatedAt.getTime() - right.providerCreatedAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  const rankDelta = left.rank - right.rank;
  if (rankDelta !== 0) {
    return rankDelta;
  }

  if (left.eventLookupKey < right.eventLookupKey) {
    return -1;
  }
  if (left.eventLookupKey > right.eventLookupKey) {
    return 1;
  }
  return 0;
}
