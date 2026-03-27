import { extractIsoDatePrefix } from "@healthybob/contracts";

import type { VaultRecord, VaultRecordType } from "./model.ts";

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

export interface SearchableDocument {
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
  path?: string | null;
  titleText: string;
  bodyText: string;
  tagsText: string;
  structuredText: string;
}

export interface SearchDocument extends SearchableDocument {
  path: string;
}

export function materializeSearchDocument(record: VaultRecord): SearchDocument {
  const titleText = compactStrings([
    record.title,
    record.kind,
    record.status ?? null,
    record.stream,
    record.experimentSlug,
  ]).join(" · ");
  const bodyText = compactStrings([record.body]).join("\n").trim();
  const tagsText = compactStrings(record.tags).join(" ");
  const structuredText = compactStrings([
    record.displayId,
    record.primaryLookupId,
    record.sourcePath,
    record.sourceFile,
    ...record.lookupIds,
    ...(record.relatedIds ?? []),
    safeJsonStringify(record.data),
    record.frontmatter ? safeJsonStringify(record.frontmatter) : null,
  ]).join("\n");

  return {
    recordId: record.displayId,
    aliasIds: record.lookupIds,
    recordType: record.recordType,
    kind: record.kind,
    stream: record.stream,
    title: record.title,
    occurredAt: record.occurredAt,
    date: record.date,
    experimentSlug: record.experimentSlug,
    tags: record.tags,
    path: record.sourcePath,
    titleText,
    bodyText,
    tagsText,
    structuredText,
  };
}

export function materializeSearchDocuments(
  records: readonly VaultRecord[],
): SearchDocument[] {
  return records.map(materializeSearchDocument);
}

export function filterSearchDocuments<TDocument extends SearchableDocument>(
  documents: readonly TDocument[],
  filters: SearchFilters,
): TDocument[] {
  const recordTypeSet = filters.recordTypes?.length
    ? new Set(filters.recordTypes)
    : null;
  const kindSet = filters.kinds?.length ? new Set(filters.kinds) : null;
  const streamSet = filters.streams?.length ? new Set(filters.streams) : null;
  const tagSet = filters.tags?.length ? new Set(filters.tags) : null;
  const includeSamples =
    filters.includeSamples ?? Boolean(recordTypeSet?.has("sample") || streamSet);

  return documents.filter((document) => {
    if (!includeSamples && document.recordType === "sample") {
      return false;
    }

    if (recordTypeSet && !recordTypeSet.has(document.recordType)) {
      return false;
    }

    if (kindSet && (!document.kind || !kindSet.has(document.kind))) {
      return false;
    }

    if (streamSet && (!document.stream || !streamSet.has(document.stream))) {
      return false;
    }

    if (filters.experimentSlug && document.experimentSlug !== filters.experimentSlug) {
      return false;
    }

    const dateLike = document.date ?? document.occurredAt;

    if (filters.from && compareDateLike(dateLike, filters.from) < 0) {
      return false;
    }

    if (filters.to && compareDateLike(dateLike, filters.to) > 0) {
      return false;
    }

    if (tagSet && !document.tags.some((tag) => tagSet.has(tag))) {
      return false;
    }

    return true;
  });
}

export function scoreSearchDocuments(
  documents: readonly SearchableDocument[],
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

  const scoredHits = filterSearchDocuments(documents, filters)
    .map((candidate) => scoreSearchDocument(candidate, normalizedQuery, terms))
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

export function scoreSearchDocument(
  candidate: SearchableDocument,
  normalizedQuery: string,
  terms: readonly string[],
): SearchHit | null {
  const normalizedPhrase = normalizedQuery.toLowerCase();
  const matchedTerms = new Set<string>();
  let score = 0;

  const titleLower = candidate.titleText.toLowerCase();
  const bodyLower = candidate.bodyText.toLowerCase();
  const tagsLower = candidate.tagsText.toLowerCase();
  const structuredLower = candidate.structuredText.toLowerCase();

  const titleMetrics = scoreText(titleLower, terms);
  const bodyMetrics = scoreText(bodyLower, terms);
  const tagMetrics = scoreText(tagsLower, terms);
  const structuredMetrics = scoreText(structuredLower, terms);

  accumulateMatchedTerms(matchedTerms, titleMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, bodyMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, tagMetrics.matchedTerms);
  accumulateMatchedTerms(matchedTerms, structuredMetrics.matchedTerms);

  if (titleLower.includes(normalizedPhrase)) {
    score += 12;
  }

  if (bodyLower.includes(normalizedPhrase)) {
    score += 6;
  }

  if (
    tagsLower.includes(normalizedPhrase) ||
    structuredLower.includes(normalizedPhrase)
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
    recordId: candidate.recordId,
    aliasIds: candidate.aliasIds,
    recordType: candidate.recordType,
    kind: candidate.kind,
    stream: candidate.stream,
    title: candidate.title,
    occurredAt: candidate.occurredAt,
    date: candidate.date,
    experimentSlug: candidate.experimentSlug,
    tags: candidate.tags,
    path: candidate.path ?? "",
    snippet: buildSnippet(candidate, terms),
    score: Number(score.toFixed(4)),
    matchedTerms: [...matchedTerms].sort(),
    citation: {
      path: candidate.path ?? "",
      recordId: candidate.recordId,
      aliasIds: candidate.aliasIds,
    },
  };
}

export function normalizeSearchLimit(limit: number | undefined): number {
  return normalizeLimit(limit);
}

export function compareSearchHits(left: SearchHit, right: SearchHit): number {
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

export function buildSnippet(
  candidate: SearchableDocument,
  terms: readonly string[],
): string {
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

  return candidate.titleText || candidate.recordId;
}

export function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(matches.filter((term) => term.length > 1))];
}

export function compareDateLike(
  value: string | null | undefined,
  boundary: string,
): number {
  if (!value) {
    return -1;
  }

  const normalizedValue = extractIsoDatePrefix(value) ?? value;
  const normalizedBoundary = extractIsoDatePrefix(boundary) ?? boundary;

  return normalizedValue.localeCompare(normalizedBoundary);
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findSnippet(text: string, terms: readonly string[]): string | null {
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

function scoreText(
  value: string,
  terms: readonly string[],
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

function accumulateMatchedTerms(target: Set<string>, source: readonly string[]): void {
  for (const term of source) {
    target.add(term);
  }
}

function compactStrings(values: readonly (string | null | undefined)[]): string[] {
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value): value is string => value.length > 0);
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
