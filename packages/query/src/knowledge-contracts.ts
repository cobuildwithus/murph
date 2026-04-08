import { z } from "zod";

import { DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT } from "./knowledge-model.ts";
import type {
  DerivedKnowledgeSearchHit,
  DerivedKnowledgeSearchResult,
} from "./knowledge-graph.ts";

const nonEmptyStringSchema = z.string().min(1);
const nullableNonEmptyStringSchema = nonEmptyStringSchema.nullable();
const pathLikeSchema = nonEmptyStringSchema;
const slugSchema = nonEmptyStringSchema;

export type KnowledgePageReference = Pick<
  DerivedKnowledgeSearchHit,
  | "compiledAt"
  | "librarySlugs"
  | "pagePath"
  | "pageType"
  | "relatedSlugs"
  | "slug"
  | "sourcePaths"
  | "status"
  | "summary"
  | "title"
>;

export interface KnowledgePageMetadata extends KnowledgePageReference {}

export interface KnowledgePage extends KnowledgePageMetadata {
  body: string;
  markdown: string;
}

export interface KnowledgeUpsertResult {
  bodyLength: number;
  indexPath: string;
  page: KnowledgePageMetadata;
  savedAt: string;
  vault: string;
}

export interface KnowledgeListResult {
  pageCount: number;
  pageType: string | null;
  pages: KnowledgePageMetadata[];
  status: string | null;
  vault: string;
}

export interface KnowledgeSearchHit
  extends DerivedKnowledgeSearchHit {}

export interface KnowledgeSearchResult
  extends Pick<DerivedKnowledgeSearchResult, "format" | "hits" | "query" | "total"> {
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
  librarySlugs: z.array(slugSchema),
  pagePath: pathLikeSchema,
  pageType: nullableNonEmptyStringSchema,
  relatedSlugs: z.array(slugSchema),
  slug: slugSchema,
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
  pageCount: z.number().int().nonnegative(),
  pageType: nullableNonEmptyStringSchema,
  pages: z.array(knowledgePageMetadataSchema),
  status: nullableNonEmptyStringSchema,
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeListResult>;

export const knowledgeSearchHitSchema =
  knowledgePageReferenceSchema.extend({
    matchedTerms: z.array(nonEmptyStringSchema),
    score: z.number(),
    snippet: nonEmptyStringSchema,
  }) satisfies z.ZodType<KnowledgeSearchHit>;

export const knowledgeSearchResultSchema = z.object({
  format: z.literal(DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT),
  hits: z.array(knowledgeSearchHitSchema),
  pageType: nullableNonEmptyStringSchema,
  query: nonEmptyStringSchema,
  status: nullableNonEmptyStringSchema,
  total: z.number().int().nonnegative(),
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
  slug: slugSchema.nullable(),
}) satisfies z.ZodType<KnowledgeLintProblem>;

export const knowledgeLintResultSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative(),
  problems: z.array(knowledgeLintProblemSchema),
  vault: pathLikeSchema,
}) satisfies z.ZodType<KnowledgeLintResult>;
