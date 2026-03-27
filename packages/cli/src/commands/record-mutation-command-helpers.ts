import { z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '../json-input.js'
import {
  deleteResultSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'

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
  dayKeyPolicy?: 'keep' | 'recompute'
}

interface EntityDeleteCommandInput {
  vault: string
  requestId: string | null
  lookup: string
}

interface EntityEditCommandConfig<TResult> {
  arg: EntityCommandArgConfig
  description: string
  hint?: string
  examples?: Array<Record<string, unknown>>
  output?: z.ZodType<TResult>
  options?: Record<string, z.ZodTypeAny>
  run(input: EntityEditCommandInput): Promise<TResult>
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

export function createEntityEditCommandConfig<TResult>(
  config: EntityEditCommandConfig<TResult>,
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
      const lookup = String(context.args[config.arg.name] ?? '')

      return config.run({
        vault: context.options.vault,
        requestId: context.requestId,
        lookup,
        inputFile:
          typeof context.options.input === 'string'
            ? normalizeInputFileOption(context.options.input)
            : undefined,
        set: Array.isArray(context.options.set)
          ? context.options.set.filter((value): value is string => typeof value === 'string')
          : undefined,
        clear: Array.isArray(context.options.clear)
          ? context.options.clear.filter((value): value is string => typeof value === 'string')
          : undefined,
        dayKeyPolicy:
          context.options.dayKeyPolicy === 'keep' ||
          context.options.dayKeyPolicy === 'recompute'
            ? context.options.dayKeyPolicy
            : undefined,
      })
    },
  }
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
