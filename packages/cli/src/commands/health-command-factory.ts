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

type CrudCommandName = keyof CrudDescriptions
type CommandExamples = Array<Record<string, unknown>>
type ServiceMethod<TInput, TResult> = (input: TInput) => Promise<TResult>

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

interface HealthCrudGroupConfig<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
> extends Omit<HealthCrudConfig<TScaffold, TUpsert, TShow, TList>, 'group' | 'groupName'> {
  commandName: string
  description: string
}

type HealthCrudConfigAny = HealthCrudConfig<any, any, any, any>

type MethodName<TService, TInput> = {
  [TKey in keyof TService]: TService[TKey] extends ServiceMethod<TInput, any>
    ? TKey
    : never
}[keyof TService]

type MethodResult<TService, TKey extends keyof TService> =
  TService[TKey] extends ServiceMethod<any, infer TResult> ? TResult : never

interface CrudServiceMethodNames<
  TCore extends object,
  TQuery extends object,
  TScaffoldName extends keyof TCore,
  TUpsertName extends keyof TCore,
  TShowName extends keyof TQuery,
  TListName extends keyof TQuery,
> {
  list: TListName
  scaffold: TScaffoldName
  show: TShowName
  upsert: TUpsertName
}

interface SuggestedCommand {
  command: string
  description: string
  args?: Record<string, unknown>
  options?: Record<string, unknown>
}

const defaultExamplesByCommand: Record<
  CrudCommandName,
  (config: HealthCrudConfigAny) => CommandExamples
> = {
  list(config) {
    return [
      {
        description: `List ${config.pluralNoun} with a smaller page size.`,
        options: {
          limit: 10,
          vault: './vault',
        },
      },
    ]
  },
  scaffold(config) {
    return [
      {
        description: `Print a template ${config.noun} payload.`,
        options: {
          vault: './vault',
        },
      },
    ]
  },
  show(config) {
    return [
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
  },
  upsert(config) {
    return [
      {
        description: `Upsert one ${config.noun} from a JSON payload file.`,
        options: {
          input: `@${config.payloadFile}`,
          vault: './vault',
        },
      },
    ]
  },
}

const defaultHintsByCommand: Partial<
  Record<CrudCommandName, (config: HealthCrudConfigAny) => string>
> = {
  list() {
    return 'Use --limit to cap results. --cursor is accepted for compatibility but ignored until pagination is implemented.'
  },
  scaffold(config) {
    return `Edit the emitted payload, save it as ${config.payloadFile}, then pass it back with --input @${config.payloadFile}.`
  },
  upsert(config) {
    return `--input expects @file.json so the CLI can load the structured ${config.noun} payload from disk.`
  },
}

function examplesFor(
  config: HealthCrudConfigAny,
  command: CrudCommandName,
) {
  return config.examples?.[command] ?? defaultExamplesByCommand[command](config)
}

function hintFor(
  config: HealthCrudConfigAny,
  command: keyof CrudHints,
) {
  return config.hints?.[command] ?? defaultHintsByCommand[command]?.(config)
}

function bindServiceMethod<
  TService extends object,
  TInput,
  TMethodName extends MethodName<TService, TInput>,
>(
  service: TService,
  methodName: TMethodName,
): ServiceMethod<TInput, MethodResult<TService, TMethodName>> {
  const method = service[methodName] as ServiceMethod<
    TInput,
    MethodResult<TService, TMethodName>
  >
  return method.bind(service)
}

export function bindHealthCrudServices<
  TCore extends object,
  TQuery extends object,
  TScaffoldName extends MethodName<TCore, CommandContext>,
  TUpsertName extends MethodName<TCore, UpsertCommandContext>,
  TShowName extends MethodName<TQuery, ShowCommandContext>,
  TListName extends MethodName<TQuery, ListCommandContext>,
>(
  services: {
    core: TCore
    query: TQuery
  },
  methodNames: CrudServiceMethodNames<
    TCore,
    TQuery,
    TScaffoldName,
    TUpsertName,
    TShowName,
    TListName
  >,
): CrudServices<
  MethodResult<TCore, TScaffoldName>,
  MethodResult<TCore, TUpsertName>,
  MethodResult<TQuery, TShowName>,
  MethodResult<TQuery, TListName>
> {
  return {
    list: bindServiceMethod(services.query, methodNames.list),
    scaffold: bindServiceMethod(services.core, methodNames.scaffold),
    show: bindServiceMethod(services.query, methodNames.show),
    upsert: bindServiceMethod(services.core, methodNames.upsert),
  }
}

export function createHealthCrudGroup<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
>(
  config: HealthCrudGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  const group = Cli.create(config.commandName, {
    description: config.description,
  })

  registerHealthCrudCommands({
    ...config,
    group,
    groupName: config.commandName,
  })

  return group
}

export function registerHealthCrudGroup<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
>(
  cli: Cli.Cli,
  config: HealthCrudGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  const group = createHealthCrudGroup(config)
  cli.command(group)
  return group
}

export function suggestedCommandsCta(commands: SuggestedCommand[]) {
  return {
    commands,
    description: 'Suggested commands:' as const,
  }
}

function upsertCta<TUpsert extends object>(
  config: HealthCrudConfig<any, TUpsert, any, any>,
  result: TUpsert,
) {
  return suggestedCommandsCta([
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
  ])
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
    examples: examplesFor(config, 'scaffold'),
    hint: hintFor(config, 'scaffold'),
    options: withBaseOptions(),
    output: config.outputs.scaffold,
    async run(context) {
      const result = await config.services.scaffold({
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: `${config.groupName} upsert`,
            description: `Apply the edited ${config.noun} payload.`,
            options: {
              input: `@${config.payloadFile}`,
              vault: true,
            },
          },
        ]),
      })
    },
  })

  config.group.command('upsert', {
    args: z.object({}),
    description: config.descriptions.upsert,
    examples: examplesFor(config, 'upsert'),
    hint: hintFor(config, 'upsert'),
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
    examples: examplesFor(config, 'show'),
    hint: hintFor(config, 'show'),
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
    examples: examplesFor(config, 'list'),
    hint: hintFor(config, 'list'),
    options: listOptions,
    output: config.outputs.list,
    async run(context) {
      const status =
        'status' in context.options &&
        typeof context.options.status === 'string'
          ? context.options.status
          : undefined

      return config.services.list({
        limit: context.options.limit,
        requestId: requestIdFromOptions(context.options),
        status,
        vault: context.options.vault,
      })
    },
  })
}
