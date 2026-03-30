import path from 'node:path'
import { VaultCliError } from '../vault-cli-errors.js'
import { normalizeNullableString } from './shared.js'

const ASSISTANT_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/u
type AssistantOpaqueIdKind =
  | 'session'
  | 'turn'
  | 'outbox intent'
  | 'cron job'
  | 'cron run'
  | 'transcript distillation'

export function assertAssistantSessionId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('session', value)
}

export function assertAssistantTurnId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('turn', value)
}

export function assertAssistantOutboxIntentId(
  value: string | null | undefined,
): string {
  return assertAssistantOpaqueId('outbox intent', value)
}

export function assertAssistantCronJobId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('cron job', value)
}

export function assertAssistantCronRunId(value: string | null | undefined): string {
  return assertAssistantOpaqueId('cron run', value)
}

export function assertAssistantTranscriptDistillationId(
  value: string | null | undefined,
): string {
  return assertAssistantOpaqueId('transcript distillation', value)
}

export function isValidAssistantOpaqueId(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeNullableString(value)
  return normalized !== null && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)
}

export function resolveAssistantOpaqueStateFilePath(input: {
  directory: string
  extension: string
  kind: AssistantOpaqueIdKind
  value: string | null | undefined
}): string {
  const opaqueId = assertAssistantOpaqueId(input.kind, input.value)
  const directory = path.resolve(input.directory)
  const filePath = path.resolve(directory, `${opaqueId}${input.extension}`)
  const relativePath = path.relative(directory, filePath)
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new VaultCliError(
      'ASSISTANT_INVALID_RUNTIME_ID',
      `Assistant ${input.kind} identifiers must resolve inside the expected runtime storage directory.`,
      {
        kind: input.kind,
        value: typeof input.value === 'string' ? input.value : null,
      },
    )
  }

  return filePath
}

function assertAssistantOpaqueId(
  kind: AssistantOpaqueIdKind,
  value: string | null | undefined,
): string {
  const normalized = normalizeNullableString(value)
  if (normalized && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_INVALID_RUNTIME_ID',
    `Assistant ${kind} identifiers must be opaque runtime ids without path separators or traversal segments.`,
    {
      kind,
      value: typeof value === 'string' ? value : null,
    },
  )
}
