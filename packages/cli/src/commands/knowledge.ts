import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  tailKnowledgeLog,
  upsertKnowledgePage,
} from '@murphai/assistant-engine/knowledge'
import {
  pathSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  knowledgeGetResultSchema as knowledgeShowResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeLogTailResultSchema,
  knowledgeSearchResultSchema,
  knowledgeUpsertResultSchema,
} from '@murphai/query'

export function registerKnowledgeCommands(cli: Cli.Cli) {
  const knowledge = Cli.create('knowledge', {
    description:
      'Manage and inspect Murph\'s non-canonical derived knowledge wiki under derived/knowledge/**.',
  })

  knowledge.command('upsert', {
    description:
      'Persist one assistant-authored derived knowledge page from local vault context and rebuild the knowledge index.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      body: z
        .string()
        .min(1)
        .describe('Assistant-authored markdown body for the page. Do not include YAML frontmatter; Murph normalizes the heading plus generated related and sources sections.'),
      title: z
        .string()
        .min(1)
        .optional()
        .describe('Optional page title override.'),
      slug: slugSchema
        .optional()
        .describe('Optional stable page slug. Defaults to a slugified title or H1 heading.'),
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
      clearLibraryLinks: z
        .boolean()
        .optional()
        .describe('Clear any existing `librarySlugs` links before applying this upsert. Use this when a prior stable reference link is stale or should be removed.'),
      relatedSlug: z
        .array(slugSchema)
        .optional()
        .describe('Optional explicit related page slugs. Repeat --related-slug to add more; Murph also derives related slugs from body wikilinks.'),
      librarySlug: z
        .array(slugSchema)
        .optional()
        .describe('Optional stable `bank/library` entity slugs that this personal wiki page builds on. Repeat --library-slug to include multiple reference entities.'),
      sourcePath: z
        .array(pathSchema)
        .optional()
        .describe('Optional vault-relative source file paths, or absolute source file paths that still resolve inside the selected vault. Repeat --source-path to include multiple files. Derived/runtime paths such as derived/** and .runtime/** are rejected.'),
    }),
    output: knowledgeUpsertResultSchema,
    run({ options }) {
      return upsertKnowledgePage({
        vault: options.vault,
        body: options.body,
        title: options.title,
        clearLibrarySlugs: options.clearLibraryLinks,
        slug: options.slug,
        pageType: options.pageType,
        librarySlugs: options.librarySlug,
        relatedSlugs: options.relatedSlug,
        status: options.status,
        sourcePaths: options.sourcePath,
      })
    },
  })

  knowledge.command('list', {
    description: 'List derived knowledge pages currently saved under derived/knowledge/pages/**.',
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
        .describe('Search query for the saved knowledge wiki.'),
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
      return getKnowledgePage({
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

  const log = Cli.create('log', {
    description: 'Inspect the append-only derived knowledge activity log.',
  })

  log.command('tail', {
    description: 'Show the latest derived knowledge write-log entries in descending occurredAt order.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      limit: z.number().int().positive().max(200).default(20),
    }),
    output: knowledgeLogTailResultSchema,
    run({ options }) {
      return tailKnowledgeLog({
        vault: options.vault,
        limit: options.limit,
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

  knowledge.command(log)
  knowledge.command(index)
  cli.command(knowledge)
}
