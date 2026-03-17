import type { VaultReadModel } from "./model.js";
import {
  materializeSearchDocuments,
  scoreSearchDocuments,
  type SearchCitation,
  type SearchDocument,
  type SearchableDocument,
  type SearchFilters,
  type SearchHit,
  type SearchResult,
} from "./search-shared.js";

export { scoreSearchDocuments } from "./search-shared.js";
export type {
  SearchCitation,
  SearchDocument,
  SearchableDocument,
  SearchFilters,
  SearchHit,
  SearchResult,
} from "./search-shared.js";

export function searchVault(
  vault: VaultReadModel,
  query: string,
  filters: SearchFilters = {},
): SearchResult {
  const documents = materializeSearchDocuments(vault.records);
  return scoreSearchDocuments(documents, query, filters);
}
