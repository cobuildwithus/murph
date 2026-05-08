import { z } from 'incur'
import { eventSourceSchema } from '@murphai/contracts'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  occurredAtOptionSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  deleteResultSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

interface EntityCommandArgConfig {
  name: string
  schema: z.ZodType<string>
}

interface EntityEditCommandInput {
  vault: string
  requestId: string | null
  lookup: string
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
  ) => TInput | Promise<TInput>
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

export const dayKeyPolicySchema = z
  .enum(['keep', 'recompute'])
  .describe(
    'Required for event-backed edits when occurredAt or timeZone changes and dayKey is not patched directly. `keep` preserves the saved dayKey; `recompute` drops it so core recalculates from the explicit event timeZone.',
  )

const EVENT_BACKED_DAY_KEY_POLICY_HINT =
  'Use typed fields to edit this event-backed record. When you change occurredAt or timeZone without setting dayKey directly, you must also pass --day-key-policy keep or --day-key-policy recompute so the saved local day stays explicit.'

export const recordTextEditOptionSchema = (max: number, description: string) =>
  z.string().trim().min(1).max(max).optional().describe(description)

export const clearFieldOptionSchema = (description: string) =>
  z.boolean().optional().describe(description)

export const editTagOptionSchema = z
  .array(z.string().trim().min(1).max(160))
  .optional()
  .describe('Replace saved tags. Repeat --tag for multiple values.')

export const eventBackedEditOptionShape = {
  title: recordTextEditOptionSchema(240, 'Replace the saved title.'),
  note: recordTextEditOptionSchema(4000, 'Replace the saved note.'),
  occurredAt: occurredAtOptionSchema
    .optional()
    .describe('Replace the occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('Replace the explicit IANA time zone, such as America/New_York.'),
  dayKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected YYYY-MM-DD.')
    .optional()
    .describe('Set the explicit local day key in YYYY-MM-DD form.'),
  source: eventSourceSchema
    .optional()
    .describe('Replace the event source (`manual`, `import`, `device`, or `derived`).'),
  tag: editTagOptionSchema,
  clearTitle: clearFieldOptionSchema('Clear the saved title.'),
  clearNote: clearFieldOptionSchema('Clear the saved note.'),
  clearTimeZone: clearFieldOptionSchema('Clear the saved explicit time zone.'),
  clearDayKey: clearFieldOptionSchema('Clear the saved day key.'),
  clearSource: clearFieldOptionSchema('Clear the saved source.'),
  clearTags: clearFieldOptionSchema('Clear all saved tags.'),
}

export interface EventBackedTypedEditOptions {
  title?: string
  note?: string
  occurredAt?: string
  timeZone?: string
  dayKey?: string
  source?: string
  tag?: string[]
  clearTitle?: boolean
  clearNote?: boolean
  clearTimeZone?: boolean
  clearDayKey?: boolean
  clearSource?: boolean
  clearTags?: boolean
}

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
      'Use typed fields to edit this record. JSON patch files and dotted path assignment flags are intentionally not exposed on canonical edit commands.',
    examples: config.examples,
    options: config.options ?? {},
    output: (config.output ?? showResultSchema) as z.ZodType<TResult>,
    async run(context: {
      args: Record<string, unknown>
      options: {
        vault: string
        dayKeyPolicy?: string
      }
      requestId: string | null
    }) {
      const input = buildEntityEditCommandInput({
        lookup: String(context.args[config.arg.name] ?? ''),
        options: context.options,
        requestId: context.requestId,
      })

      const builtInput = config.buildInput
        ? await config.buildInput(input, context.options as Record<string, unknown>)
        : (input as TInput)

      return config.run(builtInput)
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
    buildPatch?: (options: Record<string, unknown>) => Pick<EntityEditCommandInput, 'set' | 'clear'>
  },
) {
  return createEntityEditCommandConfig<TResult, EventBackedEntityEditCommandInput>({
    ...config,
    hint: config.hint ?? EVENT_BACKED_DAY_KEY_POLICY_HINT,
    options: {
      ...eventBackedEditOptionShape,
      dayKeyPolicy: dayKeyPolicySchema.optional(),
      ...(config.options ?? {}),
    },
    async buildInput(input, options) {
      const normalizedOptions = { ...options }
      if (typeof options.occurredAt === 'string') {
        normalizedOptions.occurredAt = await normalizeOccurredAtOption({
          vault: input.vault,
          occurredAt: options.occurredAt,
        })
      }

      const patch = buildEventBackedTypedEditPatch(normalizedOptions)
      const extraPatch = config.buildPatch?.(normalizedOptions)
      return {
        ...input,
        set: mergePatchLists(patch.set, extraPatch?.set),
        clear: mergePatchLists(patch.clear, extraPatch?.clear),
        dayKeyPolicy: normalizeDayKeyPolicy(normalizedOptions.dayKeyPolicy),
      }
    },
  })
}

function mergePatchLists(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  return emptyToUndefined([...(left ?? []), ...(right ?? [])])
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
      options: Record<string, unknown>
    }) {
      return command.run({
        args: context.args,
        options: {
          ...context.options,
          vault: String(context.options.vault ?? ''),
        },
        requestId:
          typeof context.options.requestId === 'string'
            ? context.options.requestId
            : null,
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
    buildPatch?: (options: Record<string, unknown>) => Pick<EntityEditCommandInput, 'set' | 'clear'>
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
      options: Record<string, unknown>
    }) {
      return command.run({
        args: context.args,
        options: {
          ...context.options,
          vault: String(context.options.vault ?? ''),
        },
        requestId:
          typeof context.options.requestId === 'string'
            ? context.options.requestId
            : null,
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
  }
  requestId: string | null
}): EntityEditCommandInput {
  return {
    vault: input.options.vault,
    requestId: input.requestId,
    lookup: input.lookup,
  }
}

function normalizeDayKeyPolicy(
  value: unknown,
): EventBackedEntityEditCommandInput['dayKeyPolicy'] {
  return value === 'keep' || value === 'recompute' ? value : undefined
}

export function appendTypedSet(
  target: string[],
  path: string,
  value: unknown,
) {
  if (value === undefined) {
    return
  }

  const encoded = JSON.stringify(value)
  if (encoded !== undefined) {
    target.push(`${path}=${encoded}`)
  }
}

export function appendTypedClear(
  target: string[],
  path: string,
  shouldClear: boolean | undefined,
) {
  if (shouldClear === true) {
    target.push(path)
  }
}

export function emptyToUndefined(values: string[]): string[] | undefined {
  return values.length > 0 ? values : undefined
}

export function buildEventBackedTypedEditPatch(
  options: Record<string, unknown>,
): Pick<EntityEditCommandInput, 'set' | 'clear'> {
  const set: string[] = []
  const clear: string[] = []

  appendTypedSet(set, 'title', stringOption(options.title))
  appendTypedSet(set, 'note', stringOption(options.note))
  appendTypedSet(set, 'occurredAt', stringOption(options.occurredAt))
  appendTypedSet(set, 'timeZone', stringOption(options.timeZone))
  appendTypedSet(set, 'dayKey', stringOption(options.dayKey))
  appendTypedSet(set, 'source', stringOption(options.source))
  appendTypedSet(set, 'tags', stringArrayOption(options.tag))
  appendTypedClear(clear, 'title', booleanOption(options.clearTitle))
  appendTypedClear(clear, 'note', booleanOption(options.clearNote))
  appendTypedClear(clear, 'timeZone', booleanOption(options.clearTimeZone))
  appendTypedClear(clear, 'dayKey', booleanOption(options.clearDayKey))
  appendTypedClear(clear, 'source', booleanOption(options.clearSource))
  appendTypedClear(clear, 'tags', booleanOption(options.clearTags))

  return {
    set: emptyToUndefined(set),
    clear: emptyToUndefined(clear),
  }
}

export function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function numberOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function booleanOption(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function stringArrayOption(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
    ? value
    : undefined
}
