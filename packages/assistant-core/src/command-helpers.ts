import { z } from 'zod'
import {
  baseCommandOptionsSchema,
  type BaseCommandOptions,
} from './vault-cli-contracts.js'
import { VaultCliError } from './vault-cli-errors.js'

export const emptyArgsSchema = z.object({})
export const ROOT_OPTIONS_WITH_VALUES = new Set([
  '--filter-output',
  '--format',
  '--token-limit',
  '--token-offset',
])

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

export function parseHeadersJsonOption(value?: string) {
  if (!value) {
    return undefined
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new VaultCliError(
      'invalid_payload',
      'headersJson must be a valid JSON object.',
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VaultCliError(
      'invalid_payload',
      'headersJson must be a JSON object with string values.',
    )
  }

  const headers: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(parsed)) {
    if (typeof candidate !== 'string') {
      throw new VaultCliError(
        'invalid_payload',
        'headersJson must be a JSON object with string values.',
      )
    }
    headers[key] = candidate
  }

  return headers
}

export function resolveEffectiveTopLevelToken(
  args: readonly string[],
): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      continue
    }

    if (token === '--') {
      return (args[index + 1] as string | undefined) ?? null
    }

    if (!token.startsWith('-')) {
      return token
    }

    if (ROOT_OPTIONS_WITH_VALUES.has(token)) {
      index += 1
    }
  }

  return null
}

export function firstString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

export type CommonCommandOptions = BaseCommandOptions
