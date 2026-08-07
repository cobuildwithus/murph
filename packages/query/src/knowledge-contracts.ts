import * as z from "@murphai/contracts/zod-runtime";

import {
  DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
  KNOWLEDGE_SLUG_PATTERN,
} from "./knowledge-model.ts";

const nonEmptyStringSchema = z.string().min(1);
const nullableNonEmptyStringSchema = nonEmptyStringSchema.nullable();
const pathLikeSchema = nonEmptyStringSchema;
const knowledgePageSlugSchema = z.string().regex(KNOWLEDGE_SLUG_PATTERN);
const knowledgeLibrarySlugSchema = nonEmptyStringSchema;
const knowledgeRelatedSlugSchema = nonEmptyStringSchema;

export interface KnowledgePageReference {
  compiledAt: string | null;
  librarySlugs: string[];
  pagePath: string;
  pageType: string | null;
  relatedSlugs: string[];
  slug: string;
  sourcePaths: string[];
  status: string | null;
  summary: string | null;
  title: string;
}

export interface KnowledgePageMetadata extends KnowledgePageReference {}

export interface KnowledgePage extends KnowledgePageMetadata {
  body: string;
  markdown: string;
}

export interface KnowledgeGraphSearchHit extends KnowledgePageReference {
  matchedTerms: string[];
  score: number;
  snippet: string;
}

export interface KnowledgeGraphSearchResult {
  format: typeof DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT;
  hits: KnowledgeGraphSearchHit[];
  query: string;
  total: number;
}

export interface KnowledgeUpsertResult {
  bodyLength: number;
  indexPath: string;
  page: KnowledgePageMetadata;
  savedAt: string;
  vault: string;
}

export interface KnowledgeListResult {
  limit: number;
  pageCount: number;
  pageType: string | null;
  pages: KnowledgePageMetadata[];
  status: string | null;
  vault: string;
}

export interface KnowledgeSearchHit extends KnowledgeGraphSearchHit {}

export interface KnowledgeSearchResult
  extends KnowledgeGraphSearchResult {
  hits: KnowledgeSearchHit[];
  pageType: string | null;
  status: string | null;
  vault: string;
}

export interface KnowledgeLogEntry {
  action: string;
  block: string;
  occurredAt: string;
  title: string;
}

export interface KnowledgeLogTailResult {
  count: number;
  entries: KnowledgeLogEntry[];
  limit: number;
  logPath: string;
  vault: string;
}

export interface KnowledgeGetResult {
  page: KnowledgePage;
  vault: string;
}

export interface KnowledgeIndexRebuildResult {
  indexPath: string;
  pageCount: number;
  pageTypes: string[];
  rebuilt: true;
  vault: string;
}

export interface KnowledgeLintProblem {
  code: string;
  message: string;
  pagePath: string;
  severity: "error" | "warning";
  slug: string | null;
}

export interface KnowledgeLintResult {
  ok: boolean;
  pageCount: number;
  problemCount: number;
  problems: KnowledgeLintProblem[];
  vault: string;
}

export const knowledgePageReferenceSchema = z.object({
  compiledAt: nullableNonEmptyStringSchema,
  librarySlugs: z.array(knowledgeLibrarySlugSchema),
  pagePath: pathLikeSchema,
  pageType: nullableNonEmptyStringSchema,
  relatedSlugs: z.array(knowledgeRelatedSlugSchema),
  slug: knowledgePageSlugSchema,
  sourcePaths: z.array(pathLikeSchema),
  status: nullableNonEmptyStringSchema,
  summary: nullableNonEmptyStringSchema,
  title: nonEmptyStringSchema,
}) satisfies z.ZodType<KnowledgePageReference>;

export const knowledgePageMetadataSchema = knowledgePageReferenceSchema;

export const knowledgePageSchema = knowledgePageReferenceSchema.extend({
  body: z.string(),
  markdown: nonEmptyStringSchema,
}) satisfies z.ZodType<KnowledgePage>;

export const knowledgeUpsertResultSchema = z.object({
  bodyLength: z.number().int().nonnegative(),
  indexPath: pathLikeSchema,
  page: knowledgePageMetadataSchema,
  savedAt: nonEmptyStringSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeUpsertResult>;

export const knowledgeListResultSchema = z.object({
  limit: z.number().int().positive().max(200),
  pageCount: z.number().int().nonnegative(),
  pageType: nullableNonEmptyStringSchema,
  pages: z.array(knowledgePageMetadataSchema),
  status: nullableNonEmptyStringSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeListResult>;

export const knowledgeGraphSearchHitSchema =
  knowledgePageReferenceSchema.extend({
    matchedTerms: z.array(nonEmptyStringSchema),
    score: z.number(),
    snippet: nonEmptyStringSchema,
  }) satisfies z.ZodType<KnowledgeGraphSearchHit>;

export const knowledgeGraphSearchResultSchema = z.object({
  format: z.literal(DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT),
  hits: z.array(knowledgeGraphSearchHitSchema),
  query: nonEmptyStringSchema,
  total: z.number().int().nonnegative(),
}) satisfies z.ZodType<KnowledgeGraphSearchResult>;

export const knowledgeSearchHitSchema =
  knowledgeGraphSearchHitSchema satisfies z.ZodType<KnowledgeSearchHit>;

export const knowledgeSearchResultSchema = knowledgeGraphSearchResultSchema.extend({
  pageType: nullableNonEmptyStringSchema,
  status: nullableNonEmptyStringSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeSearchResult>;

export const knowledgeLogEntrySchema = z.object({
  action: nonEmptyStringSchema,
  block: nonEmptyStringSchema,
  occurredAt: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
}) satisfies z.ZodType<KnowledgeLogEntry>;

export const knowledgeLogTailResultSchema = z.object({
  count: z.number().int().nonnegative(),
  entries: z.array(knowledgeLogEntrySchema),
  limit: z.number().int().positive().max(200),
  logPath: pathLikeSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeLogTailResult>;

export const knowledgeGetResultSchema = z.object({
  page: knowledgePageSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeGetResult>;

export const knowledgeIndexRebuildResultSchema = z.object({
  indexPath: pathLikeSchema,
  pageCount: z.number().int().nonnegative(),
  pageTypes: z.array(nonEmptyStringSchema),
  rebuilt: z.literal(true),
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeIndexRebuildResult>;

export const knowledgeLintProblemSchema = z.object({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  pagePath: pathLikeSchema,
  severity: z.enum(["error", "warning"]),
  slug: knowledgePageSlugSchema.nullable(),
}) satisfies z.ZodType<KnowledgeLintProblem>;

export const knowledgeLintResultSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative(),
  problems: z.array(knowledgeLintProblemSchema),
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeLintResult>;
