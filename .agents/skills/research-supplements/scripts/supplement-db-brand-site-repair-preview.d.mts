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
  parserStatus: "structured_ready" | "partial_parse" | "needs_better_parser";
  removableFieldCandidates: string[];
  dataOriginUrl?: string | null;
  proposedSearchTextPreview: string;
}

export function extractIngredientRows(label: Record<string, unknown>): Array<Record<string, unknown>>;
export function extractIngredientRowsFromText(input: string): Array<Record<string, unknown>>;
export function extractServingSizes(label: Record<string, unknown>): Array<Record<string, unknown>>;
export function repairPreviewForRow(row: RepairPreviewRow): ProposedRepairPreview;
