import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
export { healthPayloadSchema } from '../health-cli-descriptors.js'

export const inputFileOptionSchema = z
  .string()
  .regex(/^@.+/u, 'Expected an @file.json payload reference.')
  .describe('Payload file reference in @file.json form.')

export function normalizeInputFileOption(input: string) {
  return input.slice(1)
}

const cursorOptionSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Reserved for future pagination support. Accepted for compatibility but ignored today.')
const limitOptionSchema = z.number().int().positive().max(200).default(50)
const statusOptionSchema = z.string().min(1).optional()

interface CommandContext {
  requestId: string | null
  vault: string
}

interface UpsertCommandContext extends CommandContext {
  input: string
}

interface ShowCommandContext extends CommandContext {
  id: string
}

interface ListCommandContext extends CommandContext {
  cursor?: string
  limit?: number
  status?: string
}

interface CrudDescriptions {
  list: string
  scaffold: string
  show: string
  upsert: string
}

interface CrudHints {
  list?: string
  scaffold?: string
  show?: string
  upsert?: string
}

type CommandExamples = Array<Record<string, unknown>>

interface CrudExamples {
  list?: CommandExamples
  scaffold?: CommandExamples
  show?: CommandExamples
  upsert?: CommandExamples
}

interface CrudOutputs<
  TScaffold,
  TUpsert,
  TShow,
  TList,
> {
  list: z.ZodType<TList>
  scaffold: z.ZodType<TScaffold>
  show: z.ZodType<TShow>
  upsert: z.ZodType<TUpsert>
}

interface CrudServices<
  TScaffold,
  TUpsert,
  TShow,
  TList,
> {
  list(input: ListCommandContext): Promise<TList>
  scaffold(input: CommandContext): Promise<TScaffold>
  show(input: ShowCommandContext): Promise<TShow>
  upsert(input: UpsertCommandContext): Promise<TUpsert>
}

interface HealthCrudConfig<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
> {
  descriptions: CrudDescriptions
  examples?: CrudExamples
  group: Cli.Cli
  groupName: string
  hints?: CrudHints
  listStatusDescription?: string
  noun: string
  outputs: CrudOutputs<TScaffold, TUpsert, TShow, TList>
  payloadFile: string
  pluralNoun: string
  services: CrudServices<TScaffold, TUpsert, TShow, TList>
  showId: {
    description: string
    example: string
    fromUpsert(result: TUpsert): string
  }
}

function scaffoldExamples(config: HealthCrudConfig<any, any, any, any>) {
  return config.examples?.scaffold ?? [
    {
      description: `Print a template ${config.noun} payload.`,
      options: {
        vault: './vault',
      },
    },
  ]
}

function upsertExamples(config: HealthCrudConfig<any, any, any, any>) {
  return config.examples?.upsert ?? [
    {
      description: `Upsert one ${config.noun} from a JSON payload file.`,
      options: {
        input: `@${config.payloadFile}`,
        vault: './vault',
      },
    },
  ]
}

function showExamples(config: HealthCrudConfig<any, any, any, any>) {
  return config.examples?.show ?? [
    {
      args: {
        id: config.showId.example,
      },
      description: `Show one ${config.noun}.`,
      options: {
        vault: './vault',
      },
    },
  ]
}

function listExamples(config: HealthCrudConfig<any, any, any, any>) {
  return config.examples?.list ?? [
    {
      description: `List ${config.pluralNoun} with a smaller page size.`,
      options: {
        limit: 10,
        vault: './vault',
      },
    },
  ]
}

function scaffoldHint(config: HealthCrudConfig<any, any, any, any>) {
  return (
    config.hints?.scaffold ??
    `Edit the emitted payload, save it as ${config.payloadFile}, then pass it back with --input @${config.payloadFile}.`
  )
}

function upsertHint(config: HealthCrudConfig<any, any, any, any>) {
  return (
    config.hints?.upsert ??
    `--input expects @file.json so the CLI can load the structured ${config.noun} payload from disk.`
  )
}

function listHint(config: HealthCrudConfig<any, any, any, any>) {
  return (
    config.hints?.list ??
    'Use --limit to cap results. --cursor is accepted for compatibility but ignored until pagination is implemented.'
  )
}

function upsertCta<TUpsert extends object>(
  config: HealthCrudConfig<any, TUpsert, any, any>,
  result: TUpsert,
) {
  return {
    commands: [
      {
        command: `${config.groupName} show`,
        args: {
          id: config.showId.fromUpsert(result),
        },
        description: `Show the saved ${config.noun}.`,
        options: {
          vault: true,
        },
      },
      {
        command: `${config.groupName} list`,
        description: `List ${config.pluralNoun}.`,
        options: {
          vault: true,
        },
      },
    ],
    description: 'Suggested commands:',
  }
}

export function registerHealthCrudCommands<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
>(config: HealthCrudConfig<TScaffold, TUpsert, TShow, TList>) {
  config.group.command('scaffold', {
    args: z.object({}),
    description: config.descriptions.scaffold,
    examples: scaffoldExamples(config),
    hint: scaffoldHint(config),
    options: withBaseOptions(),
    output: config.outputs.scaffold,
    async run(context) {
      const result = await config.services.scaffold({
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })

      return context.ok(result, {
        cta: {
          commands: [
            {
              command: `${config.groupName} upsert`,
              description: `Apply the edited ${config.noun} payload.`,
              options: {
                input: `@${config.payloadFile}`,
                vault: true,
              },
            },
          ],
          description: 'Suggested commands:',
        },
      })
    },
  })

  config.group.command('upsert', {
    args: z.object({}),
    description: config.descriptions.upsert,
    examples: upsertExamples(config),
    hint: upsertHint(config),
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: config.outputs.upsert,
    async run(context) {
      const result = await config.services.upsert({
        input: normalizeInputFileOption(context.options.input),
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })

      return context.ok(result, {
        cta: upsertCta(config, result),
      })
    },
  })

  config.group.command('show', {
    args: z.object({
      id: z.string().min(1).describe(config.showId.description),
    }),
    description: config.descriptions.show,
    examples: showExamples(config),
    hint: config.hints?.show,
    options: withBaseOptions(),
    output: config.outputs.show,
    async run(context) {
      return config.services.show({
        id: context.args.id,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  })

  const listOptions = config.listStatusDescription
    ? withBaseOptions({
        cursor: cursorOptionSchema,
        limit: limitOptionSchema,
        status: statusOptionSchema.describe(config.listStatusDescription),
      })
    : withBaseOptions({
        cursor: cursorOptionSchema,
        limit: limitOptionSchema,
      })

  config.group.command('list', {
    args: z.object({}),
    description: config.descriptions.list,
    examples: listExamples(config),
    hint: listHint(config),
    options: listOptions,
    output: config.outputs.list,
    async run(context) {
      const listInput: ListCommandContext = {
        limit: context.options.limit,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      }

      if ('status' in context.options && typeof context.options.status === 'string') {
        listInput.status = context.options.status
      }

      return config.services.list(listInput)
    },
  })
}
