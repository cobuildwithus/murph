import { Cli, z } from "incur"
import { requestIdFromOptions, withBaseOptions } from "../command-helpers.js"
import {
  createHealthScaffoldResultSchema,
  healthListResultSchema,
  healthShowResultSchema,
} from "../health-cli-descriptors.js"
import {
  createRegistryDocEntityGroup,
  suggestedCommandsCta,
} from "./health-command-factory.js"
import { localDateSchema, pathSchema } from "../vault-cli-contracts.js"
import type { VaultServices } from "../vault-services.js"

const limitOptionSchema = z.number().int().positive().max(200).default(50)
const supplementSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
const statusOptionSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Optional supplement status to filter by.')
const compoundStatusOptionSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Optional supplement status to filter by. Defaults to active for compound rollups.')

const supplementUpsertResultSchema = z.object({
  vault: pathSchema,
  protocolId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

const stopResultSchema = z.object({
  vault: pathSchema,
  protocolId: z.string().min(1),
  lookupId: z.string().min(1),
  stoppedOn: localDateSchema.nullable(),
  status: z.string().min(1),
})

const compoundSourceSchema = z.object({
  supplementId: z.string().min(1),
  supplementSlug: z.string().min(1),
  supplementTitle: z.string().nullable(),
  brand: z.string().nullable(),
  manufacturer: z.string().nullable(),
  status: z.string().nullable(),
  label: z.string().nullable(),
  amount: z.number().nonnegative().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
})

const compoundTotalSchema = z.object({
  unit: z.string().nullable(),
  totalAmount: z.number().nonnegative().nullable(),
  sourceCount: z.number().int().nonnegative(),
  incomplete: z.boolean(),
})

const compoundRecordSchema = z.object({
  compound: z.string().min(1),
  lookupId: z.string().min(1),
  totals: z.array(compoundTotalSchema),
  supplementCount: z.number().int().nonnegative(),
  supplementIds: z.array(z.string().min(1)),
  sources: z.array(compoundSourceSchema),
})

const compoundFiltersSchema = z.object({
  status: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
})

const compoundShowResultSchema = z.object({
  vault: pathSchema,
  filters: compoundFiltersSchema,
  compound: compoundRecordSchema,
})

const compoundListResultSchema = z.object({
  vault: pathSchema,
  filters: compoundFiltersSchema,
  items: z.array(compoundRecordSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerSupplementCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const supplement = createRegistryDocEntityGroup({
    commandName: 'supplement',
    description: 'Supplement product commands plus a derived active-compound ledger.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a payload template for one supplement product.',
      examples: [
        {
          description: 'Print a template supplement payload.',
          options: {
            vault: './vault',
          },
        },
      ],
      hint: 'The supplement payload supports product metadata plus an ingredients array for compound rollups.',
      output: createHealthScaffoldResultSchema('supplement'),
      async run({ options, requestId }) {
        return services.core.scaffoldSupplement({
          vault: options.vault,
          requestId,
        })
      },
    },
    upsert: {
      description: 'Upsert one supplement from a JSON payload file or stdin.',
      examples: [
        {
          description: 'Upsert one supplement product from a JSON payload file.',
          options: {
            input: '@supplement.json',
            vault: './vault',
          },
        },
      ],
      hint: '--input accepts @file.json or - so the CLI can load a supplement payload with product metadata and ingredients.',
      output: supplementUpsertResultSchema,
      async run(input) {
        return services.core.upsertSupplement(input)
      },
    },
    show: {
      argName: 'id',
      argSchema: z.string().min(1),
      description: 'Show one supplement by canonical id or slug.',
      examples: [
        {
          args: {
            id: '<supplement-id>',
          },
          description: 'Show one saved supplement product.',
          options: {
            vault: './vault',
          },
        },
      ],
      hint: 'Use the canonical supplement id or the supplement slug.',
      output: healthShowResultSchema,
      async run(input) {
        return services.query.showSupplement(input)
      },
    },
    list: {
      description: 'List supplements through the health read model.',
      examples: [
        {
          description: 'List active supplements with a smaller page size.',
          options: {
            limit: 10,
            status: 'active',
            vault: './vault',
          },
        },
      ],
      hint: 'Use --status active to focus on current supplements or --limit to cap results.',
      output: healthListResultSchema,
      statusOption: statusOptionSchema,
      async run(input) {
        return services.query.listSupplements({
          ...input,
          limit: input.limit ?? 50,
        })
      },
    },
  })

  supplement.command('stop', {
    args: z.object({
      protocolId: z.string().min(1),
    }),
    description: 'Stop one supplement while preserving its canonical id.',
    examples: [
      {
        args: {
          protocolId: '<supplement-id>',
        },
        description: 'Stop a supplement today.',
        options: {
          vault: './vault',
        },
      },
      {
        args: {
          protocolId: '<supplement-id>',
        },
        description: 'Stop a supplement on a specific calendar day.',
        options: {
          stoppedOn: '2026-03-12',
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical supplement id so the stop event is attached to the existing supplement record.',
    options: withBaseOptions({
      stoppedOn: localDateSchema.optional(),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopSupplement({
        protocolId: context.args.protocolId,
        stoppedOn: context.options.stoppedOn,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: 'supplement show',
            args: {
              id: context.args.protocolId,
            },
            description: 'Show the stopped supplement record.',
            options: {
              vault: true,
            },
          },
          {
            command: 'supplement list',
            description: 'List stopped supplements.',
            options: {
              status: 'stopped',
              vault: true,
            },
          },
        ]),
      })
    },
  })

  supplement.command('rename', {
    args: z.object({
      lookup: z.string().min(1).describe('Supplement id or slug to rename.'),
    }),
    description: 'Rename one supplement product while preserving its canonical id.',
    examples: [
      {
        args: {
          lookup: '<supplement-id>',
        },
        description: 'Rename a supplement and let the slug move with the new title.',
        options: {
          title: 'Morning Protein Drink',
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical supplement id or current slug; the CLI reuses the existing supplement record instead of creating a new one.',
    options: withBaseOptions({
      title: z.string().min(1).max(160).describe('New supplement title.'),
      slug: supplementSlugSchema
        .optional()
        .describe('Optional stable slug override for the renamed supplement record.'),
    }),
    output: supplementUpsertResultSchema,
    async run(context) {
      return services.core.renameSupplement({
        lookup: context.args.lookup,
        title: context.options.title,
        slug: context.options.slug,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  const compound = Cli.create('compound', {
    description: 'Derived canonical ledger of active compounds across supplements.',
  })

  compound.command('list', {
    args: z.object({}),
    description: 'List rolled-up supplement compounds across supplements.',
    examples: [
      {
        description: 'List active compounds from current supplements.',
        options: {
          vault: './vault',
        },
      },
      {
        description: 'List stopped-supplement compounds with a smaller page size.',
        options: {
          limit: 10,
          status: 'stopped',
          vault: './vault',
        },
      },
    ],
    hint: 'The compound ledger defaults to active supplements so overlapping ingredients sum into a single canonical row.',
    options: withBaseOptions({
      limit: limitOptionSchema,
      status: compoundStatusOptionSchema,
    }),
    output: compoundListResultSchema,
    async run(context) {
      return services.query.listSupplementCompounds({
        limit: context.options.limit,
        status: context.options.status,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  compound.command('show', {
    args: z.object({
      compound: z.string().min(1),
    }),
    description: 'Show one rolled-up supplement compound by name or lookup id.',
    examples: [
      {
        args: {
          compound: 'vitamin-c',
        },
        description: 'Show one rolled-up compound by lookup id.',
        options: {
          vault: './vault',
        },
      },
      {
        args: {
          compound: 'Magnesium',
        },
        description: 'Show one rolled-up compound by display name.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint: 'Lookup ids are kebab-cased compound names derived from the canonical compound field.',
    options: withBaseOptions({
      status: compoundStatusOptionSchema,
    }),
    output: compoundShowResultSchema,
    async run(context) {
      return services.query.showSupplementCompound({
        compound: context.args.compound,
        status: context.options.status,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  supplement.command(compound)
  cli.command(supplement)
}
