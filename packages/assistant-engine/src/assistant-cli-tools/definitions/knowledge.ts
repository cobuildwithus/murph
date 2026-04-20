import { z } from 'zod'
import {
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
} from '../../knowledge.js'
import type { AssistantToolContext } from '../shared.js'
import { defineHandAuthoredHelperTool } from '../definition-factory.js'

const knowledgeMetadataTagSchema = z.string().min(1)
const knowledgeSourcePathSchema = z.string().min(1)
const knowledgeSlugSchema = z.string().min(1)

export function createAssistantKnowledgeReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.list',
      description:
        'List derived knowledge pages from Murph\'s non-canonical local wiki, optionally filtered by page type or status.',
      inputSchema: z.object({
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        pageType: 'concept',
      },
      execute: async ({ pageType, status }) =>
        await listKnowledgePages({
          vault: input.vault,
          pageType,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.search',
      description:
        'Search the derived knowledge wiki by lexical match across titles, summaries, narrative body text, related slugs, and source paths.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        query: 'sleep magnesium',
        limit: 5,
      },
      execute: async ({ limit, pageType, query, status }) =>
        await searchKnowledgePages({
          vault: input.vault,
          query,
          limit,
          pageType,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.get',
      description:
        'Show one derived knowledge page by slug, including the normalized markdown and canonical metadata.',
      inputSchema: z.object({
        slug: knowledgeSlugSchema,
      }),
      inputExample: {
        slug: 'sleep-quality',
      },
      execute: async ({ slug }) =>
        await getKnowledgePage({
          vault: input.vault,
          slug,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.lint',
      description:
        'Run deterministic structural checks over derived knowledge pages, including parse failures, duplicate slugs, missing sources, broken related links, and invalid bank/library references.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await lintKnowledgePages({
          vault: input.vault,
        }),
    }),
  ]
}

export function createAssistantKnowledgeWriteToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.upsert',
      description:
        'Persist one assistant-authored derived knowledge page, normalize its frontmatter and generated sections, and rebuild the derived knowledge index.',
      inputSchema: z.object({
        body: z.string().min(1),
        title: z.string().min(1).optional(),
        slug: knowledgeSlugSchema.optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
        clearLibrarySlugs: z.boolean().optional(),
        librarySlugs: z.array(knowledgeSlugSchema).optional(),
        sourcePaths: z.array(knowledgeSourcePathSchema).optional(),
        relatedSlugs: z.array(knowledgeSlugSchema).optional(),
      }),
      inputExample: {
        title: 'Sleep quality',
        body: '# Sleep quality\n\nMagnesium may help sleep continuity.\n',
        librarySlugs: ['sleep-architecture'],
        sourcePaths: ['research/2026/04/sleep-note.md'],
      },
      execute: async ({
        body,
        clearLibrarySlugs,
        librarySlugs,
        pageType,
        relatedSlugs,
        slug,
        sourcePaths,
        status,
        title,
      }) =>
        await upsertKnowledgePage({
          vault: input.vault,
          body,
          title,
          clearLibrarySlugs,
          slug,
          pageType,
          librarySlugs,
          relatedSlugs,
          sourcePaths,
          status,
        }),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.knowledge.rebuildIndex',
      description:
        'Rebuild the derived knowledge index markdown from the current saved pages.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await rebuildKnowledgeIndex({
          vault: input.vault,
        }),
    }),
  ]
}
