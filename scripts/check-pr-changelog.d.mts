export function isChangelogContentPath(changedPath: string): boolean;

export function parseItemReferences(value: string): Array<{
  editionId: string;
  itemId: string;
}> | null;

export function readChangelogItemsById(
  sourceText?: string,
  fragmentsRoot?: URL,
): Map<string, string>;

export function validatePrChangelog(input: {
  readonly changedPaths: readonly string[];
  readonly prBodyHtml: string;
  readonly changelogItemsById?: ReadonlyMap<string, string>;
}): string[];
