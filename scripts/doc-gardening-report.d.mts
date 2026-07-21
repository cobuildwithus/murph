export interface DocGardeningReport {
  unindexed: string[];
  broken: string[];
}

export interface DocGardeningFilterOptions {
  exclude: RegExp;
  trackedPaths: ReadonlySet<string>;
}

export declare function parseDocGardeningReport(
  text: string,
  options: DocGardeningFilterOptions,
): DocGardeningReport;

export declare function formatDocGardeningReport(
  report: DocGardeningReport,
): string;

export declare function filterDocGardeningInventory(
  text: string,
  options: DocGardeningFilterOptions,
): string;
