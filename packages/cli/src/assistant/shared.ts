import {
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
