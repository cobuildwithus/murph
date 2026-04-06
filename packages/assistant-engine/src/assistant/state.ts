import path from 'node:path'
import type { AssistantStatePaths } from './store/paths.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeNullableString } from './shared.js'

export function buildDefaultAssistantCronStateDocId(jobId: string): string {
  return `cron/${assertAssistantStateDocumentId(jobId, 'jobId')}`
}

export function assertAssistantStateDocumentId(
  docId: string,
  fieldName = 'docId',
): string {
  return normalizeAssistantStateDocumentId(docId, fieldName)
}

export function resolveAssistantStateDocumentPath(
  paths: Pick<AssistantStatePaths, 'stateDirectory'>,
  docId: string,
): string {
  const normalizedDocId = assertAssistantStateDocumentId(docId, 'docId')
  return path.join(paths.stateDirectory, ...normalizedDocId.split('/')) + '.json'
}

function normalizeAssistantStateDocumentId(
  value: string,
  fieldName: string,
): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_STATE_INVALID_DOC_ID',
      `${fieldName} must be a non-empty assistant state document id.`,
    )
  }

  const segments = normalized.split('/')
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        !/^[A-Za-z0-9._-]+$/u.test(segment),
    )
  ) {
    throw new VaultCliError(
      'ASSISTANT_STATE_INVALID_DOC_ID',
      `${fieldName} must use slash-delimited segments containing only letters, numbers, dots, underscores, or hyphens.`,
    )
  }

  return segments.join('/')
}
