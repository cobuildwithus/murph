const SOURCE_ARTIFACT_KEY_VALUE =
  "source_artifact:[A-Za-z0-9][A-Za-z0-9_:/+.-]*[A-Za-z0-9]";
const SOURCE_ARTIFACT_KEY = `\`*${SOURCE_ARTIFACT_KEY_VALUE}\`*`;
const SOURCE_ARTIFACT_KEY_LIST =
  `${SOURCE_ARTIFACT_KEY}(?:[ \\t]*(?:;|,)[ \\t]*${SOURCE_ARTIFACT_KEY})*`;

const LABELED_SOURCE_KEY_LIST_PATTERN = new RegExp(
  `[ \\t]*(?:Source[ \\t]+keys?|sourceKeys|Source[ \\t]+basis|Safety[ \\t]+basis|Citation[ \\t]+keys?|Sources?)[ \\t]*:[ \\t]*${SOURCE_ARTIFACT_KEY_LIST}\\.?`,
  "giu",
);
const BRACKETED_SOURCE_KEY_LIST_PATTERN = new RegExp(
  `[ \\t]*\\[[ \\t]*${SOURCE_ARTIFACT_KEY_LIST}[ \\t]*\\]`,
  "giu",
);
const PARENTHETICAL_SOURCE_KEY_LIST_PATTERN = new RegExp(
  `[ \\t]*\\([ \\t]*${SOURCE_ARTIFACT_KEY_LIST}[ \\t]*\\)`,
  "giu",
);
const COLON_SOURCE_KEY_LIST_PATTERN = new RegExp(
  `:[ \\t]*${SOURCE_ARTIFACT_KEY_LIST}\\.?`,
  "giu",
);
const LEFTOVER_SOURCE_ARTIFACT_SENTENCE_PATTERN = new RegExp(
  `(?:^|(?<=[.!?]\\s))[^.!?\\n]*${SOURCE_ARTIFACT_KEY}[^.!?\\n]*[.!?]?`,
  "giu",
);
const RAW_SOURCE_KEY_PATTERN = new RegExp(SOURCE_ARTIFACT_KEY, "giu");
const SOURCE_KEY_SENTENCE_PATTERN =
  /(?:^|(?<=[.!?]\s))[^.!?\n]*\b(?:source|citation)[ \t]+keys?\b[^.!?\n]*[.!?]?/giu;
const EMPTY_CITATION_PARENS_PATTERN = /[ \t]*\([ \t]*(?:[,;][ \t]*)*\)/gu;
const EMPTY_CITATION_BRACKETS_PATTERN = /[ \t]*\[[ \t]*(?:[,;][ \t]*)*\]/gu;
const EMPTY_CODE_SPAN_PATTERN = /`{2,}/gu;

export function cleanHealthCommonsUserFacingCopy(value: string): string {
  return value
    .replace(LABELED_SOURCE_KEY_LIST_PATTERN, "")
    .replace(BRACKETED_SOURCE_KEY_LIST_PATTERN, "")
    .replace(PARENTHETICAL_SOURCE_KEY_LIST_PATTERN, "")
    .replace(COLON_SOURCE_KEY_LIST_PATTERN, ":")
    .replace(LEFTOVER_SOURCE_ARTIFACT_SENTENCE_PATTERN, "")
    .replace(RAW_SOURCE_KEY_PATTERN, "")
    .replace(SOURCE_KEY_SENTENCE_PATTERN, "")
    .replace(EMPTY_CODE_SPAN_PATTERN, "")
    .replace(EMPTY_CITATION_PARENS_PATTERN, "")
    .replace(EMPTY_CITATION_BRACKETS_PATTERN, "")
    .replace(/[ \t]*(?:;|,)[ \t]*([.;!?])/gu, "$1")
    .replace(/[ \t]+(?:,|;)([ \t]*(?:and|or)\b)/giu, "$1")
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/:[ \t]*([.;!?])/gu, "$1")
    .replace(/\[\s*\]/gu, "")
    .replace(/\(\s*\)/gu, "")
    .replace(/:[ \t]*(?=(?:\r?\n|$))/gu, ".")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+(\r?\n)/gu, "$1")
    .replace(/(\r?\n)[ \t]+/gu, "$1")
    .trim();
}

export function cleanOptionalHealthCommonsUserFacingCopy(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = cleanHealthCommonsUserFacingCopy(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function cleanHealthCommonsUserFacingCopyList(
  values: readonly string[] | null | undefined,
): string[] {
  return (values ?? [])
    .map(cleanHealthCommonsUserFacingCopy)
    .filter((value) => value.length > 0);
}
