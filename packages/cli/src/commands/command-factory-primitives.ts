import { Cli, z } from 'incur'
import * as zod from '@murphai/contracts/zod-runtime'
import type { JsonSchema } from '@murphai/contracts'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
  type CommonCommandOptions,
} from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import type {
  CommandContext,
  EntityLookupInput as ShowCommandContext,
  JsonFileInput as UpsertCommandContext,
} from '@murphai/vault-usecases'

const jsonObjectOutputSchema = z.object({}).catchall(z.unknown())

const localDateOptionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected YYYY-MM-DD.')

export const commonListLimitOptionSchema = z
  .number()
  .int()
  .positive()
  .max(200)
  .default(10)
  .describe('Maximum number of results to return.')

export const commonDateRangeOptionDescriptions = {
  from: 'Optional inclusive lower date bound in YYYY-MM-DD form.',
  to: 'Optional inclusive upper date bound in YYYY-MM-DD form.',
} as const

export type CommandExamples = Array<Record<string, unknown>>

export interface SuggestedCommand {
  command: string
  description: string
  args?: Record<string, unknown>
  options?: Record<string, unknown>
}

export function suggestedCommandsCta(commands: SuggestedCommand[]) {
  return {
    commands,
    description: 'Suggested commands:' as const,
  }
}

export interface PayloadSchemaCommandPayload {
  command: string
  lineSchemaName?: string
  mediaType: 'application/json' | 'application/jsonl'
  schema: zod.ZodType
  schemaName?: string
  payloadExamples?: readonly unknown[]
}

export type CommandArgShape = z.ZodRawShape
export type CommandOptionShape = Record<string, z.ZodType<unknown>>
export type FactoryCommandOptions<TOptions extends CommandOptionShape> =
  CommonCommandOptions & z.infer<z.ZodObject<TOptions>>

export interface ListDateOptionConfig {
  description: string
  name: string
}

export interface CommonListOptionNames {
  experiment: string
  from: string
  kind: string
  limit: string
  status: string
  tag: string
  text: string
  to: string
}

export interface CommonListOptionsConfig {
  experiment?: z.ZodType<string | undefined>
  from?: ListDateOptionConfig
  kind?: z.ZodType<string | undefined>
  limit?: z.ZodType<number>
  status?: z.ZodType<string | undefined>
  tag?: z.ZodType<unknown>
  text?: z.ZodType<string | undefined>
  to?: ListDateOptionConfig
}

export interface CommonListOptions {
  experiment?: string
  from?: string
  kind?: string
  limit?: number
  status?: string
  tag?: unknown
  text?: string
  to?: string
}

export interface FactoryCommandConfig<
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
  useBaseOptions?: boolean
  run(input: {
    args: z.infer<z.ZodObject<TArgs>>
    options: FactoryCommandOptions<TOptions>
    requestId: string | null
  }): Promise<TResult>
}

export type AnyFactoryCommandConfig = FactoryCommandConfig<unknown>

export interface FactoryCommandGroupConfig {
  commandName: string
  description: string
  commands: readonly AnyFactoryCommandConfig[]
}

export type NamedArgShape<
  TArgName extends string,
  TArgSchema extends z.ZodType<string>,
> = {
  [TKey in TArgName]: TArgSchema
}

export interface NamedArgCommandConfig<
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

export interface InputFileCommandConfig<TResult> {
  description: string
  examples?: CommandExamples
  hint?: string
  output: z.ZodType<TResult>
  run(input: UpsertCommandContext): Promise<TResult>
}

export interface PayloadSchemaCommandConfig<
  TOptions extends CommandOptionShape = {},
> extends Partial<PayloadSchemaCommandPayload> {
  description?: string
  examples?: CommandExamples
  hint?: string
  options?: TOptions
  resolve?(input: {
    options: FactoryCommandOptions<TOptions>
  }): PayloadSchemaCommandPayload
}

export interface CommonListCommandConfig<
  TResult,
  TInput extends CommandContext & CommonListOptions = CommandContext & CommonListOptions,
> {
  description: string
  examples?: CommandExamples
  hint?: string
  optionNames?: Partial<CommonListOptionNames>
  options?: CommonListOptionsConfig
  extraOptions?: CommandOptionShape
  output: z.ZodType<TResult>
  buildInput?(
    input: CommandContext & CommonListOptions,
    options: Record<string, unknown>,
  ): TInput
  run(input: TInput): Promise<TResult>
}

const defaultCommonListOptionNames: CommonListOptionNames = {
  experiment: 'experiment',
  from: 'from',
  kind: 'kind',
  limit: 'limit',
  status: 'status',
  tag: 'tag',
  text: 'text',
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

  if (config.text) {
    shape[names.text] = config.text
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
    text: optionStringValue(options, names.text),
    to: optionStringValue(options, names.to),
  }
}

export function createNamedArgSchema<
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

export function createNamedArgFactoryCommand<
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

export function createInputFileFactoryCommand<TResult>(
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

export const payloadSchemaEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('murph.payload-schema.v1'),
    command: z.string().min(1),
    mediaType: z.enum(['application/json', 'application/jsonl']),
    schemaName: z.string().min(1).optional(),
    lineSchemaName: z.string().min(1).optional(),
    schema: jsonObjectOutputSchema,
    examples: z.array(z.unknown()),
  })
  .strict()

function toInputJsonSchema(schema: zod.ZodType): JsonSchema {
  return zod.toJSONSchema(schema, { io: 'input' }) as JsonSchema
}

export function createPayloadSchemaCommand<
  TOptions extends CommandOptionShape = {},
>(
  config: PayloadSchemaCommandConfig<TOptions>,
): FactoryCommandConfig<
  z.infer<typeof payloadSchemaEnvelopeSchema>,
  {},
  TOptions
> {
  return {
    name: 'payload-schema',
    args: emptyArgsSchema,
    description:
      config.description ?? `Emit the JSON payload schema for ${config.command}.`,
    examples: config.examples,
    hint:
      config.hint
      ?? 'This describes the file body read by --input @file.json or --input -, not the command options shown by --schema.',
    options: config.options,
    output: payloadSchemaEnvelopeSchema,
    useBaseOptions: false,
    async run({ options }) {
      const payload = config.resolve
        ? config.resolve({ options })
        : {
            command: config.command,
            lineSchemaName: config.lineSchemaName,
            mediaType: config.mediaType,
            payloadExamples: config.payloadExamples,
            schema: config.schema,
            schemaName: config.schemaName,
          }

      if (!payload.command || !payload.mediaType || !payload.schema) {
        throw new Error('Payload schema command is missing its resolved schema payload.')
      }

      return {
        schemaVersion: 'murph.payload-schema.v1',
        command: payload.command,
        mediaType: payload.mediaType,
        ...(payload.schemaName ? { schemaName: payload.schemaName } : {}),
        ...(payload.lineSchemaName ? { lineSchemaName: payload.lineSchemaName } : {}),
        schema: toInputJsonSchema(payload.schema),
        examples: [...(payload.payloadExamples ?? [])],
      }
    },
  }
}

export function createCommonListCommand<
  TResult,
  TInput extends CommandContext & CommonListOptions = CommandContext & CommonListOptions,
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
    options: {
      ...buildCommonListOptionShape(config.options ?? {}, optionNames),
      ...(config.extraOptions ?? {}),
    },
    output: config.output,
    async run({ options, requestId }) {
      return config.run(
        buildInput({
          ...readCommonListOptions(options, optionNames),
          requestId,
          vault: options.vault,
        }, options),
      )
    },
  }
}

export function registerFactoryCommand<
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
    options:
      command.useBaseOptions === false
        ? z.object((command.options ?? {}) as TOptions)
        : withBaseOptions((command.options ?? {}) as TOptions),
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

export function createFactoryCommandGroup(config: FactoryCommandGroupConfig) {
  const group = Cli.create(config.commandName, {
    description: config.description,
  })

  for (const command of config.commands) {
    registerFactoryCommand(group, command)
  }

  return group
}
