import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  listResultSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const payloadSchema = z.record(z.string(), z.unknown())

const intakeImportResultSchema = z.object({
  vault: pathSchema,
  sourceFile: pathSchema,
  rawFile: pathSchema,
  assessmentId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
})

const intakeProjectResultSchema = z.object({
  vault: pathSchema,
  assessmentId: z.string().min(1),
  proposal: payloadSchema,
})

interface IntakeServices extends VaultCliServices {
  importers: VaultCliServices['importers'] & {
    importAssessmentResponse(input: {
      file: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof intakeImportResultSchema>>
  }
  core: VaultCliServices['core'] & {
    projectAssessment(input: {
      assessmentId: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof intakeProjectResultSchema>>
  }
}

export function registerIntakeCommands(cli: Cli.Cli, services: VaultCliServices) {
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
      options: withBaseOptions(),
      output: intakeImportResultSchema,
      async run({ args, options }) {
        return healthServices.importers.importAssessmentResponse({
          file: args.file,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  intake.command(
    'show',
    {
      description: 'Show one assessment response through the query layer.',
      args: z.object({
        assessmentId: z
          .string()
          .min(1)
          .describe('Assessment response id to show.'),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.show({
          id: args.assessmentId,
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
        dateFrom: localDateSchema.optional(),
        dateTo: localDateSchema.optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.list({
          kind: 'assessment',
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          cursor: options.cursor,
          limit: options.limit,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  intake.command(
    'project',
    {
      description: 'Project one assessment into noun-specific proposal payloads.',
      args: z.object({
        assessmentId: z
          .string()
          .min(1)
          .describe('Assessment response id to project.'),
      }),
      options: withBaseOptions(),
      output: intakeProjectResultSchema,
      async run({ args, options }) {
        return healthServices.core.projectAssessment({
          assessmentId: args.assessmentId,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(intake)
}
