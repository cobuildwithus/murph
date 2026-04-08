import { z } from 'incur'
import {
  isoTimestampSchema,
  pathSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type {
  KnowledgeIndexRebuildResult as SharedKnowledgeIndexRebuildResult,
  KnowledgeLintProblem as SharedKnowledgeLintProblem,
  KnowledgeLintResult as SharedKnowledgeLintResult,
  KnowledgeListResult as SharedKnowledgeListResult,
  KnowledgeLogEntry as SharedKnowledgeLogEntry,
  KnowledgeLogTailResult as SharedKnowledgeLogTailResult,
  KnowledgePage as SharedKnowledgePage,
  KnowledgePageMetadata as SharedKnowledgePageMetadata,
  KnowledgePageReference as SharedKnowledgePageReference,
  KnowledgeSearchHit as SharedKnowledgeSearchHit,
  KnowledgeSearchResult as SharedKnowledgeSearchResult,
  KnowledgeShowResult as SharedKnowledgeShowResult,
  KnowledgeUpsertResult as SharedKnowledgeUpsertResult,
} from '@murphai/operator-config/knowledge-contracts'
import { DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT } from '@murphai/query'

export const knowledgePageReferenceSchema = z.object({
  compiledAt: isoTimestampSchema.nullable(),
  librarySlugs: z.array(slugSchema),
  pagePath: pathSchema,
  pageType: z.string().min(1).nullable(),
  relatedSlugs: z.array(z.string().min(1)),
  slug: slugSchema,
  sourcePaths: z.array(pathSchema),
  status: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
  title: z.string().min(1),
}) satisfies z.ZodType<SharedKnowledgePageReference>

export const knowledgePageMetadataSchema =
  knowledgePageReferenceSchema satisfies z.ZodType<SharedKnowledgePageMetadata>

export const knowledgePageSchema = knowledgePageMetadataSchema.extend({
  body: z.string(),
  markdown: z.string().min(1),
}) satisfies z.ZodType<SharedKnowledgePage>

export const knowledgeUpsertResultSchema = z.object({
  vault: pathSchema,
  indexPath: pathSchema,
  page: knowledgePageMetadataSchema,
  bodyLength: z.number().int().nonnegative(),
  savedAt: isoTimestampSchema,
}) satisfies z.ZodType<SharedKnowledgeUpsertResult>

export const knowledgeListResultSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  pageType: z.string().min(1).nullable(),
  pages: z.array(knowledgePageMetadataSchema),
  status: z.string().min(1).nullable(),
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeListResult>

export const knowledgeSearchHitSchema = knowledgePageReferenceSchema.extend({
  matchedTerms: z.array(z.string().min(1)),
  score: z.number(),
  snippet: z.string().min(1),
}) satisfies z.ZodType<SharedKnowledgeSearchHit>

export const knowledgeSearchResultSchema = z.object({
  format: z.literal(DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT),
  hits: z.array(knowledgeSearchHitSchema),
  pageType: z.string().min(1).nullable(),
  query: z.string().min(1),
  status: z.string().min(1).nullable(),
  total: z.number().int().nonnegative(),
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeSearchResult>

export const knowledgeLogEntrySchema = z.object({
  action: z.string().min(1),
  block: z.string().min(1),
  occurredAt: isoTimestampSchema,
  title: z.string().min(1),
}) satisfies z.ZodType<SharedKnowledgeLogEntry>

export const knowledgeLogTailResultSchema = z.object({
  count: z.number().int().nonnegative(),
  entries: z.array(knowledgeLogEntrySchema),
  limit: z.number().int().positive().max(200),
  logPath: pathSchema,
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeLogTailResult>

export const knowledgeShowResultSchema = z.object({
  page: knowledgePageSchema,
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeShowResult>

export const knowledgeIndexRebuildResultSchema = z.object({
  indexPath: pathSchema,
  pageCount: z.number().int().nonnegative(),
  pageTypes: z.array(z.string().min(1)),
  rebuilt: z.literal(true),
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeIndexRebuildResult>

export const knowledgeLintProblemSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  pagePath: pathSchema,
  slug: slugSchema.nullable(),
  severity: z.enum(['error', 'warning']),
}) satisfies z.ZodType<SharedKnowledgeLintProblem>

export const knowledgeLintResultSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative(),
  problems: z.array(knowledgeLintProblemSchema),
  vault: pathSchema,
}) satisfies z.ZodType<SharedKnowledgeLintResult>

export type {
  KnowledgeIndexRebuildResult,
  KnowledgeLintProblem,
  KnowledgeLintResult,
  KnowledgeListResult,
  KnowledgeLogEntry,
  KnowledgeLogTailResult,
  KnowledgePage,
  KnowledgePageMetadata,
  KnowledgePageReference,
  KnowledgeSearchHit,
  KnowledgeSearchResult,
  KnowledgeShowResult,
  KnowledgeUpsertResult,
} from '@murphai/operator-config/knowledge-contracts'
