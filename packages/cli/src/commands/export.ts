import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  exportPackResultSchema,
  isoTimestampSchema,
  localDateSchema,
  pathSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-inbox/vault-services'
import {
  exportPackManifestSchema,
  listStoredExportPacks,
  materializeStoredExportPack,
  pruneStoredExportPack,
  showStoredExportPack,
} from './export-intake-read-helpers.js'

const exportPackIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]+$/u,
    'Expected a materialized export pack id using letters, numbers, underscores, or dashes.',
  )
  .describe('Materialized export pack id under exports/packs/<packId>.')

const exportPackShowResultSchema = z.object({
  vault: pathSchema,
  packId: z.string().min(1),
  basePath: pathSchema,
  manifestFile: pathSchema,
  generatedAt: isoTimestampSchema,
  filters: z.object({
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    experiment: slugSchema.nullable(),
  }),
  counts: z.object({
    records: z.number().int().nonnegative(),
    questions: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }),
  files: z.array(
    z.object({
      path: pathSchema,
      mediaType: z.string().min(1),
      role: z.string().min(1).nullable(),
    }),
  ),
  manifest: exportPackManifestSchema,
})

const exportPackListItemSchema = z.object({
  packId: z.string().min(1),
  manifestFile: pathSchema,
  generatedAt: isoTimestampSchema,
  from: localDateSchema.nullable(),
  to: localDateSchema.nullable(),
  experiment: slugSchema.nullable(),
  recordCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
})

const exportPackListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    experiment: slugSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(exportPackListItemSchema),
})

const exportPackMaterializeResultSchema = z.object({
  vault: pathSchema,
  packId: z.string().min(1),
  manifestFile: pathSchema,
  outDir: pathSchema,
  rebuilt: z.boolean(),
  files: z.array(pathSchema),
})

const exportPackPruneResultSchema = z.object({
  vault: pathSchema,
  packId: z.string().min(1),
  packDirectory: pathSchema,
  fileCount: z.number().int().nonnegative(),
  pruned: z.literal(true),
})

export function registerExportCommands(cli: Cli.Cli, services: VaultServices) {
  const exportCli = Cli.create('export', {
    description: 'Export commands routed through the query layer.',
  })

  const packCli = Cli.create('pack', {
    description: 'Build and inspect derived export packs.',
  })

  packCli.command('create', {
    description: 'Build a date-bounded export pack from the read model.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      from: localDateSchema.describe('Inclusive start date for the pack.'),
      to: localDateSchema.describe('Inclusive end date for the pack.'),
      experiment: slugSchema
        .optional()
        .describe('Optional experiment slug filter.'),
      out: pathSchema
        .optional()
        .describe('Optional directory for materialized pack output.'),
    }),
    output: exportPackResultSchema,
    async run({ options }) {
      return services.query.exportPack({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        from: options.from,
        to: options.to,
        experiment: options.experiment,
        out: options.out,
      })
    },
  })

  packCli.command('show', {
    description: 'Show one stored export pack manifest by pack id.',
    args: z.object({
      id: exportPackIdSchema,
    }),
    options: withBaseOptions(),
    output: exportPackShowResultSchema,
    async run({ args, options }) {
      return showStoredExportPack(options.vault, args.id)
    },
  })

  packCli.command('list', {
    description: 'List stored export packs from exports/packs with optional scope filters.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      from: localDateSchema
        .optional()
        .describe('Optional inclusive start date filter against the stored pack scope.'),
      to: localDateSchema
        .optional()
        .describe('Optional inclusive end date filter against the stored pack scope.'),
      experiment: slugSchema
        .optional()
        .describe('Optional experiment slug filter against the stored pack scope.'),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: exportPackListResultSchema,
    async run({ options }) {
      const items = await listStoredExportPacks(options.vault, {
        from: options.from,
        to: options.to,
        experiment: options.experiment,
        limit: options.limit,
      })

      return {
        vault: options.vault,
        filters: {
          from: options.from ?? null,
          to: options.to ?? null,
          experiment: options.experiment ?? null,
          limit: options.limit,
        },
        items,
      }
    },
  })

  packCli.command('materialize', {
    description: 'Copy one stored export pack to the selected output root.',
    args: z.object({
      id: exportPackIdSchema,
    }),
    options: withBaseOptions({
      out: pathSchema
        .optional()
        .describe('Optional output root. Defaults to the selected vault root.'),
    }),
    output: exportPackMaterializeResultSchema,
    async run({ args, options }) {
      return materializeStoredExportPack({
        vault: options.vault,
        packId: args.id,
        out: options.out,
      })
    },
  })

  packCli.command('prune', {
    description: 'Remove one stored export pack directory from exports/packs.',
    args: z.object({
      id: exportPackIdSchema,
    }),
    options: withBaseOptions(),
    output: exportPackPruneResultSchema,
    async run({ args, options }) {
      return pruneStoredExportPack(options.vault, args.id)
    },
  })

  exportCli.command(packCli)
  cli.command(exportCli)
}
