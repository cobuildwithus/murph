export interface SampleSummaryIdInput {
  date: string;
  stream: string;
  unit?: string | null;
}

export function buildSampleSummaryId(summary: SampleSummaryIdInput): string {
  return `sample-summary:${summary.date}:${summary.stream}:${summary.unit ?? "none"}`;
}
