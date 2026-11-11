import { extractIsoDatePrefix } from '@murphai/contracts'
import { access } from 'node:fs/promises'
import path from 'node:path'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
} from '../inbox-app/types.js'

export { normalizeNullableString } from '@murphai/operator-config/text/shared'

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
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
