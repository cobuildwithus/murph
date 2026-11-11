export interface DocGardeningReport {
  unindexed: string[];
  broken: string[];
}

export declare function formatDocGardeningReport(
  report: DocGardeningReport,
): string;
