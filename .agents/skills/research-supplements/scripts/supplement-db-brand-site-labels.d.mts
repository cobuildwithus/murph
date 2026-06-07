export const BODY_TEXT_MAX_LENGTH: number;
export const INGREDIENT_TEXT_MAX_LENGTH: number;
export const SEARCH_TEXT_MAX_LENGTH: number;

export interface BrandSiteLabelInput {
  id?: string;
  dataOrigin?: string;
  data_origin?: string;
  dataOriginId?: string;
  data_origin_id?: string;
  dataOriginUrl?: string | null;
  data_origin_url?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
  source: string;
  sourceId?: string;
  source_id?: string;
  name: string;
  brand?: string | null;
  upc?: string | null;
  offMarket?: boolean;
  off_market?: boolean;
  searchText?: string;
  search_text?: string;
  label?: Record<string, unknown>;
}

export interface NormalizedBrandSiteLabel {
  id: string;
  source: string;
  sourceId: string;
  dataOrigin: "brand_site";
  dataOriginId: string;
  dataOriginPriority: number;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  searchText: string;
  label: Record<string, unknown>;
  dataOriginUrl: string | null;
  reviewIssues: string[];
}

export function assertProductionReady(items: NormalizedBrandSiteLabel[]): void;
export function buildSearchText(item: {
  source?: unknown;
  sourceId?: unknown;
  dataOrigin?: unknown;
  dataOriginId?: unknown;
  name?: unknown;
  brand?: unknown;
  upc?: unknown;
  dataOriginUrl?: unknown;
  label?: Record<string, unknown>;
}): string;
export function findProductionReviewIssues(item: {
  sourceId?: unknown;
  dataOriginId?: unknown;
  dataOriginUrl?: unknown;
  name?: unknown;
  searchText: string;
  label?: Record<string, unknown>;
}): string[];
export function getDbUrl(): string;
export function normalizeItem(item: BrandSiteLabelInput): NormalizedBrandSiteLabel;
export function runPsql(dbUrl: string, script: string): string;
