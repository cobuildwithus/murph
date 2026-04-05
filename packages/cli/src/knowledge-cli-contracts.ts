import { z } from 'incur'
import {
  isoTimestampSchema,
  pathSchema,
  slugSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
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
})

export const knowledgePageMetadataSchema = knowledgePageReferenceSchema

export const knowledgePageSchema = knowledgePageMetadataSchema.extend({
  body: z.string(),
  markdown: z.string().min(1),
})

export const knowledgeUpsertResultSchema = z.object({
  vault: pathSchema,
  indexPath: pathSchema,
  page: knowledgePageMetadataSchema,
  bodyLength: z.number().int().nonnegative(),
  savedAt: isoTimestampSchema,
})

export const knowledgeListResultSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  pageType: z.string().min(1).nullable(),
  pages: z.array(knowledgePageMetadataSchema),
  status: z.string().min(1).nullable(),
  vault: pathSchema,
})

export const knowledgeSearchHitSchema = knowledgePageReferenceSchema.extend({
  matchedTerms: z.array(z.string().min(1)),
  score: z.number(),
  snippet: z.string().min(1),
})

export const knowledgeSearchResultSchema = z.object({
  format: z.literal(DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT),
  hits: z.array(knowledgeSearchHitSchema),
  pageType: z.string().min(1).nullable(),
  query: z.string().min(1),
  status: z.string().min(1).nullable(),
  total: z.number().int().nonnegative(),
  vault: pathSchema,
})

export const knowledgeLogEntrySchema = z.object({
  action: z.string().min(1),
  block: z.string().min(1),
  occurredAt: isoTimestampSchema,
  title: z.string().min(1),
})

export const knowledgeLogTailResultSchema = z.object({
  count: z.number().int().nonnegative(),
  entries: z.array(knowledgeLogEntrySchema),
  limit: z.number().int().positive().max(200),
  logPath: pathSchema,
  vault: pathSchema,
})

export const knowledgeShowResultSchema = z.object({
  page: knowledgePageSchema,
  vault: pathSchema,
})

export const knowledgeIndexRebuildResultSchema = z.object({
  indexPath: pathSchema,
  pageCount: z.number().int().nonnegative(),
  pageTypes: z.array(z.string().min(1)),
  rebuilt: z.literal(true),
  vault: pathSchema,
})

export const knowledgeLintProblemSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  pagePath: pathSchema,
  slug: slugSchema.nullable(),
  severity: z.enum(['error', 'warning']),
})

export const knowledgeLintResultSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative(),
  problems: z.array(knowledgeLintProblemSchema),
  vault: pathSchema,
})

export type KnowledgeUpsertResult = z.infer<typeof knowledgeUpsertResultSchema>
export type KnowledgeIndexRebuildResult = z.infer<typeof knowledgeIndexRebuildResultSchema>
export type KnowledgeLintResult = z.infer<typeof knowledgeLintResultSchema>
export type KnowledgeLintProblem = z.infer<typeof knowledgeLintProblemSchema>
export type KnowledgeListResult = z.infer<typeof knowledgeListResultSchema>
export type KnowledgeLogEntry = z.infer<typeof knowledgeLogEntrySchema>
export type KnowledgeLogTailResult = z.infer<typeof knowledgeLogTailResultSchema>
export type KnowledgePage = z.infer<typeof knowledgePageSchema>
export type KnowledgePageMetadata = z.infer<typeof knowledgePageMetadataSchema>
export type KnowledgePageReference = z.infer<typeof knowledgePageReferenceSchema>
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>
export type KnowledgeShowResult = z.infer<typeof knowledgeShowResultSchema>
