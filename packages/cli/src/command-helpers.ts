import { z } from 'incur'
import {
  baseCommandOptionsSchema,
  type BaseCommandOptions,
} from './vault-cli-contracts.js'
import {
  type WrappedCommandSpec,
  wrapCommand,
} from './root-middleware.js'

export const emptyArgsSchema = z.object({})

type ObjectSchema = z.ZodObject<z.ZodRawShape>

export function withBaseOptions<TShape extends z.ZodRawShape>(
  shape: TShape = {} as TShape,
) {
  return baseCommandOptionsSchema.extend(shape)
}

export function defineCommand<
  TArgsSchema extends ObjectSchema,
  TOptionsSchema extends ObjectSchema,
  TDataSchema extends z.ZodType<unknown>,
>(
  spec: WrappedCommandSpec<TArgsSchema, TOptionsSchema, TDataSchema>,
) {
  return wrapCommand(spec)
}

export type CommonCommandOptions = BaseCommandOptions
