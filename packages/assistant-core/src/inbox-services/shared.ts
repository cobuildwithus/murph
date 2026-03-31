import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import {
  inboxDoctorCheckSchema,
  type InboxConnectorConfig,
  type InboxDoctorCheck,
} from '../inbox-cli-contracts.js'
import { errorMessage, normalizeNullableString } from '../text/shared.js'
import { extractIsoDatePrefix } from '@murph/contracts'

import { VaultCliError } from '../vault-cli-errors.js'
import type {
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../inbox-app/types.js'

export { errorMessage, normalizeNullableString } from '../text/shared.js'

export async function readJsonWithSchema<T>(
  absolutePath: string,
  schema: z.ZodType<T>,
  code: string,
  message: string,
): Promise<T> {
  try {
    const raw = await readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return schema.parse(parsed)
  } catch (error) {
    throw new VaultCliError(code, message, { error: errorMessage(error) })
  }
}

export async function writeJsonFile(
  absolutePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

export function runtimeNamespaceAccountId(
  connector: Pick<InboxConnectorConfig, 'accountId'>,
): string | null {
  return connector.accountId ?? null
}

export function connectorNamespaceKey(
  connector: Pick<InboxConnectorConfig, 'source' | 'accountId'>,
): string {
  return `${connector.source}::${runtimeNamespaceAccountId(connector) ?? 'default'}`
}

export function normalizeConnectorAccountId(
  source: InboxConnectorConfig['source'],
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)

  switch (source) {
    case 'imessage':
      return normalized ?? 'self'
    case 'telegram':
      return normalized ?? 'bot'
    case 'email':
      return normalized
    case 'linq':
      return normalized ?? 'default'
  }
}

export function normalizeBackfillLimit(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      'Backfill limit must be an integer between 1 and 5000.',
    )
  }

  return value
}

export function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      `Limit must be an integer between 1 and ${max}.`,
    )
  }

  return value
}

export function relativeToVault(
  vaultRoot: string,
  absolutePath: string,
): string {
  const relativePath = path.relative(vaultRoot, absolutePath)
  return relativePath.length > 0 ? relativePath.replace(/\\/g, '/') : '.'
}

export function normalizeOptionalCommandLimit(
  value: number | undefined,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new VaultCliError(
      'INBOX_INVALID_LIMIT',
      `Limit must be an integer between 1 and ${max}.`,
    )
  }

  return value
}

export function passCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'pass',
    message,
    details,
  })
}

export function warnCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'warn',
    message,
    details,
  })
}

export function failCheck(
  name: string,
  message: string,
  details?: Record<string, unknown>,
): InboxDoctorCheck {
  return inboxDoctorCheckSchema.parse({
    name,
    status: 'fail',
    message,
    details,
  })
}

export function redactSensitivePath(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (
    /^\/Users\/[^/]+/u.test(trimmed) ||
    /^\/home\/[^/]+/u.test(trimmed) ||
    /^[A-Za-z]:\\Users\\[^\\]+/u.test(trimmed)
  ) {
    return '<REDACTED_PATH>'
  }

  return trimmed
}

export function normalizeVaultPathOutput(
  vaultRoot: string,
  filePath: string,
): string {
  return path.isAbsolute(filePath)
    ? relativeToVault(vaultRoot, filePath)
    : filePath.replace(/\\/g, '/')
}

export function countRuntimeCaptures(runtime: RuntimeStore): number {
  let limit = 200

  while (true) {
    const count = runtime.listCaptures({ limit }).length
    if (count < limit) {
      return count
    }
    limit *= 2
  }
}

export function listAllCaptures(runtime: RuntimeStore): RuntimeCaptureRecord[] {
  return runtime.listCaptures({ limit: countRuntimeCaptures(runtime) || 1 })
}

export function isParseableAttachment(
  attachment: RuntimeAttachmentRecord,
): boolean {
  return (
    attachment.kind === 'audio' ||
    attachment.kind === 'document' ||
    attachment.kind === 'video'
  )
}

export function resolveAttachmentParseState(
  attachment: RuntimeAttachmentRecord,
  jobs: RuntimeAttachmentParseJobRecord[],
): 'pending' | 'running' | 'succeeded' | 'failed' | null {
  return attachment.parseState ?? jobs[0]?.state ?? null
}

export function occurredDayFromCapture(
  capture: RuntimeCaptureRecord,
): string {
  const day = extractIsoDatePrefix(capture.occurredAt)
  if (!day) {
    throw new VaultCliError(
      'INBOX_CAPTURE_OCCURRED_AT_INVALID',
      `Inbox capture "${capture.captureId}" has an invalid occurredAt timestamp.`,
      { occurredAt: capture.occurredAt },
    )
  }

  return day
}
