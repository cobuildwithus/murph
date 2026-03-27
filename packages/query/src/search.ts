import type { VaultReadModel } from "./model.ts";
import {
  materializeSearchDocuments,
  scoreSearchDocuments,
  type SearchCitation,
  type SearchDocument,
  type SearchableDocument,
  type SearchFilters,
  type SearchHit,
  type SearchResult,
} from "./search-shared.ts";

export { scoreSearchDocuments } from "./search-shared.ts";
export type {
  SearchCitation,
  SearchDocument,
  SearchableDocument,
  SearchFilters,
  SearchHit,
  SearchResult,
} from "./search-shared.ts";

export function searchVault(
  vault: VaultReadModel,
  query: string,
  filters: SearchFilters = {},
): SearchResult {
  const documents = materializeSearchDocuments(vault.records);
  return scoreSearchDocuments(documents, query, filters);
}
