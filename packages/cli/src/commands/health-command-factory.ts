import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
  type CommonCommandOptions,
} from '../command-helpers.js'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '../json-input.js'
export { healthPayloadSchema } from '../health-cli-descriptors.js'
export { inputFileOptionSchema, normalizeInputFileOption } from '../json-input.js'

const limitOptionSchema = z.number().int().positive().max(200).default(50)
const localDateOptionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected YYYY-MM-DD.')
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
  from?: string
  to?: string
  kind?: string
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

export type HealthCrudListFilterCapability = 'date-range' | 'kind' | 'status'

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

interface SuggestedCommand {
  command: string
  description: string
  args?: Record<string, unknown>
  options?: Record<string, unknown>
}

interface CrudPresentationContext {
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
    return `Edit the emitted payload, save it as ${config.payloadFile}, then pass it back with --input @${config.payloadFile} or pipe it to --input -.`
  },
  upsert(config) {
    return `--input accepts @file.json or - so the CLI can load the structured ${config.noun} payload from disk or stdin.`
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

export function suggestedCommandsCta(commands: SuggestedCommand[]) {
  return {
    commands,
    description: 'Suggested commands:' as const,
  }
}

type CommandArgShape = z.ZodRawShape
type CommandOptionShape = Record<string, z.ZodType<unknown>>
type FactoryCommandOptions<TOptions extends CommandOptionShape> =
  CommonCommandOptions & z.infer<z.ZodObject<TOptions>>

interface ListDateOptionConfig {
  description: string
  name: string
}

interface CommonListOptionNames {
  experiment: string
  from: string
  kind: string
  limit: string
  status: string
  tag: string
  to: string
}

interface CommonListOptionsConfig {
  experiment?: z.ZodType<string | undefined>
  from?: ListDateOptionConfig
  kind?: z.ZodType<string | undefined>
  limit?: z.ZodType<number>
  status?: z.ZodType<string | undefined>
  tag?: z.ZodType<unknown>
  to?: ListDateOptionConfig
}

interface CommonListOptions {
  experiment?: string
  from?: string
  kind?: string
  limit?: number
  status?: string
  tag?: unknown
  to?: string
}

interface FactoryCommandConfig<
  TResult,
  TArgs extends CommandArgShape = CommandArgShape,
  TOptions extends CommandOptionShape = CommandOptionShape,
> {
  name: string
  args: z.ZodObject<TArgs>
  description: string
  examples?: CommandExamples
  hint?: string
  options?: TOptions
  output: z.ZodType<TResult>
  run(input: {
    args: z.infer<z.ZodObject<TArgs>>
    options: FactoryCommandOptions<TOptions>
    requestId: string | null
  }): Promise<TResult>
}

type AnyFactoryCommandConfig = FactoryCommandConfig<unknown>

interface FactoryCommandGroupConfig {
  commandName: string
  description: string
  commands: readonly AnyFactoryCommandConfig[]
}

type NamedArgShape<
  TArgName extends string,
  TArgSchema extends z.ZodType<string>,
> = {
  [TKey in TArgName]: TArgSchema
}

interface NamedArgCommandConfig<
  TResult,
  TArgName extends string = string,
> {
  description: string
  argName: TArgName
  argSchema: z.ZodType<string>
  examples?: CommandExamples
  hint?: string
  output: z.ZodType<TResult>
  run(input: ShowCommandContext): Promise<TResult>
}

interface InputFileCommandConfig<TResult> {
  description: string
  examples?: CommandExamples
  hint?: string
  output: z.ZodType<TResult>
  run(input: UpsertCommandContext): Promise<TResult>
}

interface CommonListCommandConfig<
  TResult,
  TInput extends CommandContext,
> {
  description: string
  examples?: CommandExamples
  hint?: string
  optionNames?: Partial<CommonListOptionNames>
  options?: CommonListOptionsConfig
  output: z.ZodType<TResult>
  buildInput?(input: CommandContext & CommonListOptions): TInput
  run(input: TInput): Promise<TResult>
}

interface RegistryDocEntityGroupConfig<
  TScaffold,
  TUpsert,
  TShow,
  TList,
> {
  commandName: string
  description: string
  scaffold: FactoryCommandConfig<TScaffold>
  upsert: InputFileCommandConfig<TUpsert>
  show: NamedArgCommandConfig<TShow>
  list: {
    description: string
    examples?: CommandExamples
    hint?: string
    output: z.ZodType<TList>
    statusOption?: z.ZodType<string | undefined>
    run(input: ListCommandContext): Promise<TList>
  }
}

interface LedgerEventListCommandContext extends ListCommandContext {
  experiment?: string
  tag?: unknown
}

interface LedgerEventEntityGroupConfig<
  TScaffold,
  TUpsert,
  TShow,
  TList,
> {
  commandName: string
  description: string
  scaffold: {
    description: string
    examples?: CommandExamples
    hint?: string
    kindOption: z.ZodType<string>
    output: z.ZodType<TScaffold>
    run(input: CommandContext & { kind: string }): Promise<TScaffold>
  }
  upsert: InputFileCommandConfig<TUpsert>
  show: NamedArgCommandConfig<TShow>
  list: {
    description: string
    examples?: CommandExamples
    hint?: string
    experimentOption?: z.ZodType<string | undefined>
    kindOption?: z.ZodType<string | undefined>
    output: z.ZodType<TList>
    tagOption?: z.ZodType<unknown>
    run(input: LedgerEventListCommandContext): Promise<TList>
  }
}

interface ArtifactListOptionNames {
  from: string
  to: string
}

interface ArtifactBackedEntityGroupConfig<
  TPrimary,
  TShow,
  TList,
  TManifest,
> {
  commandName: string
  description: string
  primaryAction: FactoryCommandConfig<TPrimary>
  show: NamedArgCommandConfig<TShow>
  list: {
    description: string
    examples?: CommandExamples
    hint?: string
    limitOption?: z.ZodType<number>
    optionNames?: ArtifactListOptionNames
    output: z.ZodType<TList>
    run(input: CommandContext & { from?: string; to?: string; limit?: number }): Promise<TList>
  }
  manifest: NamedArgCommandConfig<TManifest>
  additionalCommands?: readonly AnyFactoryCommandConfig[]
}

interface LifecycleEntityGroupConfig<
  TCreate,
  TShow,
  TList,
  TUpdate,
  TCheckpoint,
  TStop,
> {
  commandName: string
  description: string
  create: FactoryCommandConfig<TCreate>
  show: NamedArgCommandConfig<TShow>
  list: {
    description: string
    examples?: CommandExamples
    hint?: string
    output: z.ZodType<TList>
    statusOption?: z.ZodType<string | undefined>
    run(input: ListCommandContext): Promise<TList>
  }
  update: FactoryCommandConfig<TUpdate>
  checkpoint: FactoryCommandConfig<TCheckpoint>
  stop: {
    description: string
    argName: string
    argSchema: z.ZodType<string>
    examples?: CommandExamples
    hint?: string
    options?: CommandOptionShape
    output: z.ZodType<TStop>
    run(input: CommandContext & { id: string } & Record<string, unknown>): Promise<TStop>
  }
}

const defaultCommonListOptionNames: CommonListOptionNames = {
  experiment: 'experiment',
  from: 'from',
  kind: 'kind',
  limit: 'limit',
  status: 'status',
  tag: 'tag',
  to: 'to',
}

function optionStringValue(
  options: Record<string, unknown>,
  key: string,
) {
  return typeof options[key] === 'string' ? options[key] : undefined
}

function optionNumberValue(
  options: Record<string, unknown>,
  key: string,
) {
  return typeof options[key] === 'number' ? options[key] : undefined
}

function buildCommonListOptionShape(
  config: CommonListOptionsConfig,
  names: CommonListOptionNames,
) {
  const shape: CommandOptionShape = {}

  if (config.status) {
    shape[names.status] = config.status
  }

  if (config.kind) {
    shape[names.kind] = config.kind
  }

  if (config.from) {
    shape[config.from.name] = localDateOptionSchema
      .optional()
      .describe(config.from.description)
  }

  if (config.to) {
    shape[config.to.name] = localDateOptionSchema
      .optional()
      .describe(config.to.description)
  }

  if (config.tag) {
    shape[names.tag] = config.tag
  }

  if (config.experiment) {
    shape[names.experiment] = config.experiment
  }

  if (config.limit) {
    shape[names.limit] = config.limit
  }

  return shape
}

function readCommonListOptions(
  options: Record<string, unknown>,
  names: CommonListOptionNames,
) {
  return {
    experiment: optionStringValue(options, names.experiment),
    from: optionStringValue(options, names.from),
    kind: optionStringValue(options, names.kind),
    limit: optionNumberValue(options, names.limit),
    status: optionStringValue(options, names.status),
    tag: options[names.tag],
    to: optionStringValue(options, names.to),
  }
}

function createNamedArgSchema<
  TArgName extends string,
  TArgSchema extends z.ZodType<string>,
>(
  argName: TArgName,
  argSchema: TArgSchema,
): z.ZodObject<NamedArgShape<TArgName, TArgSchema>> {
  return z.object({
    [argName]: argSchema,
  } as NamedArgShape<TArgName, TArgSchema>)
}

function createNamedArgFactoryCommand<
  TResult,
  TArgName extends string,
>(
  name: string,
  config: NamedArgCommandConfig<TResult, TArgName>,
): FactoryCommandConfig<
  TResult,
  NamedArgShape<TArgName, z.ZodType<string>>,
  {}
> {
  return {
    name,
    args: createNamedArgSchema(config.argName, config.argSchema),
    description: config.description,
    examples: config.examples,
    hint: config.hint,
    output: config.output,
    async run({ args, options, requestId }) {
      const namedArgs = args as Record<TArgName, string>

      return config.run({
        id: namedArgs[config.argName],
        requestId,
        vault: options.vault,
      })
    },
  }
}

function createInputFileFactoryCommand<TResult>(
  name: string,
  config: InputFileCommandConfig<TResult>,
): FactoryCommandConfig<
  TResult,
  {},
  { input: typeof inputFileOptionSchema }
> {
  return {
    name,
    args: emptyArgsSchema,
    description: config.description,
    examples: config.examples,
    hint: config.hint,
    options: {
      input: inputFileOptionSchema,
    },
    output: config.output,
    async run({ options, requestId }) {
      return config.run({
        input: normalizeInputFileOption(options.input),
        requestId,
        vault: options.vault,
      })
    },
  }
}

function createCommonListCommand<
  TResult,
  TInput extends CommandContext,
>(
  config: CommonListCommandConfig<TResult, TInput>,
): FactoryCommandConfig<TResult> {
  const optionNames = {
    ...defaultCommonListOptionNames,
    ...config.optionNames,
  }
  const buildInput =
    config.buildInput ??
    ((input: CommandContext & CommonListOptions) => input as TInput)

  return {
    name: 'list',
    args: emptyArgsSchema,
    description: config.description,
    examples: config.examples,
    hint: config.hint,
    options: buildCommonListOptionShape(config.options ?? {}, optionNames),
    output: config.output,
    async run({ options, requestId }) {
      return config.run(
        buildInput({
          ...readCommonListOptions(options, optionNames),
          requestId,
          vault: options.vault,
        }),
      )
    },
  }
}

function registerFactoryCommand<
  TResult,
  TArgs extends CommandArgShape,
  TOptions extends CommandOptionShape,
>(
  group: Cli.Cli,
  command: FactoryCommandConfig<TResult, TArgs, TOptions>,
) {
  group.command(command.name, {
    args: command.args,
    description: command.description,
    examples: command.examples,
    hint: command.hint,
    options: withBaseOptions((command.options ?? {}) as TOptions),
    output: command.output,
    async run(context) {
      return command.run({
        args: context.args as z.infer<z.ZodObject<TArgs>>,
        options: context.options as FactoryCommandOptions<TOptions>,
        requestId: requestIdFromOptions(context.options as CommonCommandOptions),
      })
    },
  })
}

function createFactoryCommandGroup(config: FactoryCommandGroupConfig) {
  const group = Cli.create(config.commandName, {
    description: config.description,
  })

  for (const command of config.commands) {
    registerFactoryCommand(group, command)
  }

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
              description: 'Optional inclusive lower date bound in YYYY-MM-DD form.',
              name: 'from',
            }
          : undefined,
        kind: config.listFilterCapabilities?.includes('kind')
          ? z
              .string()
              .min(1)
              .optional()
              .describe(
                'Optional history event kind filter such as encounter, procedure, test, adverse_effect, or exposure.',
              )
          : undefined,
        limit: limitOptionSchema,
        status: config.listStatusDescription
          ? statusOptionSchema.describe(config.listStatusDescription)
          : undefined,
        to: config.listFilterCapabilities?.includes('date-range')
          ? {
              description: 'Optional inclusive upper date bound in YYYY-MM-DD form.',
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

export function createRegistryDocEntityGroup<
  TScaffold,
  TUpsert,
  TShow,
  TList,
>(
  config: RegistryDocEntityGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  return createFactoryCommandGroup({
    commandName: config.commandName,
    description: config.description,
    commands: [
      config.scaffold,
      createInputFileFactoryCommand('upsert', config.upsert),
      createNamedArgFactoryCommand('show', config.show),
      createCommonListCommand({
        description: config.list.description,
        examples: config.list.examples,
        hint: config.list.hint,
        options: {
          limit: limitOptionSchema,
          status: config.list.statusOption,
        },
        output: config.list.output,
        run(input) {
          return config.list.run(input)
        },
      }),
    ],
  })
}

export function registerRegistryDocEntityGroup<
  TScaffold,
  TUpsert,
  TShow,
  TList,
>(
  cli: Cli.Cli,
  config: RegistryDocEntityGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  const group = createRegistryDocEntityGroup(config)
  cli.command(group)
  return group
}

export function createLedgerEventEntityGroup<
  TScaffold,
  TUpsert,
  TShow,
  TList,
>(
  config: LedgerEventEntityGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  return createFactoryCommandGroup({
    commandName: config.commandName,
    description: config.description,
    commands: [
      {
        name: 'scaffold',
        args: emptyArgsSchema,
        description: config.scaffold.description,
        examples: config.scaffold.examples,
        hint: config.scaffold.hint,
        options: {
          kind: config.scaffold.kindOption,
        },
        output: config.scaffold.output,
        async run({ options, requestId }) {
          return config.scaffold.run({
            kind: String(options.kind),
            requestId,
            vault: options.vault,
          })
        },
      },
      createInputFileFactoryCommand('upsert', config.upsert),
      createNamedArgFactoryCommand('show', config.show),
      createCommonListCommand({
        description: config.list.description,
        examples: config.list.examples,
        hint: config.list.hint,
        options: {
          experiment: config.list.experimentOption,
          from: {
            description: 'Optional inclusive lower date bound in YYYY-MM-DD form.',
            name: 'from',
          },
          kind: config.list.kindOption,
          limit: limitOptionSchema,
          tag: config.list.tagOption,
          to: {
            description: 'Optional inclusive upper date bound in YYYY-MM-DD form.',
            name: 'to',
          },
        },
        output: config.list.output,
        run(input) {
          return config.list.run(input)
        },
      }),
    ],
  })
}

export function registerLedgerEventEntityGroup<
  TScaffold,
  TUpsert,
  TShow,
  TList,
>(
  cli: Cli.Cli,
  config: LedgerEventEntityGroupConfig<TScaffold, TUpsert, TShow, TList>,
) {
  const group = createLedgerEventEntityGroup(config)
  cli.command(group)
  return group
}

export function createArtifactBackedEntityGroup<
  TPrimary,
  TShow,
  TList,
  TManifest,
>(
  config: ArtifactBackedEntityGroupConfig<TPrimary, TShow, TList, TManifest>,
) {
  const optionNames = config.list.optionNames ?? {
    from: 'from',
    to: 'to',
  }

  return createFactoryCommandGroup({
    commandName: config.commandName,
    description: config.description,
    commands: [
      config.primaryAction,
      createNamedArgFactoryCommand('show', config.show),
      createCommonListCommand({
        description: config.list.description,
        examples: config.list.examples,
        hint: config.list.hint,
        optionNames,
        options: {
          from: {
            description: 'Optional inclusive start date in YYYY-MM-DD form.',
            name: optionNames.from,
          },
          limit: config.list.limitOption,
          to: {
            description: 'Optional inclusive end date in YYYY-MM-DD form.',
            name: optionNames.to,
          },
        },
        output: config.list.output,
        run(input) {
          return config.list.run(input)
        },
      }),
      createNamedArgFactoryCommand('manifest', config.manifest),
      ...(config.additionalCommands ?? []),
    ],
  })
}

export function registerArtifactBackedEntityGroup<
  TPrimary,
  TShow,
  TList,
  TManifest,
>(
  cli: Cli.Cli,
  config: ArtifactBackedEntityGroupConfig<TPrimary, TShow, TList, TManifest>,
) {
  const group = createArtifactBackedEntityGroup(config)
  cli.command(group)
  return group
}

export function createLifecycleEntityGroup<
  TCreate,
  TShow,
  TList,
  TUpdate,
  TCheckpoint,
  TStop,
>(
  config: LifecycleEntityGroupConfig<
    TCreate,
    TShow,
    TList,
    TUpdate,
    TCheckpoint,
    TStop
  >,
) {
  return createFactoryCommandGroup({
    commandName: config.commandName,
    description: config.description,
    commands: [
      config.create,
      createNamedArgFactoryCommand('show', config.show),
      createCommonListCommand({
        description: config.list.description,
        examples: config.list.examples,
        hint: config.list.hint,
        options: {
          limit: limitOptionSchema,
          status: config.list.statusOption,
        },
        output: config.list.output,
        run(input) {
          return config.list.run(input)
        },
      }),
      config.update,
      config.checkpoint,
      {
        name: 'stop',
        args: createNamedArgSchema(config.stop.argName, config.stop.argSchema),
        description: config.stop.description,
        examples: config.stop.examples,
        hint: config.stop.hint,
        options: config.stop.options,
        output: config.stop.output,
        async run({ args, options, requestId }) {
          return config.stop.run({
            id: String(args[config.stop.argName]),
            requestId,
            vault: options.vault,
            ...(options as Record<string, unknown>),
          })
        },
      },
    ],
  })
}

export function registerLifecycleEntityGroup<
  TCreate,
  TShow,
  TList,
  TUpdate,
  TCheckpoint,
  TStop,
>(
  cli: Cli.Cli,
  config: LifecycleEntityGroupConfig<
    TCreate,
    TShow,
    TList,
    TUpdate,
    TCheckpoint,
    TStop
  >,
) {
  const group = createLifecycleEntityGroup(config)
  cli.command(group)
  return group
}
