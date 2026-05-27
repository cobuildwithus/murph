import type { VaultReadModel } from "./read-model.ts";
import { isSearchIndexedQueryEntity } from "./query-visibility.ts";
import {
  materializeSafeSampleSummarySearchDocuments,
  materializeSafeSearchDocuments,
  materializeSampleSummarySearchDocuments,
  materializeSearchDocuments,
  scoreSearchDocuments,
  type SearchCitation,
  type SearchDocument,
  type SearchableDocument,
  type SearchFilters,
  type SearchHit,
  type SearchResult,
} from "./search-shared.ts";
import { summarizeDailySamples } from "./summaries.ts";

export { scoreSearchDocuments } from "./search-shared.ts";
export type {
  SearchCitation,
  SearchDocument,
  SearchableDocument,
  SearchFilters,
  SearchHit,
  SearchResult,
} from "./search-shared.ts";

export interface SafeSearchHit extends Omit<SearchHit, "citation" | "path"> {}

export interface SafeSearchResult {
  format: "murph.search.v1";
  query: string;
  total: number;
  hits: SafeSearchHit[];
}

export function searchVault(
  vault: VaultReadModel,
  query: string,
  filters: SearchFilters = {},
): SearchResult {
  const searchableEntities = vault.entities.filter((entity) =>
    entity.family !== "sample" && isSearchIndexedQueryEntity(entity)
  );
  const documents = [
    ...materializeSearchDocuments(searchableEntities),
    ...materializeSampleSummarySearchDocuments(summarizeDailySamples(vault)),
  ];
  return scoreSearchDocuments(documents, query, filters);
}

export function searchVaultSafe(
  vault: VaultReadModel,
  query: string,
  filters: SearchFilters = {},
): SafeSearchResult {
  const searchableEntities = vault.entities.filter((entity) =>
    entity.family !== "sample" && isSearchIndexedQueryEntity(entity)
  );
  const documents = [
    ...materializeSafeSearchDocuments(searchableEntities),
    ...materializeSafeSampleSummarySearchDocuments(summarizeDailySamples(vault)),
  ];
  const result = scoreSearchDocuments(documents, query, filters);

  return {
    format: result.format,
    query: result.query,
    total: result.total,
    hits: result.hits.map(({ citation: _citation, path: _path, ...hit }) => hit),
  };
}
