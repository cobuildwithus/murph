import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/assistant-core/command-helpers'
import {
  isoTimestampSchema,
  localDateSchema,
  pathSchema,
  timeZoneSchema,
  vaultInitResultSchema,
  vaultValidateResultSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import type { VaultServices } from '@murphai/assistant-core/vault-services'

const unknownRecordSchema = z.record(z.string(), z.unknown())

const vaultShowResultSchema = z.object({
  vault: pathSchema,
  schemaVersion: z.string().min(1).nullable(),
  vaultId: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  timezone: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema.nullable(),
  corePath: pathSchema.nullable(),
  coreTitle: z.string().min(1).nullable(),
  coreUpdatedAt: isoTimestampSchema.nullable(),
})

const vaultPathsResultSchema = z.object({
  vault: pathSchema,
  paths: unknownRecordSchema.nullable(),
  shards: unknownRecordSchema.nullable(),
})

const vaultStatsResultSchema = z.object({
  vault: pathSchema,
  counts: z.object({
    totalRecords: z.number().int().nonnegative(),
    experiments: z.number().int().nonnegative(),
    journalEntries: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    samples: z.number().int().nonnegative(),
    audits: z.number().int().nonnegative(),
    assessments: z.number().int().nonnegative(),
    profileSnapshots: z.number().int().nonnegative(),
    goals: z.number().int().nonnegative(),
    conditions: z.number().int().nonnegative(),
    allergies: z.number().int().nonnegative(),
    protocols: z.number().int().nonnegative(),
    history: z.number().int().nonnegative(),
    familyMembers: z.number().int().nonnegative(),
    geneticVariants: z.number().int().nonnegative(),
  }),
  latest: z.object({
    eventOccurredAt: isoTimestampSchema.nullable(),
    sampleOccurredAt: isoTimestampSchema.nullable(),
    journalDate: localDateSchema.nullable(),
    experimentTitle: z.string().min(1).nullable(),
  }),
})

const vaultUpdateResultSchema = z.object({
  vault: pathSchema,
  metadataFile: pathSchema,
  corePath: pathSchema,
  title: z.string().min(1),
  timezone: z.string().min(1),
  updatedAt: isoTimestampSchema,
  updated: z.boolean(),
})

const vaultRepairResultSchema = z.object({
  vault: pathSchema,
  metadataFile: pathSchema,
  title: z.string().min(1),
  timezone: z.string().min(1),
  repairedFields: z.array(z.string().min(1)),
  createdDirectories: z.array(pathSchema),
  updated: z.boolean(),
  auditPath: pathSchema.nullable(),
})

export function registerVaultCommands(cli: Cli.Cli, services: VaultServices) {
  cli.command(
    'init',
    {
      description: 'Create the baseline vault layout through the core write path.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        timezone: timeZoneSchema.optional().describe('Optional IANA timezone for the new vault. Defaults to the local system timezone.'),
      }),
      output: vaultInitResultSchema,
      async run({ options }) {
        return services.core.init({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          timezone: options.timezone,
        })
      },
    },
  )

  cli.command(
    'validate',
    {
      description: 'Validate the vault through the core read/validation path.',
      args: emptyArgsSchema,
      options: withBaseOptions(),
      output: vaultValidateResultSchema,
      async run({ options }) {
        return services.core.validate({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  const vaultGroup = Cli.create('vault', {
    description: 'Vault metadata, summary, and update commands.',
  })

  vaultGroup.command('show', {
    description: 'Show stable vault metadata plus the current CORE.md summary.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: vaultShowResultSchema,
    async run({ options }) {
      return services.query.showVault({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  vaultGroup.command('paths', {
    description: 'Show the path and shard layout advertised by vault metadata.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: vaultPathsResultSchema,
    async run({ options }) {
      return services.query.showVaultPaths({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  vaultGroup.command('stats', {
    description: 'Summarize record-family counts from the current query read model.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: vaultStatsResultSchema,
    async run({ options }) {
      return services.query.showVaultStats({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  vaultGroup.command('update', {
    description: 'Update stable vault metadata fields such as title and timezone.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      title: z.string().min(1).optional().describe('Optional new vault title.'),
      timezone: timeZoneSchema.optional().describe('Optional new vault timezone.'),
    }),
    output: vaultUpdateResultSchema,
    async run({ options }) {
      return services.core.updateVault({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        title: options.title,
        timezone: options.timezone,
      })
    },
  })

  vaultGroup.command('repair', {
    description:
      'Repair additive vault metadata and scaffold drift so older vaults can adopt newer contract fields without manual edits.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: vaultRepairResultSchema,
    async run({ options }) {
      return services.core.repairVault({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  cli.command(vaultGroup)
}
