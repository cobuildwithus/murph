import { z } from 'incur'
import {
  baseCommandOptionsSchema,
  type BaseCommandOptions,
} from './vault-cli-contracts.js'

export const emptyArgsSchema = z.object({})

type BaseCommandOptionShape = typeof baseCommandOptionsSchema.shape

export function withBaseOptions<const TShape extends z.ZodRawShape = {}>(
  shape?: TShape,
): z.ZodObject<BaseCommandOptionShape & TShape> {
  return baseCommandOptionsSchema.extend(
    (shape ?? {}) as TShape,
  ) as z.ZodObject<BaseCommandOptionShape & TShape>
}

export function requestIdFromOptions(
  options: BaseCommandOptions,
): string | null {
  return typeof options.requestId === 'string' ? options.requestId : null
}

export type CommonCommandOptions = BaseCommandOptions
