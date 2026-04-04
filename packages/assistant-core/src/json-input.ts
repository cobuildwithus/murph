import { readFile } from 'node:fs/promises'
import type { JsonObject } from '@murphai/contracts'
import { z } from 'zod'
import { VaultCliError } from './vault-cli-errors.js'

export const inputFileOptionSchema = z
  .string()
  .refine(
    (value) => value === '-' || /^@.+/u.test(value),
    'Expected an @file.json payload reference or - for stdin.',
  )
  .describe('Payload input in @file.json form or - for stdin.')

export const textInputOptionSchema = z
  .string()
  .refine(
    (value) => value === '-' || /^@.+/u.test(value),
    'Expected an @file payload reference or - for stdin.',
  )
  .describe('Payload input in @file form or - for stdin.')

export function normalizeInputFileOption(input: string) {
  if (input === '-' || !input.startsWith('@')) {
    return input
  }

  return input.slice(1)
}

export async function loadJsonInputObject(
  input: string,
  label: string,
): Promise<JsonObject> {
  const raw = await loadTextInput(input, label, {
    stdinHint: 'Pass --input @file.json or pipe a JSON object to --input -.',
  })

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new VaultCliError(
      'invalid_payload',
      `${label} must contain valid JSON.`,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new VaultCliError(
      'invalid_payload',
      `${label} must contain a JSON object.`,
    )
  }

  return parsed as JsonObject
}

export async function loadTextInput(
  input: string,
  label: string,
  options?: {
    stdinHint?: string
  },
) {
  if (input === '-') {
    return readStdinText(label, options)
  }

  const filePath = normalizeInputFileOption(input)

  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    throw new VaultCliError(
      'command_failed',
      `Failed to read ${label} file.`,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
}

async function readStdinText(
  label: string,
  options?: {
    stdinHint?: string
  },
) {
  if (process.stdin.isTTY) {
    throw missingStdinError(label, options)
  }

  const chunks: Buffer[] = []

  try {
    for await (const chunk of process.stdin) {
      chunks.push(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
      )
    }
  } catch (error) {
    throw new VaultCliError(
      'command_failed',
      `Failed to read ${label} from stdin.`,
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }

  const raw = Buffer.concat(chunks).toString('utf8')

  if (raw.trim().length === 0) {
    throw missingStdinError(label, options)
  }

  return raw
}

function missingStdinError(
  label: string,
  options?: {
    stdinHint?: string
  },
) {
  return new VaultCliError(
    'command_failed',
    `No ${label} was piped to stdin.`,
    {
      hint: options?.stdinHint ?? 'Pass --input @file or pipe text to --input -.',
    },
  )
}
