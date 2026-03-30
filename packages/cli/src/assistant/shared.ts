import { readFile } from 'node:fs/promises'
import {
  appendTextFileWithMode as appendRuntimeTextFileWithMode,
  auditAssistantStatePermissions as auditRuntimeAssistantStatePermissions,
  ensureAssistantStateDirectory as ensureRuntimeAssistantStateDirectory,
  type AssistantStatePermissionAudit,
  writeJsonFileAtomic as writeRuntimeJsonFileAtomic,
  writeTextFileAtomic as writeRuntimeTextFileAtomic,
} from '@murph/runtime-state'
import {
  errorMessage,
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '../text/shared.js'
import { VaultCliError } from '../vault-cli-errors.js'

export {
  errorMessage,
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '../text/shared.js'

export type { AssistantStatePermissionAudit } from '@murph/runtime-state'

export function readAssistantEnvString(
  env: NodeJS.ProcessEnv | null | undefined,
  key: string | null | undefined,
): string | null {
  const normalizedKey = normalizeNullableString(key)
  if (!normalizedKey) {
    return null
  }

  const value = env?.[normalizedKey]
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

export function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = normalizeNullableString(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'invalid_payload',
    `${fieldName} must be a non-empty string.`,
  )
}

export function resolveTimestamp(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

export function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  )
}

export function isJsonSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError
}

export async function readAssistantJsonFile<T>(input: {
  createDefault?: () => T
  filePath: string
  parse: (value: unknown) => T
}): Promise<{
  present: boolean
  recoveredFromParseError: boolean
  value: T
}> {
  try {
    const raw = await readFile(input.filePath, 'utf8')
    return {
      present: true,
      recoveredFromParseError: false,
      value: input.parse(JSON.parse(raw) as unknown),
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      if (!input.createDefault) {
        throw error
      }
      return {
        present: false,
        recoveredFromParseError: false,
        value: input.createDefault(),
      }
    }
    if (isJsonSyntaxError(error) && input.createDefault) {
      return {
        present: true,
        recoveredFromParseError: true,
        value: input.createDefault(),
      }
    }
    throw error
  }
}

export function parseAssistantJsonLinesWithTailSalvage<T>(
  raw: string,
  parse: (value: unknown) => T,
): {
  malformedLineCount: number
  salvagedTailLineCount: number
  values: T[]
} {
  const lines = raw.split('\n')
  const endsWithNewline = raw.endsWith('\n')
  let lastNonEmptyLineIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim().length) {
      lastNonEmptyLineIndex = index
    }
  }

  const values: T[] = []
  let malformedLineCount = 0
  let salvagedTailLineCount = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }

    try {
      values.push(parse(JSON.parse(line) as unknown))
    } catch (error) {
      const isRecoverableTail =
        index === lastNonEmptyLineIndex &&
        !endsWithNewline &&
        isJsonSyntaxError(error)
      if (isRecoverableTail) {
        salvagedTailLineCount += 1
        continue
      }
      malformedLineCount += 1
    }
  }

  return {
    malformedLineCount,
    salvagedTailLineCount,
    values,
  }
}

export function warnAssistantBestEffortFailure(input: {
  error: unknown
  operation: string
}): void {
  const code =
    input.error &&
    typeof input.error === 'object' &&
    'code' in input.error &&
    typeof (input.error as { code?: unknown }).code === 'string'
      ? (input.error as { code: string }).code
      : null
  const name =
    input.error instanceof Error && input.error.name
      ? input.error.name
      : 'Error'
  const suffix = code ? ` (${name}/${code})` : ` (${name})`
  console.warn(`Assistant best-effort ${input.operation} failed${suffix}.`)
}

export async function ensureAssistantStateDirectory(
  directoryPath: string,
): Promise<void> {
  await ensureRuntimeAssistantStateDirectory(directoryPath)
}

export async function auditAssistantStatePermissions(input: {
  repair?: boolean
  rootPath: string
}): Promise<AssistantStatePermissionAudit> {
  return await auditRuntimeAssistantStatePermissions(input)
}

export async function appendTextFile(
  filePath: string,
  value: string,
): Promise<void> {
  await appendRuntimeTextFileWithMode(filePath, value)
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeRuntimeJsonFileAtomic(filePath, value)
}

export async function writeTextFileAtomic(
  filePath: string,
  value: string,
): Promise<void> {
  await writeRuntimeTextFileAtomic(filePath, value)
}
