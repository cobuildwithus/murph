import { z } from 'incur'
import type {
  FailureEnvelope,
  OutputFormat,
} from './vault-cli-contracts.js'
import {
  baseCommandOptionsSchema,
  failureEnvelopeSchema,
  successEnvelopeSchema,
} from './vault-cli-contracts.js'
import { toVaultCliError } from './vault-cli-errors.js'

export interface CommandRunContext<TArgs, TOptions> {
  args: TArgs
  options: TOptions
  requestId: string | null
  vault: string
  format: OutputFormat
}

type ObjectSchema = z.ZodObject<z.ZodRawShape>

export interface SuccessEnvelopeBase<TData> {
  command: string
  ok: true
  format: OutputFormat
  requestId: string | null
  data: TData
  notes?: string[]
  rendered?: string
}

export interface WrappedCommandSpec<
  TArgsSchema extends ObjectSchema,
  TOptionsSchema extends ObjectSchema,
  TDataSchema extends z.ZodType<unknown>,
> {
  command: string
  description: string
  args?: TArgsSchema
  options: TOptionsSchema
  data: TDataSchema
  examples?: Array<{
    args?: Partial<z.input<TArgsSchema>>
    options?: Partial<z.input<TOptionsSchema>>
    description: string
  }>
  run(
    input: CommandRunContext<z.infer<TArgsSchema>, z.infer<TOptionsSchema>>,
  ): Promise<z.infer<TDataSchema>>
  renderMarkdown?(
    envelope: SuccessEnvelopeBase<z.infer<TDataSchema>>,
  ): string | undefined
}

export interface WrappedCommandDefinition<
  TArgsSchema extends ObjectSchema,
  TOptionsSchema extends ObjectSchema,
  TDataSchema extends z.ZodType<unknown>,
> {
  description: string
  args?: TArgsSchema
  options: TOptionsSchema
  output: z.ZodType<unknown>
  examples?: WrappedCommandSpec<TArgsSchema, TOptionsSchema, TDataSchema>['examples']
  run(
    context: {
      args: z.infer<TArgsSchema>
      options: Record<string, unknown>
    } & Record<string, unknown>,
  ): Promise<SuccessEnvelopeBase<z.infer<TDataSchema>> | FailureEnvelope>
}

export function wrapCommand<
  TArgsSchema extends ObjectSchema,
  TOptionsSchema extends ObjectSchema,
  TDataSchema extends z.ZodType<unknown>,
>(
  spec: WrappedCommandSpec<TArgsSchema, TOptionsSchema, TDataSchema>,
): WrappedCommandDefinition<TArgsSchema, TOptionsSchema, TDataSchema> {
  return {
    description: spec.description,
    args: spec.args,
    options: spec.options,
    output: z.union([successEnvelopeSchema(spec.data), failureEnvelopeSchema]),
    examples: spec.examples,
    async run({
      args,
      options,
    }: {
      args: z.infer<TArgsSchema>
      options: Record<string, unknown>
    } & Record<string, unknown>): Promise<
      SuccessEnvelopeBase<z.infer<TDataSchema>> | FailureEnvelope
    > {
      const parsedOptions = spec.options.parse(options)
      const baseOptions = baseCommandOptionsSchema.parse(parsedOptions)
      const requestId =
        typeof baseOptions.requestId === 'string'
          ? baseOptions.requestId
          : null
      const format: OutputFormat =
        baseOptions.format === 'md' ? 'md' : 'json'

      try {
        const envelope = {
          command: spec.command,
          ok: true as const,
          format,
          requestId,
          data: await spec.run({
            args,
            options: parsedOptions,
            requestId,
            vault: baseOptions.vault,
            format,
          }),
        }

        return {
          ...envelope,
          rendered:
            format === 'md'
              ? spec.renderMarkdown?.(envelope)
              : undefined,
        }
      } catch (error) {
        const normalized = toVaultCliError(error)

        return failureEnvelopeSchema.parse({
          command: spec.command,
          ok: false,
          format,
          requestId,
          error: {
            code: normalized.code,
            message: normalized.message,
            details: normalized.details,
          },
        })
      }
    },
  }
}
