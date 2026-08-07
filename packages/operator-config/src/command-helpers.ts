import * as z from '@murphai/contracts/zod-runtime'
import {
  baseCommandOptionsSchema,
  type BaseCommandOptions,
} from './vault-cli-contracts.js'

export const emptyArgsSchema = z.object({})
export const ROOT_OPTIONS_WITH_VALUES = new Set([
  '--config',
  '--filter-output',
  '--format',
  '--token-limit',
  '--token-offset',
])

export function resolveRootOptionTokenWithValue(
  token: string,
): string | null {
  const optionToken = token.split('=', 1)[0] ?? token
  return ROOT_OPTIONS_WITH_VALUES.has(optionToken) ? optionToken : null
}

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

const httpUrlInvalidMessage =
  'Expected an http or https URL without embedded credentials.'
const httpBaseUrlInvalidMessage =
  'Expected an http or https base URL without embedded credentials, query parameters, or fragments.'

export function normalizeHttpUrlOption(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return null
  }

  return trimmed
}

export function normalizeHttpBaseUrlOption(value: string): string | null {
  const normalized = normalizeHttpUrlOption(value)
  if (!normalized) {
    return null
  }

  const parsed = new URL(normalized)
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    return null
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
  return parsed.toString().replace(/\/$/u, '')
}

export const httpUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim() && normalizeHttpUrlOption(value) !== null, {
    message: httpUrlInvalidMessage,
  })

export const httpBaseUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim() && normalizeHttpBaseUrlOption(value) !== null, {
    message: httpBaseUrlInvalidMessage,
  })

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

    if (resolveRootOptionTokenWithValue(token) !== null && !token.includes('=')) {
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
