import { z } from 'incur'
import {
  isoTimestampSchema,
  pathSchema,
  slugSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import { researchExecutionModeValues } from './research-cli-contracts.js'

export const knowledgePageMetadataSchema = z.object({
  compiler: z.string().min(1).nullable(),
  compiledAt: isoTimestampSchema.nullable(),
  mode: z.enum(researchExecutionModeValues).nullable(),
  pagePath: pathSchema,
  pageType: z.string().min(1).nullable(),
  relatedSlugs: z.array(z.string().min(1)),
  slug: slugSchema,
  sourcePaths: z.array(pathSchema),
  status: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
  title: z.string().min(1),
})

export const knowledgePageSchema = knowledgePageMetadataSchema.extend({
  body: z.string(),
  markdown: z.string().min(1),
})

export const knowledgeCompileResultSchema = z.object({
  vault: pathSchema,
  indexPath: pathSchema,
  mode: z.enum(researchExecutionModeValues),
  page: knowledgePageMetadataSchema,
  prompt: z.string().min(1),
  responseLength: z.number().int().positive(),
  savedAt: isoTimestampSchema,
  warnings: z.array(z.string().min(1)),
})

export const knowledgeListResultSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  pageType: z.string().min(1).nullable(),
  pages: z.array(knowledgePageMetadataSchema),
  status: z.string().min(1).nullable(),
  vault: pathSchema,
})

export const knowledgeSearchHitSchema = z.object({
  compiledAt: isoTimestampSchema.nullable(),
  matchedTerms: z.array(z.string().min(1)),
  pagePath: pathSchema,
  pageType: z.string().min(1).nullable(),
  relatedSlugs: z.array(z.string().min(1)),
  score: z.number(),
  slug: slugSchema,
  snippet: z.string().min(1),
  sourcePaths: z.array(pathSchema),
  status: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
  title: z.string().min(1),
})

export const knowledgeSearchResultSchema = z.object({
  format: z.literal('murph.knowledge-search.v1'),
  hits: z.array(knowledgeSearchHitSchema),
  pageType: z.string().min(1).nullable(),
  query: z.string().min(1),
  status: z.string().min(1).nullable(),
  total: z.number().int().nonnegative(),
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
  slug: z.string().min(1).nullable(),
  severity: z.enum(['error', 'warning']),
})

export const knowledgeLintResultSchema = z.object({
  ok: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  problemCount: z.number().int().nonnegative(),
  problems: z.array(knowledgeLintProblemSchema),
  vault: pathSchema,
})

export type KnowledgeCompileResult = z.infer<typeof knowledgeCompileResultSchema>
export type KnowledgeIndexRebuildResult = z.infer<typeof knowledgeIndexRebuildResultSchema>
export type KnowledgeLintResult = z.infer<typeof knowledgeLintResultSchema>
export type KnowledgeLintProblem = z.infer<typeof knowledgeLintProblemSchema>
export type KnowledgeListResult = z.infer<typeof knowledgeListResultSchema>
export type KnowledgePage = z.infer<typeof knowledgePageSchema>
export type KnowledgePageMetadata = z.infer<typeof knowledgePageMetadataSchema>
export type KnowledgeSearchHit = z.infer<typeof knowledgeSearchHitSchema>
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>
export type KnowledgeShowResult = z.infer<typeof knowledgeShowResultSchema>
