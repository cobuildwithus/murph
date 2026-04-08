import { Cli, z } from 'incur'
import { emptyArgsSchema } from '@murphai/operator-config/command-helpers'
import type {
  CommandContext,
  HealthListInput as ListCommandContext,
} from '@murphai/vault-usecases'
import {
  type AnyFactoryCommandConfig,
  type CommandExamples,
  type CommandOptionShape,
  type FactoryCommandConfig,
  type InputFileCommandConfig,
  type NamedArgCommandConfig,
  createCommonListCommand,
  createFactoryCommandGroup,
  createInputFileFactoryCommand,
  createNamedArgFactoryCommand,
  createNamedArgSchema,
} from './command-factory-primitives.js'

const limitOptionSchema = z.number().int().positive().max(200).default(50)

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
  additionalCommands?: readonly AnyFactoryCommandConfig[]
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
  additionalCommands?: readonly AnyFactoryCommandConfig[]
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
      ...(config.additionalCommands ?? []),
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
      ...(config.additionalCommands ?? []),
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
