import type { VaultReadModel, VaultRecord, VaultRecordType } from "./model.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export interface SearchFilters {
  recordTypes?: VaultRecordType[];
  kinds?: string[];
  streams?: string[];
  experimentSlug?: string;
  from?: string;
  to?: string;
  tags?: string[];
  limit?: number;
  includeSamples?: boolean;
}

export interface SearchCitation {
  path: string;
  recordId: string;
  aliasIds: string[];
}

export interface SearchHit {
  recordId: string;
  aliasIds: string[];
  recordType: VaultRecordType;
  kind: string | null;
  stream: string | null;
  title: string | null;
  occurredAt: string | null;
  date: string | null;
  experimentSlug: string | null;
  tags: string[];
  path: string;
  snippet: string;
  score: number;
  matchedTerms: string[];
  citation: SearchCitation;
}

export interface SearchResult {
  format: "healthybob.search.v1";
  query: string;
  total: number;
  hits: SearchHit[];
}

interface SearchableRecord {
  record: VaultRecord;
  titleText: string;
  titleLower: string;
  bodyText: string;
  bodyLower: string;
  tagsText: string;
  tagsLower: string;
  structuredText: string;
  structuredLower: string;
}

export function searchVault(
  vault: VaultReadModel,
  query: string,
  filters: SearchFilters = {},
): SearchResult {
  const normalizedQuery = query.trim();
  const terms = tokenize(normalizedQuery);

  if (terms.length === 0) {
    return {
      format: "healthybob.search.v1",
      query: normalizedQuery,
      total: 0,
      hits: [],
    };
  }

  const scoredHits = filterRecords(vault.records, filters)
    .map(buildSearchableRecord)
    .map((candidate) => scoreCandidate(candidate, normalizedQuery, terms))
    .filter((entry): entry is SearchHit => entry !== null)
    .sort(compareSearchHits);

  const limit = normalizeLimit(filters.limit);

  return {
    format: "healthybob.search.v1",
    query: normalizedQuery,
    total: scoredHits.length,
    hits: scoredHits.slice(0, limit),
  };
}

function filterRecords(records: VaultRecord[], filters: SearchFilters): VaultRecord[] {
  const recordTypeSet = filters.recordTypes?.length
    ? new Set(filters.recordTypes)
    : null;
  const kindSet = filters.kinds?.length ? new Set(filters.kinds) : null;
  const streamSet = filters.streams?.length ? new Set(filters.streams) : null;
  const tagSet = filters.tags?.length ? new Set(filters.tags) : null;
  const includeSamples =
    filters.includeSamples ?? Boolean(recordTypeSet?.has("sample") || streamSet);

  return records.filter((record) => {
    if (!includeSamples && record.recordType === "sample") {
      return false;
    }

    if (recordTypeSet && !recordTypeSet.has(record.recordType)) {
      return false;
    }

    if (kindSet && (!record.kind || !kindSet.has(record.kind))) {
      return false;
    }

    if (streamSet && (!record.stream || !streamSet.has(record.stream))) {
      return false;
    }

    if (filters.experimentSlug && record.experimentSlug !== filters.experimentSlug) {
      return false;
    }

    const dateLike = record.date ?? record.occurredAt;

    if (filters.from && compareDateLike(dateLike, filters.from) < 0) {
      return false;
    }

    if (filters.to && compareDateLike(dateLike, filters.to) > 0) {
      return false;
    }

    if (tagSet && !record.tags.some((tag) => tagSet.has(tag))) {
      return false;
    }

    return true;
  });
}

function buildSearchableRecord(record: VaultRecord): SearchableRecord {
  const titleText = compactStrings([
    record.title,
    record.kind,
    record.stream,
    record.experimentSlug,
  ]).join(" · ");
  const bodyText = compactStrings([record.body]).join("\n").trim();
  const tagsText = compactStrings(record.tags).join(" ");
  const structuredText = compactStrings([
    record.displayId,
    record.sourcePath,
    record.sourceFile,
    ...record.lookupIds,
    JSON.stringify(record.data),
    record.frontmatter ? JSON.stringify(record.frontmatter) : null,
  ]).join("\n");

  return {
    record,
    titleText,
    titleLower: titleText.toLowerCase(),
    bodyText,
    bodyLower: bodyText.toLowerCase(),
    tagsText,
    tagsLower: tagsText.toLowerCase(),
    structuredText,
    structuredLower: structuredText.toLowerCase(),
  };
}

function scoreCandidate(
  candidate: SearchableRecord,
  normalizedQuery: string,
  terms: string[],
): SearchHit | null {
  const normalizedPhrase = normalizedQuery.toLowerCase();
  const matchedTerms = new Set<string>();
  let score = 0;

  const titleMetrics = scoreText(candidate.titleLower, terms);
  const bodyMetrics = scoreText(candidate.bodyLower, terms);
  const tagMetrics = scoreText(candidate.tagsLower, terms);
  const structuredMetrics = scoreText(candidate.structuredLower, terms);

  accumulateMatchedTerms(matchedTerms, titleMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, bodyMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, tagMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, structuredMetrics.matchedTerms);

  if (candidate.titleLower.includes(normalizedPhrase)) {
    score += 12;
  }

  if (candidate.bodyLower.includes(normalizedPhrase)) {
    score += 6;
  }

  if (
    candidate.tagsLower.includes(normalizedPhrase) ||
    candidate.structuredLower.includes(normalizedPhrase)
  ) {
    score += 4;
  }

  score += titleMetrics.count * 4.5;
  score += bodyMetrics.count * 1.75;
  score += tagMetrics.count * 3.5;
  score += structuredMetrics.count * 0.9;

  const coverage = matchedTerms.size / terms.length;
  score += coverage * 6;

  if (matchedTerms.size === terms.length && terms.length > 1) {
    score += 3;
  }

  if (score <= 0) {
    return null;
  }

  return {
    recordId: candidate.record.displayId,
    aliasIds: candidate.record.lookupIds,
    recordType: candidate.record.recordType,
    kind: candidate.record.kind,
    stream: candidate.record.stream,
    title: candidate.record.title,
    occurredAt: candidate.record.occurredAt,
    date: candidate.record.date,
    experimentSlug: candidate.record.experimentSlug,
    tags: candidate.record.tags,
    path: candidate.record.sourcePath,
    snippet: buildSnippet(candidate, terms),
    score: Number(score.toFixed(4)),
    matchedTerms: [...matchedTerms].sort(),
    citation: {
      path: candidate.record.sourcePath,
      recordId: candidate.record.displayId,
      aliasIds: candidate.record.lookupIds,
    },
  };
}

function buildSnippet(candidate: SearchableRecord, terms: string[]): string {
  for (const source of [
    candidate.bodyText,
    candidate.titleText,
    candidate.tagsText,
    candidate.structuredText,
  ]) {
    const snippet = findSnippet(source, terms);
    if (snippet) {
      return snippet;
    }
  }

  return candidate.titleText || candidate.record.displayId;
}

function findSnippet(text: string, terms: string[]): string | null {
  if (!text.trim()) {
    return null;
  }

  const normalizedText = text.toLowerCase();
  let bestIndex = -1;
  let bestTerm = "";

  for (const term of terms) {
    const nextIndex = normalizedText.indexOf(term);
    if (nextIndex !== -1 && (bestIndex === -1 || nextIndex < bestIndex)) {
      bestIndex = nextIndex;
      bestTerm = term;
    }
  }

  if (bestIndex === -1) {
    const compact = compactWhitespace(text);
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
  }

  const start = Math.max(0, bestIndex - 80);
  const end = Math.min(text.length, bestIndex + bestTerm.length + 100);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${compactWhitespace(text.slice(start, end))}${suffix}`;
}

function compareSearchHits(left: SearchHit, right: SearchHit): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  const leftDateLike = left.date ?? left.occurredAt ?? "";
  const rightDateLike = right.date ?? right.occurredAt ?? "";

  if (leftDateLike !== rightDateLike) {
    return rightDateLike.localeCompare(leftDateLike);
  }

  return left.recordId.localeCompare(right.recordId);
}

function scoreText(
  value: string,
  terms: string[],
): { count: number; matchedTerms: string[] } {
  let count = 0;
  const matchedTerms = new Set<string>();

  for (const term of terms) {
    let startIndex = 0;
    while (startIndex < value.length) {
      const nextIndex = value.indexOf(term, startIndex);
      if (nextIndex === -1) {
        break;
      }

      count += 1;
      matchedTerms.add(term);
      startIndex = nextIndex + term.length;
    }
  }

  return {
    count,
    matchedTerms: [...matchedTerms],
  };
}

function accumulateMatchedTerms(target: Set<string>, source: string[]): void {
  for (const term of source) {
    target.add(term);
  }
}

function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(matches.filter((term) => term.length > 1))];
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value): value is string => value.length > 0);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareDateLike(value: string | null | undefined, boundary: string): number {
  if (!value) {
    return -1;
  }

  const normalizedValue = value.length > 10 ? value.slice(0, 10) : value;
  const normalizedBoundary = boundary.length > 10 ? boundary.slice(0, 10) : boundary;

  return normalizedValue.localeCompare(normalizedBoundary);
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}
