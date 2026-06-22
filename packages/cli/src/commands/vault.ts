import { AsyncLocalStorage } from 'node:async_hooks'
import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  isoTimestampSchema,
  localDateSchema,
  pathSchema,
  timeZoneSchema,
  vaultInitResultSchema,
  vaultValidateResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { VaultServices } from '@murphai/vault-usecases'
import { assertInitializedVaultRoot } from './vault-root-validation.js'

const vaultShowResultSchema = z.object({
  vault: pathSchema,
  formatVersion: z.number().int().nonnegative().nullable(),
  vaultId: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  timezone: z.string().min(1).nullable(),
  createdAt: isoTimestampSchema.nullable(),
  corePath: pathSchema.nullable(),
  coreTitle: z.string().min(1).nullable(),
  coreUpdatedAt: isoTimestampSchema.nullable(),
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
    goals: z.number().int().nonnegative(),
    conditions: z.number().int().nonnegative(),
    allergies: z.number().int().nonnegative(),
    protocols: z.number().int().nonnegative(),
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
  createdDirectories: z.array(pathSchema),
  updated: z.boolean(),
  auditPath: pathSchema.nullable(),
})

const vaultCommandArgvStorage = new AsyncLocalStorage<readonly string[]>()
const vaultCommandArgvInstalled = new WeakSet<Cli.Cli>()

const wearableStorageRepairResultSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  hasWork: z.boolean(),
  suspectedBytes: z.number().int().nonnegative(),
  legacyReceiptPayloadCount: z.number().int().nonnegative(),
  legacyCanonicalArtifactCount: z.number().int().nonnegative(),
  denseProviderSampleShardCount: z.number().int().nonnegative(),
  denseProviderRawTimeseriesCount: z.number().int().nonnegative(),
  retentionEligibleDenseProviderRawTimeseriesBytes: z.number().int().nonnegative(),
  retentionEligibleDenseProviderRawTimeseriesCount: z.number().int().nonnegative(),
  mutated: z.boolean(),
  hasMore: z.boolean(),
  bytesBefore: z.number().int().nonnegative(),
  bytesAfter: z.number().int().nonnegative(),
  bytesFreed: z.number().int().nonnegative(),
  compactedReceiptCount: z.number().int().nonnegative(),
  denseRawBytesAfter: z.number().int().nonnegative(),
  denseRawBytesBefore: z.number().int().nonnegative(),
  denseRawBytesFreed: z.number().int().nonnegative(),
  tombstonedCanonicalArtifactCount: z.number().int().nonnegative(),
  tombstonedDenseRawArtifactCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  touchedPathCount: z.number().int().nonnegative(),
})

const junctionWorkoutHeartRateZoneRepairResultSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  hasWork: z.boolean(),
  mutated: z.boolean(),
  scannedEventCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  unverifiedCandidateCount: z.number().int().nonnegative(),
  repairedCount: z.number().int().nonnegative(),
  touchedPathCount: z.number().int().nonnegative(),
  auditPath: pathSchema.nullable(),
})

const integrationIngestRepairResultSchema = z.object({
  mode: z.enum(['dry-run', 'apply']),
  storedFormatVersion: z.number().int().nonnegative(),
  hasWork: z.boolean(),
  hasMore: z.boolean(),
  candidateBundleCount: z.number().int().nonnegative(),
  copiedBundleCount: z.number().int().nonnegative(),
  detachedBundleCount: z.number().int().nonnegative(),
  deletableFileCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  journalBytes: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  blockersByCode: z.record(z.string(), z.number().int().nonnegative()),
  blockerExamples: z.array(z.object({
    code: z.string().min(1),
    relativePath: pathSchema.optional(),
    message: z.string().min(1),
  })),
  mutated: z.boolean(),
  appendedBundleCount: z.number().int().nonnegative(),
  detachedEventRowCount: z.number().int().nonnegative(),
  deletedFileCount: z.number().int().nonnegative(),
  finalized: z.boolean(),
  auditPaths: z.array(pathSchema),
})

function installVaultCommandArgvContext(cli: Cli.Cli): void {
  if (vaultCommandArgvInstalled.has(cli)) {
    return
  }

  const serve = cli.serve.bind(cli)
  cli.serve = async (argv = process.argv.slice(2), options = {}) =>
    vaultCommandArgvStorage.run([...argv], () => serve(argv, options))
  vaultCommandArgvInstalled.add(cli)
}

function currentCommandIncludesFlag(flag: string): boolean {
  return vaultCommandArgvStorage.getStore()?.some((token) =>
    token === flag || token.startsWith(`${flag}=`)
  ) === true
}

export function registerVaultCommands(cli: Cli.Cli, services: VaultServices) {
  installVaultCommandArgvContext(cli)

  cli.command(
    'init',
    {
      description: 'Create the current vault layout through the core write path.',
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
      await assertInitializedVaultRoot(options.vault)
      return services.query.showVault({
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
      await assertInitializedVaultRoot(options.vault)
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
      'Repair missing required directories on current-format vaults. Older formatVersion vaults fail closed and are not auto-migrated.',
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

  vaultGroup.command('repair-wearable-storage', {
    description:
      'Dry-run or apply the provider-agnostic wearable storage repair for dense device telemetry and derived raw artifacts.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      dryRun: z.boolean().default(false).describe('Show candidates without mutating the vault. This is also the default when --apply is omitted.'),
      apply: z.boolean().default(false).describe('Apply one bounded repair pass.'),
      pruneDenseRaw: z.boolean().default(false).describe('Also tombstone proven dense raw provider timeseries artifacts.'),
      includeRecentDenseRaw: z.boolean().default(false).describe('Allow dense raw provider timeseries newer than the default retention window to be tombstoned.'),
      maxFiles: z.number().int().positive().max(250).optional().describe('Maximum candidate files to mutate in one apply pass.'),
      maxBytes: z.number().int().positive().optional().describe('Maximum candidate bytes to mutate in one apply pass.'),
    }),
    output: wearableStorageRepairResultSchema,
    async run({ options }) {
      const applyWasExplicit = currentCommandIncludesFlag('--apply')
      const pruneDenseRawWasExplicit = currentCommandIncludesFlag('--prune-dense-raw')
      const includeRecentDenseRawWasExplicit = currentCommandIncludesFlag('--include-recent-dense-raw')

      if (options.apply && !applyWasExplicit) {
        throw new VaultCliError(
          'invalid_options',
          'Wearable storage repair apply mode must be requested with --apply on the command line.',
        )
      }
      if (options.pruneDenseRaw && !pruneDenseRawWasExplicit) {
        throw new VaultCliError(
          'invalid_options',
          'Dense raw timeseries pruning must be requested with --prune-dense-raw on the command line.',
        )
      }
      if (options.includeRecentDenseRaw && !includeRecentDenseRawWasExplicit) {
        throw new VaultCliError(
          'invalid_options',
          'Recent dense raw timeseries pruning must be requested with --include-recent-dense-raw on the command line.',
        )
      }
      if (options.includeRecentDenseRaw && !options.pruneDenseRaw) {
        throw new VaultCliError(
          'invalid_options',
          'Recent dense raw timeseries pruning requires --prune-dense-raw.',
        )
      }
      if (options.apply && options.dryRun) {
        throw new VaultCliError(
          'invalid_options',
          'Use either --apply or --dry-run for wearable storage repair, not both.',
        )
      }

      await assertInitializedVaultRoot(options.vault)
      return services.core.repairWearableStorage({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        apply: options.apply,
        pruneDenseRaw: options.pruneDenseRaw,
        includeRecentDenseRaw: options.includeRecentDenseRaw,
        maxFiles: options.maxFiles,
        maxBytes: options.maxBytes,
      })
    },
  })

  vaultGroup.command('repair-junction-hr-zones', {
    description:
      'Dry-run or apply the Junction workout heart-rate zone index repair for legacy numeric 1..6 bucket imports.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      dryRun: z.boolean().default(false).describe('Show matching workout records without mutating the vault. This is also the default when --apply is omitted.'),
      apply: z.boolean().default(false).describe('Append corrected event revisions for matching workout records.'),
    }),
    output: junctionWorkoutHeartRateZoneRepairResultSchema,
    async run({ options }) {
      const applyWasExplicit = currentCommandIncludesFlag('--apply')

      if (options.apply && !applyWasExplicit) {
        throw new VaultCliError(
          'invalid_options',
          'Junction heart-rate zone repair apply mode must be requested with --apply on the command line.',
        )
      }
      if (options.apply && options.dryRun) {
        throw new VaultCliError(
          'invalid_options',
          'Use either --apply or --dry-run for Junction heart-rate zone repair, not both.',
        )
      }

      await assertInitializedVaultRoot(options.vault)
      return services.core.repairJunctionWorkoutHeartRateZones({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        apply: options.apply,
      })
    },
  })

  vaultGroup.command('repair-integration-ingests', {
    description:
      'Dry-run or apply the v1-to-v2 integration ingest journal migration for legacy device raw bundles.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      dryRun: z.boolean().default(false).describe('Show migration work without mutating the vault. This is also the default when --apply is omitted.'),
      apply: z.boolean().default(false).describe('Apply one bounded migration pass.'),
      finalize: z.boolean().default(true).describe('Advance the vault to the current format after all legacy work is gone. Pass --no-finalize to stage multiple apply passes.'),
      maxBundles: z.number().int().positive().max(250).optional().describe('Maximum legacy integration bundles to process in one apply pass.'),
      maxBytes: z.number().int().positive().optional().describe('Maximum legacy source bytes to inspect in one pass.'),
    }),
    output: integrationIngestRepairResultSchema,
    async run({ options }) {
      const applyWasExplicit = currentCommandIncludesFlag('--apply')

      if (options.apply && !applyWasExplicit) {
        throw new VaultCliError(
          'invalid_options',
          'Integration ingest migration apply mode must be requested with --apply on the command line.',
        )
      }
      if (options.apply && options.dryRun) {
        throw new VaultCliError(
          'invalid_options',
          'Use either --apply or --dry-run for integration ingest migration, not both.',
        )
      }

      await assertInitializedVaultRoot(options.vault)
      return services.core.repairIntegrationIngests({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        apply: options.apply,
        finalize: options.finalize,
        maxBundles: options.maxBundles,
        maxBytes: options.maxBytes,
      })
    },
  })

  cli.command(vaultGroup)
}
