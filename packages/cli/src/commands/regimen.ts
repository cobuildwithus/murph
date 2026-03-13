import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  createHealthScaffoldResultSchema,
  healthListResultSchema,
  healthShowResultSchema,
} from '../health-cli-descriptors.js'
import { localDateSchema, pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  bindHealthCrudServices,
  createHealthCrudGroup,
  suggestedCommandsCta,
} from './health-command-factory.js'

const scaffoldResultSchema = createHealthScaffoldResultSchema('regimen')

const upsertResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

const stopResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  stoppedOn: localDateSchema.nullable(),
  status: z.string().min(1),
})

export function registerRegimenCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  const regimen = createHealthCrudGroup({
    commandName: 'regimen',
    description: 'Regimen registry commands for the health extension surface.',
    descriptions: {
      list: 'List regimens through the health read model.',
      scaffold: 'Emit a payload template for regimen upserts.',
      show: 'Show one regimen by canonical id or slug.',
      upsert: 'Upsert one regimen from an @file.json payload.',
    },
    listStatusDescription: 'Optional regimen status to filter by.',
    noun: 'regimen',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'regimen.json',
    pluralNoun: 'regimens',
    services: bindHealthCrudServices(services, {
      list: 'listRegimens',
      scaffold: 'scaffoldRegimen',
      show: 'showRegimen',
      upsert: 'upsertRegimen',
    }),
    showId: {
      description: 'Regimen id or slug to show.',
      example: '<regimen-id>',
      fromUpsert(result) {
        return result.regimenId
      },
    },
  })
  regimen.command('stop', {
    args: z.object({
      regimenId: z.string().min(1),
    }),
    description: 'Stop one regimen while preserving its canonical id.',
    examples: [
      {
        args: {
          regimenId: '<regimen-id>',
        },
        description: 'Stop a regimen today.',
        options: {
          vault: './vault',
        },
      },
      {
        args: {
          regimenId: '<regimen-id>',
        },
        description: 'Stop a regimen on a specific calendar day.',
        options: {
          stoppedOn: '2026-03-12',
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical regimen id so the stop event is attached to the existing registry record.',
    options: withBaseOptions({
      stoppedOn: localDateSchema.optional(),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopRegimen({
        regimenId: context.args.regimenId,
        stoppedOn: context.options.stoppedOn,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: 'regimen show',
            args: {
              id: context.args.regimenId,
            },
            description: 'Show the stopped regimen record.',
            options: {
              vault: true,
            },
          },
          {
            command: 'regimen list',
            description: 'List stopped regimens.',
            options: {
              status: 'stopped',
              vault: true,
            },
          },
        ]),
      })
    },
  })

  cli.command(regimen)
}
