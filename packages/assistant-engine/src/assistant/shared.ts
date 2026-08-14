import { readFile } from 'node:fs/promises'
import {
  appendAssistantStateText,
  auditAssistantStatePermissions as auditRuntimeAssistantStatePermissions,
  ensureAssistantStateDir as ensureRuntimeAssistantStateDirectory,
  type AssistantStatePermissionAudit,
  writeAssistantStateJson,
  writeAssistantStateText,
} from '@murphai/runtime-state/node/assistant-state-fs'
import {
  isAssistantStatePath,
  writeJsonFileAtomic as writeRuntimeJsonFileAtomic,
  writeTextFileAtomic as writeRuntimeTextFileAtomic,
} from '@murphai/runtime-state/node'
import {
  errorMessage,
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
export {
  compareIsoTimestampsAscending as compareAssistantTimestampsAscending,
  compareNullableIsoTimestampsAscending as compareAssistantNullableTimestampsAscending,
} from '@murphai/contracts'

export {
  errorMessage,
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '@murphai/operator-config/text/shared'
export {
  isAssistantVercelAIGatewayBaseUrl,
  readAssistantEnvString,
} from '@murphai/operator-config/assistant/shared'

export function normalizeAssistantProviderOptionKey(
  value: string | null | undefined,
): string {
  const normalized = normalizeNullableString(value)
  const source = normalized ?? 'murph-assistant'
  const segments = source
    .split(/[^a-zA-Z0-9]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    return 'murphAssistant'
  }

  const [first, ...rest] = segments
  return [
    first!.charAt(0).toLowerCase() + first!.slice(1),
    ...rest.map((segment) =>
      segment.charAt(0).toUpperCase() + segment.slice(1),
    ),
  ].join('')
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
      value: input.parse(JSON.parse(raw)),
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
      values.push(parse(JSON.parse(line)))
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
  await appendAssistantStateText(filePath, value)
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  if (isAssistantStatePath(filePath)) {
    await writeAssistantStateJson(filePath, value)
    return
  }

  await writeRuntimeJsonFileAtomic(filePath, value)
}

export async function writeTextFileAtomic(
  filePath: string,
  value: string,
): Promise<void> {
  if (isAssistantStatePath(filePath)) {
    await writeAssistantStateText(filePath, value)
    return
  }

  await writeRuntimeTextFileAtomic(filePath, value)
}

const assistantConversationHistoryTextEncoder = new TextEncoder()

export const ASSISTANT_BOUNDED_CONVERSATION_HISTORY_INCOMPLETE_TEXT =
  '[For this provider request only: the bounded conversation excerpt is incomplete. Some committed message details may be omitted; do not infer silence from unavailable context.]'

export function assistantConversationHistoryUtf8Bytes(value: string): number {
  return assistantConversationHistoryTextEncoder.encode(value).byteLength
}

export function limitAssistantConversationHistoryTextBytes(
  value: string | null,
  maxBytes: number,
): string | null {
  if (!value) {
    return null
  }
  if (assistantConversationHistoryUtf8Bytes(value) <= maxBytes) {
    return value
  }

  const codePoints = Array.from(value)
  let low = 0
  let high = codePoints.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = codePoints.slice(0, mid).join('').trimEnd()
    if (assistantConversationHistoryUtf8Bytes(candidate) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return normalizeNullableString(codePoints.slice(0, low).join('').trimEnd())
}
