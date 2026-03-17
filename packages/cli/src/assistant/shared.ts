import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from '../vault-cli-errors.js'

export function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
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

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), {
    recursive: true,
  })

  const tempPath = `${filePath}.${randomUUID().replace(/-/gu, '')}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}
