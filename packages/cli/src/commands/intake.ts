import { rawImportManifestSchema } from '@murph/contracts'
import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '@murph/assistant-core/command-helpers'
import {
  isoTimestampSchema,
  listResultSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from '@murph/assistant-core/vault-cli-contracts'
import { loadImportersRuntimeModule } from '@murph/assistant-core/usecases/runtime'
import type { VaultServices } from '@murph/assistant-core/vault-services'
import {
  showAssessmentManifest,
  showAssessmentRaw,
} from './export-intake-read-helpers.js'

const payloadSchema = z.record(z.string(), z.unknown())
const intakeSourceSchema = z.enum(['import', 'manual', 'derived'])

const intakeImportResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  rawFile: pathSchema,
  manifestFile: pathSchema,
  assessmentId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
})

const intakeProjectResultSchema = z.object({
  vault: pathSchema,
  assessmentId: z.string().min(1),
  proposal: payloadSchema,
})

const intakeManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.literal('assessment'),
  manifestFile: pathSchema,
  manifest: rawImportManifestSchema,
})

const intakeRawResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.literal('assessment'),
  rawFile: pathSchema,
  mediaType: z.literal('application/json'),
  raw: z.unknown(),
})

interface IntakeServices extends VaultServices {
  core: VaultServices['core'] & {
    projectAssessment(input: {
      assessmentId: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof intakeProjectResultSchema>>
  }
}

export function registerIntakeCommands(cli: Cli.Cli, services: VaultServices) {
  const healthServices = services as IntakeServices
  const intake = Cli.create('intake', {
    description: 'Assessment intake commands for health extension workflows.',
  })

  intake.command(
    'import',
    {
      description: 'Import one assessment response payload into the health ledgers.',
      args: z.object({
        file: pathSchema.describe('Path to the assessment response JSON file.'),
      }),
      options: withBaseOptions({
        title: z
          .string()
          .min(1)
          .optional()
          .describe('Optional assessment title stored on the imported record.'),
        occurredAt: isoTimestampSchema
          .optional()
          .describe('Optional occurrence timestamp in ISO 8601 form.'),
        importedAt: isoTimestampSchema
          .optional()
          .describe('Optional import timestamp in ISO 8601 form.'),
        source: intakeSourceSchema
          .optional()
          .describe('Optional source label (`import`, `manual`, or `derived`).'),
      }),
      output: intakeImportResultSchema,
      async run({ args, options }) {
        const importers = (await loadImportersRuntimeModule()).createImporters()
        const result = await importers.importAssessmentResponse({
          filePath: args.file,
          vaultRoot: options.vault,
          title: options.title,
          occurredAt: options.occurredAt,
          importedAt: options.importedAt,
          source: options.source,
          requestId: requestIdFromOptions(options),
        })

        return {
          vault: options.vault,
          sourceFile: args.file,
          rawFile: result.raw.relativePath,
          manifestFile: result.manifestPath,
          assessmentId: result.assessment.id,
          lookupId: result.assessment.id,
          ledgerFile: result.ledgerPath,
        }
      },
    },
  )

  intake.command(
    'show',
    {
      description: 'Show one assessment response through the query layer.',
      args: z.object({
        id: z
          .string()
          .min(1)
          .describe('Assessment response id to show.'),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.show({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  intake.command(
    'list',
    {
      description: 'List assessment responses through the query layer.',
      args: z.object({}),
      options: withBaseOptions({
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.list({
          kind: 'assessment',
          from: options.from,
          to: options.to,
          limit: options.limit,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  intake.command('manifest', {
    description: 'Show the immutable raw import manifest for one assessment.',
    args: z.object({
      id: z
        .string()
        .min(1)
        .describe('Assessment response id to inspect.'),
    }),
    options: withBaseOptions(),
    output: intakeManifestResultSchema,
    async run({ args, options }) {
      return showAssessmentManifest(options.vault, args.id)
    },
  })

  intake.command('raw', {
    description: 'Show the immutable raw assessment payload captured during intake import.',
    args: z.object({
      id: z
        .string()
        .min(1)
        .describe('Assessment response id to inspect.'),
    }),
    options: withBaseOptions(),
    output: intakeRawResultSchema,
    async run({ args, options }) {
      return showAssessmentRaw(options.vault, args.id)
    },
  })

  intake.command(
    'project',
    {
      description: 'Project one assessment into noun-specific proposal payloads.',
      args: z.object({
        id: z
          .string()
          .min(1)
          .describe('Assessment response id to project.'),
      }),
      options: withBaseOptions(),
      output: intakeProjectResultSchema,
      async run({ args, options }) {
        return healthServices.core.projectAssessment({
          assessmentId: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(intake)
}
