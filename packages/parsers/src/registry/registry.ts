import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type {
  ParserProvider,
  ProviderAvailability,
  ProviderSelection,
} from "../contracts/provider.js";
import {
  DEFAULT_PROVIDER_RANKING_POLICY,
  scoreProvider,
  type ProviderRankingPolicy,
} from "./policy.js";

export interface ParserRegistry {
  readonly providers: readonly ParserProvider[];
  listCandidates(request: ParseRequest): Promise<ProviderSelection[]>;
  select(request: ParseRequest): Promise<ProviderSelection>;
  run(request: ParseRequest): Promise<{ selection: ProviderSelection; result: ProviderRunResult }>;
}

export function createParserRegistry(
  providers: ParserProvider[],
  policy: ProviderRankingPolicy = DEFAULT_PROVIDER_RANKING_POLICY,
): ParserRegistry {
  const availabilityCache = new Map<string, Promise<ProviderAvailability>>();

  async function getAvailability(provider: ParserProvider): Promise<ProviderAvailability> {
    const cached = availabilityCache.get(provider.id);
    if (cached) {
      return cached;
    }

    const pending = provider.discover();
    availabilityCache.set(provider.id, pending);
    return pending;
  }

  return {
    providers,
    async listCandidates(request) {
      const candidates: ProviderSelection[] = [];

      for (const provider of providers) {
        if (!(await provider.supports(request))) {
          continue;
        }

        const availability = await getAvailability(provider);
        if (!availability.available) {
          continue;
        }

        candidates.push({
          provider,
          availability,
          score: scoreProvider(provider, policy),
        });
      }

      return candidates.sort((left, right) => right.score - left.score || left.provider.id.localeCompare(right.provider.id));
    },
    async select(request) {
      const [selection] = await this.listCandidates(request);
      if (!selection) {
        throw new TypeError(`No parser provider available for artifact ${request.artifact.attachmentId}.`);
      }

      return selection;
    },
    async run(request) {
      const candidates = await this.listCandidates(request);
      if (candidates.length === 0) {
        throw new TypeError(`No parser provider available for artifact ${request.artifact.attachmentId}.`);
      }

      const failures: string[] = [];
      for (const selection of candidates) {
        try {
          const result = await selection.provider.run(request);
          return { selection, result };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${selection.provider.id}: ${message}`);
        }
      }

      throw new Error(
        `All parser providers failed for artifact ${request.artifact.attachmentId}: ${failures.join(" | ")}`,
      );
    },
  };
}
