import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import type {
  CommandContext,
  EntityLookupInput as ShowCommandContext,
  HealthListInput as ListCommandContext,
  JsonFileInput as UpsertCommandContext,
} from '@murphai/vault-usecases'
import {
  type CommandExamples,
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
  createCommonListCommand,
  registerFactoryCommand,
  suggestedCommandsCta,
} from './command-factory-primitives.js'
const statusOptionSchema = z.string().min(1).optional()

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

export type HealthCrudListFilterCapability = 'date-range' | 'kind' | 'status'

type CrudCommandName = keyof CrudDescriptions
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
  listFilterCapabilities?: readonly HealthCrudListFilterCapability[]
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

type MethodName<TService, TInput> = {
  [TKey in keyof TService]: TService[TKey] extends ServiceMethod<TInput, unknown>
    ? TKey
    : never
}[keyof TService]

type MethodResult<TService, TKey extends keyof TService> =
  TService[TKey] extends ServiceMethod<unknown, infer TResult> ? TResult : never

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

interface CrudPresentationContext {
  groupName: string
  noun: string
  payloadFile: string
  pluralNoun: string
  showId: {
    example: string
  }
}

const defaultExamplesByCommand: Record<
  CrudCommandName,
  (config: CrudPresentationContext) => CommandExamples
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
  Record<CrudCommandName, (config: CrudPresentationContext) => string>
> = {
  list() {
    return 'Use --limit to cap results.'
  },
  scaffold(config) {
    return `Edit the emitted payload, save it as ${config.payloadFile}, then pass it back with --input @${config.payloadFile} or pipe it to --input -. The scaffold output is the current canonical field shape for this command.`
  },
  upsert(config) {
    return `--input accepts @file.json or - so the CLI can load the structured ${config.noun} payload from disk or stdin. Run ${config.groupName} scaffold first if you need the current canonical field shape.`
  },
}

function examplesFor<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
>(
  config: HealthCrudConfig<TScaffold, TUpsert, TShow, TList>,
  command: CrudCommandName,
) {
  return config.examples?.[command] ?? defaultExamplesByCommand[command](config)
}

function hintFor<
  TScaffold,
  TUpsert extends object,
  TShow,
  TList,
>(
  config: HealthCrudConfig<TScaffold, TUpsert, TShow, TList>,
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

function createCrudScaffoldCta(
  config: Pick<
    HealthCrudConfig<unknown, object, unknown, unknown>,
    'groupName' | 'noun' | 'payloadFile'
  >,
) {
  return suggestedCommandsCta([
    {
      command: `${config.groupName} upsert`,
      description: `Apply the edited ${config.noun} payload.`,
      options: {
        input: `@${config.payloadFile}`,
        vault: true,
      },
    },
  ])
}

function createCrudUpsertCta<TUpsert extends object>(
  config: Pick<
    HealthCrudConfig<unknown, TUpsert, unknown, unknown>,
    'groupName' | 'noun' | 'pluralNoun' | 'showId'
  >,
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
    args: emptyArgsSchema,
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
        cta: createCrudScaffoldCta(config),
      })
    },
  })

  config.group.command('upsert', {
    args: emptyArgsSchema,
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
        cta: createCrudUpsertCta(config, result),
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

  registerFactoryCommand(
    config.group,
    createCommonListCommand({
      description: config.descriptions.list,
      examples: examplesFor(config, 'list'),
      hint: hintFor(config, 'list'),
      options: {
        from: config.listFilterCapabilities?.includes('date-range')
          ? {
              description: commonDateRangeOptionDescriptions.from,
              name: 'from',
            }
          : undefined,
        kind: config.listFilterCapabilities?.includes('kind')
          ? z
              .string()
              .min(1)
              .optional()
              .describe(
                'Optional event kind filter such as encounter, procedure, test, adverse_effect, or exposure.',
              )
          : undefined,
        limit: commonListLimitOptionSchema,
        status: config.listStatusDescription
          ? statusOptionSchema.describe(config.listStatusDescription)
          : undefined,
        to: config.listFilterCapabilities?.includes('date-range')
          ? {
              description: commonDateRangeOptionDescriptions.to,
              name: 'to',
            }
          : undefined,
      },
      output: config.outputs.list,
      run(input) {
        return config.services.list(input)
      },
    }),
  )
}
