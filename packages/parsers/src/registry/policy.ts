import type {
  ParserProvider,
  ParserProviderLocality,
  ParserProviderOpenness,
  ParserProviderRuntime,
} from "../contracts/provider.js";

export interface ProviderRankingPolicy {
  locality: Record<ParserProviderLocality, number>;
  openness: Record<ParserProviderOpenness, number>;
  runtime: Record<ParserProviderRuntime, number>;
}

export const DEFAULT_PROVIDER_RANKING_POLICY: ProviderRankingPolicy = {
  locality: {
    local: 300,
    remote: 0,
  },
  openness: {
    open_source: 120,
    open_weights: 80,
    closed: 0,
  },
  runtime: {
    node: 40,
    cli: 35,
    local_http: 20,
    python: 10,
    remote_api: 0,
  },
};

export function scoreProvider(
  provider: ParserProvider,
  policy: ProviderRankingPolicy = DEFAULT_PROVIDER_RANKING_POLICY,
): number {
  return (
    provider.priority +
    policy.locality[provider.locality] +
    policy.openness[provider.openness] +
    policy.runtime[provider.runtime]
  );
}
