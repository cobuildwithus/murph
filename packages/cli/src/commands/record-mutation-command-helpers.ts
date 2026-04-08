import { z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import {
  deleteResultSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'

interface EntityCommandArgConfig {
  name: string
  schema: z.ZodType<string>
}

interface EntityEditCommandInput {
  vault: string
  requestId: string | null
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
}

export interface EventBackedEntityEditCommandInput
  extends EntityEditCommandInput {
  dayKeyPolicy?: 'keep' | 'recompute'
}

interface EntityDeleteCommandInput {
  vault: string
  requestId: string | null
  lookup: string
}

interface EntityEditCommandConfig<TResult, TInput extends EntityEditCommandInput = EntityEditCommandInput> {
  arg: EntityCommandArgConfig
  description: string
  hint?: string
  examples?: Array<Record<string, unknown>>
  output?: z.ZodType<TResult>
  options?: Record<string, z.ZodTypeAny>
  buildInput?: (
    input: EntityEditCommandInput,
    options: Record<string, unknown>,
  ) => TInput
  run(input: TInput): Promise<TResult>
}

interface EntityDeleteCommandConfig<TResult> {
  arg: EntityCommandArgConfig
  description: string
  hint?: string
  examples?: Array<Record<string, unknown>>
  output?: z.ZodType<TResult>
  run(input: EntityDeleteCommandInput): Promise<TResult>
}

const pathAssignmentSchema = z
  .string()
  .min(1)
  .describe('Path assignment in dotted.path=value form. Repeat --set for multiple fields.')

const clearPathSchema = z
  .string()
  .min(1)
  .describe('Dotted path to clear from the saved record. Repeat --clear for multiple fields.')

export const dayKeyPolicySchema = z
  .enum(['keep', 'recompute'])
  .describe(
    'Required for event-backed edits when occurredAt or timeZone changes and dayKey is not patched directly. `keep` preserves the saved dayKey; `recompute` drops it so core recalculates from the explicit event timeZone.',
  )

const EVENT_BACKED_DAY_KEY_POLICY_HINT =
  'When you change occurredAt or timeZone without patching dayKey directly, you must also pass --day-key-policy keep or --day-key-policy recompute so the saved local day stays explicit.'

export function createEntityEditCommandConfig<TResult, TInput extends EntityEditCommandInput = EntityEditCommandInput>(
  config: EntityEditCommandConfig<TResult, TInput>,
) {
  return {
    name: 'edit',
    args: z.object({
      [config.arg.name]: config.arg.schema,
    }),
    description: config.description,
    hint:
      config.hint ??
      'Pass --input @patch.json for a structured partial patch, use repeated --set dotted.path=value assignments for quick fixes, or use --clear dotted.path to remove fields.',
    examples: config.examples,
    options: {
      input: inputFileOptionSchema
        .optional()
        .describe('Optional partial JSON patch in @file.json form or - for stdin.'),
      set: z.array(pathAssignmentSchema).optional(),
      clear: z.array(clearPathSchema).optional(),
      ...(config.options ?? {}),
    },
    output: (config.output ?? showResultSchema) as z.ZodType<TResult>,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
        input?: string
        set?: string[]
        clear?: string[]
        dayKeyPolicy?: string
      }
      requestId: string | null
    }) {
      const input = buildEntityEditCommandInput({
        lookup: String(context.args[config.arg.name] ?? ''),
        options: context.options,
        requestId: context.requestId,
      })

      return config.run(
        config.buildInput
          ? config.buildInput(input, context.options as Record<string, unknown>)
          : (input as TInput),
      )
    },
  }
}

export function createEventBackedEntityEditCommandConfig<TResult>(
  config: Omit<
    EntityEditCommandConfig<TResult, EventBackedEntityEditCommandInput>,
    'buildInput' | 'hint' | 'options'
  > & {
    hint?: string
    options?: Record<string, z.ZodTypeAny>
  },
) {
  return createEntityEditCommandConfig<TResult, EventBackedEntityEditCommandInput>({
    ...config,
    hint: config.hint ?? EVENT_BACKED_DAY_KEY_POLICY_HINT,
    options: {
      dayKeyPolicy: dayKeyPolicySchema.optional(),
      ...(config.options ?? {}),
    },
    buildInput(input, options) {
      return {
        ...input,
        dayKeyPolicy: normalizeDayKeyPolicy(options.dayKeyPolicy),
      }
    },
  })
}

export function createEntityDeleteCommandConfig<TResult>(
  config: EntityDeleteCommandConfig<TResult>,
) {
  return {
    name: 'delete',
    args: z.object({
      [config.arg.name]: config.arg.schema,
    }),
    description: config.description,
    hint: config.hint,
    examples: config.examples,
    output: (config.output ?? deleteResultSchema) as z.ZodType<TResult>,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
      }
      requestId: string | null
    }) {
      const lookup = String(context.args[config.arg.name] ?? '')

      return config.run({
        vault: context.options.vault,
        requestId: context.requestId,
        lookup,
      })
    },
  }
}

export function createDirectEntityEditCommandDefinition<TResult>(
  config: EntityEditCommandConfig<TResult>,
) {
  const command = createEntityEditCommandConfig(config)

  return {
    args: command.args,
    description: command.description,
    examples: command.examples,
    hint: command.hint,
    options: withBaseOptions(command.options ?? {}),
    output: command.output,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
        requestId?: string
        input?: string
        set?: string[]
        clear?: string[]
        dayKeyPolicy?: 'keep' | 'recompute'
      }
    }) {
      return command.run({
        args: context.args,
        options: context.options,
        requestId: requestIdFromOptions(context.options),
      })
    },
  }
}

export function createDirectEventBackedEntityEditCommandDefinition<TResult>(
  config: Omit<
    EntityEditCommandConfig<TResult, EventBackedEntityEditCommandInput>,
    'buildInput' | 'hint' | 'options'
  > & {
    hint?: string
    options?: Record<string, z.ZodTypeAny>
  },
) {
  const command = createEventBackedEntityEditCommandConfig(config)

  return {
    args: command.args,
    description: command.description,
    examples: command.examples,
    hint: command.hint,
    options: withBaseOptions(command.options ?? {}),
    output: command.output,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
        requestId?: string
        input?: string
        set?: string[]
        clear?: string[]
        dayKeyPolicy?: 'keep' | 'recompute'
      }
    }) {
      return command.run({
        args: context.args,
        options: context.options,
        requestId: requestIdFromOptions(context.options),
      })
    },
  }
}

export function createDirectEntityDeleteCommandDefinition<TResult>(
  config: EntityDeleteCommandConfig<TResult>,
) {
  const command = createEntityDeleteCommandConfig(config)

  return {
    args: command.args,
    description: command.description,
    examples: command.examples,
    hint: command.hint,
    options: withBaseOptions(),
    output: command.output,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
        requestId?: string
      }
    }) {
      return command.run({
        args: context.args,
        options: context.options,
        requestId: requestIdFromOptions(context.options),
      })
    },
  }
}

function buildEntityEditCommandInput(input: {
  lookup: string
  options: {
    vault: string
    input?: string
    set?: string[]
    clear?: string[]
  }
  requestId: string | null
}): EntityEditCommandInput {
  return {
    vault: input.options.vault,
    requestId: input.requestId,
    lookup: input.lookup,
    inputFile: normalizeEditInputFile(input.options.input),
    set: normalizeStringListOption(input.options.set),
    clear: normalizeStringListOption(input.options.clear),
  }
}

function normalizeEditInputFile(value: unknown): string | undefined {
  return typeof value === 'string' ? normalizeInputFileOption(value) : undefined
}

function normalizeStringListOption(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined
}

function normalizeDayKeyPolicy(
  value: unknown,
): EventBackedEntityEditCommandInput['dayKeyPolicy'] {
  return value === 'keep' || value === 'recompute' ? value : undefined
}
