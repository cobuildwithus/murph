import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/assistant-core/command-helpers'
import {
  pathSchema,
  slugSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import {
  knowledgeCompileResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeSearchResultSchema,
  knowledgeShowResultSchema,
} from '../knowledge-cli-contracts.js'
import {
  compileKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  showKnowledgePage,
} from '../knowledge-runtime.js'
import { researchExecutionModeValues } from '../research-cli-contracts.js'

export function registerKnowledgeCommands(cli: Cli.Cli) {
  const knowledge = Cli.create('knowledge', {
    description:
      'Compile and inspect Murph\'s non-canonical derived knowledge wiki under derived/knowledge/**.',
  })

  knowledge.command('compile', {
    description:
      'Use review:gpt to compile or refresh one derived knowledge page from local vault sources and rebuild the knowledge index.',
    args: z.object({
      prompt: z
        .string()
        .min(1)
        .describe('What the knowledge page should explain, synthesize, or update.'),
    }),
    options: withBaseOptions({
      title: z
        .string()
        .min(1)
        .optional()
        .describe('Optional page title override.'),
      slug: slugSchema
        .optional()
        .describe('Optional stable page slug. Defaults to a slugified title/prompt.'),
      pageType: z
        .string()
        .min(1)
        .optional()
        .describe('Optional freeform page type such as concept, pattern, or protocol.'),
      status: z
        .string()
        .min(1)
        .optional()
        .describe('Optional page status such as active, draft, or archived.'),
      sourcePath: z
        .array(pathSchema)
        .optional()
        .describe('Optional vault-relative or absolute source file paths. Repeat --source-path to include multiple files.'),
      mode: z
        .enum(researchExecutionModeValues)
        .optional()
        .describe('Model mode. Defaults to gpt-pro for local synthesis; use deep-research when you want a slower current-evidence scan.'),
      chat: z
        .string()
        .min(1)
        .optional()
        .describe('Optional ChatGPT chat URL or id to target instead of opening a fresh thread.'),
      browserPath: z
        .string()
        .min(1)
        .optional()
        .describe('Optional Chromium-compatible browser binary override for review:gpt.'),
      timeout: z
        .string()
        .min(1)
        .optional()
        .describe('Optional overall browser automation timeout such as 10m or 40m.'),
      waitTimeout: z
        .string()
        .min(1)
        .optional()
        .describe('Optional assistant-response timeout override. Usually leave this unset.'),
    }),
    output: knowledgeCompileResultSchema,
    async run({ args, options }) {
      return await compileKnowledgePage({
        vault: options.vault,
        prompt: args.prompt,
        title: options.title,
        slug: options.slug,
        pageType: options.pageType,
        status: options.status,
        sourcePaths: options.sourcePath,
        mode: options.mode,
        chat: options.chat,
        browserPath: options.browserPath,
        timeout: options.timeout,
        waitTimeout: options.waitTimeout,
      })
    },
  })

  knowledge.command('list', {
    description: 'List derived knowledge pages currently compiled under derived/knowledge/pages/**.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      pageType: z
        .string()
        .min(1)
        .optional()
        .describe('Optional page-type filter.'),
      status: z
        .string()
        .min(1)
        .optional()
        .describe('Optional status filter.'),
    }),
    output: knowledgeListResultSchema,
    async run({ options }) {
      return await listKnowledgePages({
        vault: options.vault,
        pageType: options.pageType,
        status: options.status,
      })
    },
  })

  knowledge.command('search', {
    description:
      'Search derived knowledge pages by lexical match across titles, summaries, body text, related slugs, and source paths.',
    args: z.object({
      query: z
        .string()
        .min(1)
        .describe('Search query for the compiled knowledge wiki.'),
    }),
    options: withBaseOptions({
      pageType: z
        .string()
        .min(1)
        .optional()
        .describe('Optional page-type filter.'),
      status: z
        .string()
        .min(1)
        .optional()
        .describe('Optional status filter.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Optional result limit. Defaults to 20 and is capped at 200.'),
    }),
    output: knowledgeSearchResultSchema,
    async run({ args, options }) {
      return await searchKnowledgePages({
        vault: options.vault,
        query: args.query,
        limit: options.limit,
        pageType: options.pageType,
        status: options.status,
      })
    },
  })

  knowledge.command('show', {
    description: 'Show one derived knowledge page by slug.',
    args: z.object({
      slug: slugSchema.describe('Knowledge page slug to inspect.'),
    }),
    options: withBaseOptions(),
    output: knowledgeShowResultSchema,
    async run({ args, options }) {
      return await showKnowledgePage({
        vault: options.vault,
        slug: args.slug,
      })
    },
  })

  knowledge.command('lint', {
    description:
      'Run deterministic health checks over derived knowledge pages: missing sources, missing related pages, parse failures, and other structural problems.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: knowledgeLintResultSchema,
    async run({ options }) {
      return await lintKnowledgePages({
        vault: options.vault,
      })
    },
  })

  const index = Cli.create('index', {
    description: 'Rebuild the derived knowledge markdown index.',
  })

  index.command('rebuild', {
    description: 'Rebuild derived/knowledge/index.md from the current knowledge pages.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: knowledgeIndexRebuildResultSchema,
    async run({ options }) {
      return await rebuildKnowledgeIndex({
        vault: options.vault,
      })
    },
  })

  knowledge.command(index)
  cli.command(knowledge)
}
