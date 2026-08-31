export const REQUIRED_ITEMS: readonly string[];

export function isCyclomaticSourcePath(filePath: string): boolean;

export function validatePrComplexitySummary(input: {
  readonly changedPaths: readonly string[];
  readonly prBodyHtml: string;
}): string[];
