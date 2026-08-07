import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type * as z from '@murphai/contracts/zod-runtime'
import {
  inboxDoctorCheckSchema,
  type InboxConnectorConfig,
  type InboxDoctorCheck,
  normalizeInboxConnectorAccountId,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  errorMessage,
  redactSensitivePathSegments,
} from '@murphai/operator-config/text/shared'
import { extractIsoDatePrefix } from '@murphai/contracts'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../inbox-app/types.js'

export { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'

const INBOX_FAILURE_CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]+/gu
const INBOX_FAILURE_WHITESPACE_PATTERN = /\s+/gu
const INBOX_FAILURE_INLINE_BEARER_PATTERN =
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/giu
const INBOX_FAILURE_NAMED_SECRET_PATTERN =
  /\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session(?:[_-]?(?:token|id))?|cookie|set-cookie|password)\b(\s*[:=]\s*)((?:Bearer\s+)?[^\s,;]+)/giu
const INBOX_FAILURE_JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu
const INBOX_FAILURE_FILE_URL_PATTERN = /\bfile:\/\/[^\s)"']+/giu
const INBOX_FAILURE_URL_PATTERN = /\bhttps?:\/\/[^\s)"']+/giu
const INBOX_FAILURE_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const INBOX_FAILURE_PHONE_PATTERN = /(?:\+\d[\d().\s-]{7,}\d|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/gu
const INBOX_FAILURE_POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:Users|home|root|tmp|var|private|mnt)\/[^\s)"']+/gu
const INBOX_FAILURE_HOME_PLACEHOLDER_PATH_PATTERN = /(^|[\s("'])<HOME_DIR>[\\/][^\s)"']+/gu
const INBOX_FAILURE_WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s)"']+/gu

export interface InboxFailureSummary {
  category: string
  code: string
  cause: string | null
  message: string
}

export function summarizeInboxFailure(
  error: unknown,
  fallbackCode: string,
): InboxFailureSummary {
  if (error instanceof VaultCliError) {
    return {
      category: 'vault_cli_error',
      code: error.code,
      cause: summarizeFailureCause(error),
      message: sanitizeInboxFailureText(error.message) ?? 'Inbox operation failed.',
    }
  }

  if (error instanceof Error) {
    return {
      category: 'unexpected_error',
      code: fallbackCode,
      cause: summarizeFailureCause(error),
      message: sanitizeInboxFailureText(error.message) ?? 'Inbox operation failed.',
    }
  }

  return {
    category: 'non_error_throw',
    code: fallbackCode,
    cause: null,
    message: sanitizeInboxFailureText(String(error)) ?? 'Inbox operation failed.',
  }
}

function summarizeFailureCause(error: Error): string | null {
  const cause = error.cause
  if (!(cause instanceof Error)) {
    return null
  }

  return sanitizeInboxFailureText(cause.message)
}

function sanitizeInboxFailureText(value: string): string | null {
  const pathRedacted = value
    .replace(INBOX_FAILURE_FILE_URL_PATTERN, '<redacted-path>')
    .replace(INBOX_FAILURE_POSIX_PATH_PATTERN, '$1<redacted-path>')
    .replace(INBOX_FAILURE_HOME_PLACEHOLDER_PATH_PATTERN, '$1<redacted-path>')
    .replace(INBOX_FAILURE_WINDOWS_PATH_PATTERN, '<redacted-path>')

  const redacted = redactSensitivePathSegments(pathRedacted)
    .replace(INBOX_FAILURE_INLINE_BEARER_PATTERN, '[redacted]')
    .replace(INBOX_FAILURE_NAMED_SECRET_PATTERN, '$1$2[redacted]')
    .replace(INBOX_FAILURE_JWT_PATTERN, '[redacted.jwt]')
    .replace(INBOX_FAILURE_URL_PATTERN, '<redacted-url>')
    .replace(INBOX_FAILURE_EMAIL_PATTERN, '<redacted-email>')
    .replace(INBOX_FAILURE_PHONE_PATTERN, '<redacted-phone>')
    .replace(INBOX_FAILURE_POSIX_PATH_PATTERN, '$1<redacted-path>')
    .replace(INBOX_FAILURE_HOME_PLACEHOLDER_PATH_PATTERN, '$1<redacted-path>')
    .replace(INBOX_FAILURE_WINDOWS_PATH_PATTERN, '<redacted-path>')
    .replace(INBOX_FAILURE_CONTROL_CHAR_PATTERN, ' ')
    .replace(INBOX_FAILURE_WHITESPACE_PATTERN, ' ')
    .trim()

  return redacted.length > 0 ? redacted : null
}

export async function readJsonWithSchema<T>(
  absolutePath: string,
  schema: z.ZodType<T>,
  code: string,
  message: string,
): Promise<T> {
  try {
    const raw = await readFile(absolutePath, 'utf8')
    return schema.parse(JSON.parse(raw))
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
  connector: Pick<InboxConnectorConfig, 'source' | 'accountId'>,
): string | null {
  return normalizeInboxConnectorAccountId(
    connector.source,
    connector.accountId,
  )
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
  return normalizeInboxConnectorAccountId(source, value)
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
  return attachment.kind === 'audio' || attachment.kind === 'video'
}

export function resolveAttachmentParseState(
  attachment: RuntimeAttachmentRecord,
  jobs: RuntimeAttachmentParseJobRecord[],
): 'pending' | 'running' | 'succeeded' | 'failed' | null {
  return readAttachmentParseState(attachment.parseState) ?? jobs[0]?.state ?? null
}

function readAttachmentParseState(
  value: RuntimeAttachmentRecord['parseState'],
): 'pending' | 'running' | 'succeeded' | 'failed' | null {
  switch (value) {
    case 'pending':
    case 'running':
    case 'succeeded':
    case 'failed':
      return value
    default:
      return null
  }
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
