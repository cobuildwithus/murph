export interface RepairPreviewRow {
  id: string;
  dataOriginId: string;
  dataOriginUrl?: string | null;
  name: string;
  brand?: string | null;
  upc?: string | null;
  offMarket?: boolean;
  searchText?: string;
  label?: Record<string, unknown>;
}

export interface ProposedRepairPreview {
  id: string;
  dataOriginId: string;
  name: string;
  brand?: string | null;
  oldSearchTextLength: number;
  proposedSearchTextLength: number;
  searchTextWouldChange: boolean;
  existingIngredientRows: number;
  parsedIngredientRows: number;
  existingServingSizes: number;
  parsedServingSizes: number;
  parsedServingSizesPreview: Array<Record<string, unknown>>;
  parserStatus: "structured_ready" | "partial_parse" | "needs_better_parser";
  parserBlockers: string[];
  automatedBackfillReady: boolean;
  evidenceRecoveryHint: string;
  parsedIngredientRowSources: string[];
  removableFieldCandidates: string[];
  dataOriginUrl?: string | null;
  proposedSearchTextPreview: string;
}

export interface RepairPreviewSummary {
  rowsReviewed: number;
  searchTextWouldChange: number;
  oldOversizedSearchTextRows: number;
  proposedOversizedSearchTextRows: number;
  addIngredientRows: number;
  addServingSizes: number;
  structuredReady: number;
  automatedBackfillReady: number;
  structuredReadyWithBlockers: number;
  partialParse: number;
  needsBetterParser: number;
  removableFieldCandidateRows: number;
  byBrand: Record<string, {
    rows: number;
    structuredReady: number;
    automatedBackfillReady: number;
    needsBetterParser: number;
  }>;
}

export function extractIngredientRows(label: Record<string, unknown>): Array<Record<string, unknown>>;
export function extractIngredientRowsFromText(input: string): Array<Record<string, unknown>>;
export function extractServingSizes(
  label: Record<string, unknown>,
  context?: { productName?: string; ingredientRows?: Array<Record<string, unknown>> },
): Array<Record<string, unknown>>;
export function repairPreviewForRow(row: RepairPreviewRow): ProposedRepairPreview;
export function summarize(previews: ProposedRepairPreview[]): RepairPreviewSummary;
