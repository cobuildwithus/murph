export interface OcrPreviewOptions {
  input: string;
  outputDir: string;
  source?: string | null;
  limit: number;
  model: string;
  timeoutMs: number;
  delayMs: number;
  retries: number;
  concurrency?: number;
}

export interface OcrJson {
  imageContainsFactsPanel: boolean;
  confidence: "high" | "medium" | "low" | string;
  factsText: string | null;
  servingSize: string | null;
  servingsPerContainer: string | null;
  otherIngredients: string | null;
  warnings: string[];
}

export interface OcrCandidate {
  id?: string;
  dataOriginId?: string;
  source?: string;
  name?: string;
  reviewIssues: string[];
  label: {
    needsManualReview?: boolean;
    evidenceStatus?: string;
    servingSizes?: Array<Record<string, unknown>>;
    ingredientRows?: Array<Record<string, unknown>>;
    otherIngredients?: string | null;
    [key: string]: unknown;
  };
  ocrPreview: {
    promoted: boolean;
    confidence: string;
    imageContainsFactsPanel: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenAiOcrRequest {
  model: string;
  input: Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  text: {
    format: {
      type: string;
      schema: {
        properties: Record<string, {
          type: string | string[];
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
  };
}

export function buildOcrCandidate(candidate: Record<string, unknown>, ocr: OcrJson, imageUrl: string, fetchedAt?: string): OcrCandidate;
export function buildOpenAiOcrRequest(input: { model: string; imageUrl: string; candidate: Record<string, unknown> }): OpenAiOcrRequest;
export function buildOcrPreview(options: OcrPreviewOptions): Promise<Record<string, unknown>>;
export function parseOcrJson(text: string): OcrJson;
export function selectOcrInputRows(rows: Array<Record<string, unknown>>, options: { source?: string | null; limit: number }): Array<Record<string, unknown>>;
export function summarizeOcrPreview(input: {
  inputRows: number;
  eligibleRows: number;
  candidates: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
  model: string;
}): Record<string, unknown>;
