export interface RecoveryQueueRow {
  source?: string;
  sourceId?: string;
  id?: string;
  dataOriginId?: string;
  name?: string;
  brand?: string;
  dataOriginUrl?: string;
  action?: string;
  evidenceRecoveryHint?: string;
  parserBlockers?: string[];
}

export interface ShopifyVariant {
  id?: number | string;
  title?: string;
  public_title?: string;
  option1?: string;
  option2?: string | null;
  option3?: string | null;
  sku?: string | null;
  barcode?: string | null;
  available?: boolean;
  name?: string;
  options?: string[];
}

export interface ShopifyMedia {
  alt?: string | null;
  position?: number;
  media_type?: string;
  src?: string;
  width?: number;
  height?: number;
  preview_image?: {
    src?: string;
    width?: number;
    height?: number;
  };
}

export interface ShopifyProduct {
  title?: string;
  vendor?: string;
  type?: string;
  description?: string;
  variants?: ShopifyVariant[];
  media?: ShopifyMedia[];
}

export interface RefetchPreviewOptions {
  queue: string;
  outputDir: string;
  source?: string | null;
  action?: string | null;
  limit: number;
  timeoutMs: number;
  delayMs: number;
  retries: number;
  hydrateDsldUpc?: boolean;
}

export interface RefetchEvidenceCandidate {
  id: string;
  source: string;
  sourceId: string;
  dataOrigin: "brand_site";
  dataOriginId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  searchText: string;
  reviewIssues: string[];
  label: {
    needsManualReview?: boolean;
    factsImageUrls?: string[];
    servingSizes?: Array<Record<string, unknown>>;
    ingredientRows?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  refetchPreview: Record<string, unknown>;
  [key: string]: unknown;
}

export function buildRefetchPreview(options: RefetchPreviewOptions): Promise<Record<string, unknown>>;
export function buildDsldStructuredFactsByUpcSql(upcs: string[]): string;
export function buildShopifyEvidenceCandidate(
  queueRow: RecoveryQueueRow,
  product: ShopifyProduct,
  fetchedAt?: string,
): RefetchEvidenceCandidate | null;
export function extractFactsTextFromShopifyProduct(product: ShopifyProduct): string | null;
export function factsTextContaminationReason(text: string): string | null;
export function hydrateCandidatesWithDsldFacts(
  candidates: RefetchEvidenceCandidate[],
  factsByUpc: Record<string, unknown>,
): RefetchEvidenceCandidate[];
export function matchShopifyVariantForQueueRow(
  queueRow: RecoveryQueueRow,
  product: ShopifyProduct,
): ShopifyVariant | null;
export function productFactsPromotionBlockedReasonForProduct(
  product: ShopifyProduct,
  factsText: string | null,
): string | null;
export function selectQueueRows(
  queue: RecoveryQueueRow[],
  options: { source?: string | null; action?: string | null; limit: number },
): RecoveryQueueRow[];
export function selectShopifyFactsMedia(
  product: ShopifyProduct,
  variant: ShopifyVariant,
): Array<Record<string, unknown>>;
export function shopifyJsonUrlForProductUrl(value: string): string | null;
export function variantCandidateTexts(queueRow: RecoveryQueueRow): string[];
