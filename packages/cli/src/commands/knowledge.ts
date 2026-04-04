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

export function registerKnowledgeCommands(cli: Cli.Cli) {
  const knowledge = Cli.create('knowledge', {
    description:
      'Compile and inspect Murph\'s non-canonical derived knowledge wiki under derived/knowledge/**.',
  })

  knowledge.command('compile', {
    description:
      'Persist one assistant-authored derived knowledge page from local vault context and rebuild the knowledge index.',
    args: z.object({
      prompt: z
        .string()
        .min(1)
        .describe('What the knowledge page should explain, synthesize, or update.'),
    }),
    options: withBaseOptions({
      body: z
        .string()
        .min(1)
        .describe('Assistant-authored markdown body for the page. Do not include YAML frontmatter; Murph normalizes the title heading and sources section.'),
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
        .describe('Optional vault-relative paths, or absolute paths that still resolve inside the selected vault. Repeat --source-path to include multiple files. Derived/runtime paths such as derived/** and .runtime/** are rejected.'),
    }),
    output: knowledgeCompileResultSchema,
    run({ args, options }) {
      return compileKnowledgePage({
        vault: options.vault,
        body: options.body,
        prompt: args.prompt,
        title: options.title,
        slug: options.slug,
        pageType: options.pageType,
        status: options.status,
        sourcePaths: options.sourcePath,
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
    run({ options }) {
      return listKnowledgePages({
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
    run({ args, options }) {
      return searchKnowledgePages({
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
    run({ args, options }) {
      return showKnowledgePage({
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
    run({ options }) {
      return lintKnowledgePages({
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
    run({ options }) {
      return rebuildKnowledgeIndex({
        vault: options.vault,
      })
    },
  })

  knowledge.command(index)
  cli.command(knowledge)
}
