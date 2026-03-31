import { readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AssistantStatePaths,
} from './store/paths.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
} from './store/paths.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  writeJsonFileAtomic,
} from './shared.js'
import { withAssistantStateDocumentWriteLock } from './state/locking.js'

type JsonObject = Record<string, unknown>

export interface AssistantStateDocumentSnapshot {
  docId: string
  documentPath: string
  exists: boolean
  updatedAt: string | null
  value: JsonObject | null
}

export interface AssistantStateDocumentListEntry {
  docId: string
  documentPath: string
  updatedAt: string
}

export interface AssistantStateGetDocumentInput {
  docId: string
  vault: string
}

export interface AssistantStatePutDocumentInput {
  docId: string
  value: JsonObject
  vault: string
}

export interface AssistantStatePatchDocumentInput {
  docId: string
  patch: JsonObject
  vault: string
}

export interface AssistantStateDeleteDocumentInput {
  docId: string
  vault: string
}

export interface AssistantStateDeleteDocumentResult {
  docId: string
  documentPath: string
  existed: boolean
}

export interface AssistantStateListDocumentsInput {
  prefix?: string | null
  vault: string
}

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

export async function getAssistantStateDocument(
  input: AssistantStateGetDocumentInput,
): Promise<AssistantStateDocumentSnapshot> {
  const paths = resolveAssistantStatePaths(input.vault)
  return readAssistantStateDocument(paths, input.docId)
}

export async function putAssistantStateDocument(
  input: AssistantStatePutDocumentInput,
): Promise<AssistantStateDocumentSnapshot> {
  const paths = resolveAssistantStatePaths(input.vault)
  const normalizedDocId = normalizeAssistantStateDocumentId(input.docId, 'docId')

  return withAssistantStateDocumentWriteLock(paths, async () => {
    const documentPath = resolveAssistantStateDocumentPath(paths, normalizedDocId)
    await ensureAssistantStateDirectory(path.dirname(documentPath))
    await writeJsonFileAtomic(documentPath, input.value)
    return readAssistantStateDocument(paths, normalizedDocId)
  })
}

export async function patchAssistantStateDocument(
  input: AssistantStatePatchDocumentInput,
): Promise<AssistantStateDocumentSnapshot> {
  const paths = resolveAssistantStatePaths(input.vault)
  const normalizedDocId = normalizeAssistantStateDocumentId(input.docId, 'docId')

  return withAssistantStateDocumentWriteLock(paths, async () => {
    const existing = await readAssistantStateDocument(paths, normalizedDocId)
    const merged = applyAssistantStateMergePatch(existing.value ?? {}, input.patch)
    const documentPath = resolveAssistantStateDocumentPath(paths, normalizedDocId)
    await ensureAssistantStateDirectory(path.dirname(documentPath))
    await writeJsonFileAtomic(documentPath, merged)
    return readAssistantStateDocument(paths, normalizedDocId)
  })
}

export async function deleteAssistantStateDocument(
  input: AssistantStateDeleteDocumentInput,
): Promise<AssistantStateDeleteDocumentResult> {
  const paths = resolveAssistantStatePaths(input.vault)
  const normalizedDocId = normalizeAssistantStateDocumentId(input.docId, 'docId')

  return withAssistantStateDocumentWriteLock(paths, async () => {
    const documentPath = resolveAssistantStateDocumentPath(paths, normalizedDocId)

    try {
      await rm(documentPath)
      return {
        docId: normalizedDocId,
        documentPath,
        existed: true,
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          docId: normalizedDocId,
          documentPath,
          existed: false,
        }
      }

      throw error
    }
  })
}

export async function listAssistantStateDocuments(
  input: AssistantStateListDocumentsInput,
): Promise<AssistantStateDocumentListEntry[]> {
  const paths = resolveAssistantStatePaths(input.vault)
  const prefix = normalizeNullableString(input.prefix)
  if (prefix !== null) {
    normalizeAssistantStateDocumentId(prefix, 'prefix')
  }

  const entries = await collectAssistantStateDocumentEntries(paths.stateDirectory)
  return entries
    .filter((entry) => matchesAssistantStateDocumentPrefix(entry.docId, prefix))
    .sort((left, right) => left.docId.localeCompare(right.docId))
}

export function redactAssistantStateDocumentSnapshot(
  snapshot: AssistantStateDocumentSnapshot,
): AssistantStateDocumentSnapshot {
  return {
    ...snapshot,
    documentPath: redactAssistantDisplayPath(snapshot.documentPath),
  }
}

export function redactAssistantStateDocumentListEntry(
  entry: AssistantStateDocumentListEntry,
): AssistantStateDocumentListEntry {
  return {
    ...entry,
    documentPath: redactAssistantDisplayPath(entry.documentPath),
  }
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

async function readAssistantStateDocument(
  paths: AssistantStatePaths,
  docId: string,
): Promise<AssistantStateDocumentSnapshot> {
  const normalizedDocId = normalizeAssistantStateDocumentId(docId, 'docId')
  const documentPath = resolveAssistantStateDocumentPath(paths, normalizedDocId)

  try {
    const [raw, metadata] = await Promise.all([
      readFile(documentPath, 'utf8'),
      stat(documentPath),
    ])
    const parsed = JSON.parse(raw) as unknown

    if (!isJsonObject(parsed)) {
      throw new VaultCliError(
        'ASSISTANT_STATE_INVALID_DOCUMENT',
        `Assistant state document "${normalizedDocId}" must contain a JSON object.`,
      )
    }

    return {
      docId: normalizedDocId,
      documentPath,
      exists: true,
      updatedAt: metadata.mtime.toISOString(),
      value: parsed,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        docId: normalizedDocId,
        documentPath,
        exists: false,
        updatedAt: null,
        value: null,
      }
    }

    throw error
  }
}

async function collectAssistantStateDocumentEntries(
  rootDirectory: string,
): Promise<AssistantStateDocumentListEntry[]> {
  try {
    return await collectAssistantStateDocumentEntriesRecursive(rootDirectory, rootDirectory)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

async function collectAssistantStateDocumentEntriesRecursive(
  rootDirectory: string,
  currentDirectory: string,
): Promise<AssistantStateDocumentListEntry[]> {
  const entries = await readdir(currentDirectory, {
    withFileTypes: true,
  })
  const documents: AssistantStateDocumentListEntry[] = []

  for (const entry of entries) {
    const nextPath = path.join(currentDirectory, entry.name)
    if (entry.isDirectory()) {
      documents.push(
        ...(await collectAssistantStateDocumentEntriesRecursive(rootDirectory, nextPath)),
      )
      continue
    }

    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const metadata = await stat(nextPath)
    const relativePath = path.relative(rootDirectory, nextPath)
    const docId = relativePath
      .replace(/\.json$/u, '')
      .split(path.sep)
      .join('/')
    const normalizedDocId = tryNormalizeAssistantStateDocumentId(docId)
    if (normalizedDocId === null) {
      continue
    }
    documents.push({
      docId: normalizedDocId,
      documentPath: nextPath,
      updatedAt: metadata.mtime.toISOString(),
    })
  }

  return documents
}

function matchesAssistantStateDocumentPrefix(
  docId: string,
  prefix: string | null,
): boolean {
  if (prefix === null) {
    return true
  }

  return docId === prefix || docId.startsWith(`${prefix}/`)
}

function applyAssistantStateMergePatch(
  target: JsonObject,
  patch: JsonObject,
): JsonObject {
  const next: JsonObject = {
    ...target,
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
      continue
    }

    if (isJsonObject(value)) {
      const current = next[key]
      next[key] = applyAssistantStateMergePatch(
        isJsonObject(current) ? current : {},
        value,
      )
      continue
    }

    next[key] = value
  }

  return next
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryNormalizeAssistantStateDocumentId(value: string): string | null {
  try {
    return assertAssistantStateDocumentId(value)
  } catch (error) {
    if (
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_STATE_INVALID_DOC_ID'
    ) {
      return null
    }

    throw error
  }
}
