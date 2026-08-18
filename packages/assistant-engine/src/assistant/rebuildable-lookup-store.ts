import { createHash } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  parseVersionedJsonStateEnvelope,
  resolveRuntimePaths,
  writeVersionedJsonStateFile,
} from '@murphai/runtime-state/node'
import { isMissingFileError } from './shared.js'
import type { AssistantStatePaths } from './store/paths.js'

const ASSISTANT_REBUILDABLE_LOOKUP_RECORD_SCHEMA =
  'murph.assistant-rebuildable-lookup-record'
const ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_SCHEMA =
  'murph.assistant-rebuildable-lookup-bucket'
const ASSISTANT_REBUILDABLE_LOOKUP_SCHEMA_VERSION = 1
const ASSISTANT_REBUILDABLE_LOOKUP_ROOT = 'assistant-rebuildable-lookups'
const ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT = 256
const ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_FILE_MAX_BYTES = 512 * 1024
const ASSISTANT_REBUILDABLE_LOOKUP_RECORD_FILE_MAX_BYTES = 256 * 1024
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const GENERATION_PATTERN = /^[0-9a-f]{32}$/u
const BUCKET_ID_PATTERN = /^[0-9a-f]{2}$/u

interface AssistantRebuildableLookupRecordV1 {
  generation: string
  keyDigest: string
  kindDigest: string
  ownerDigest: string
  payload: unknown
}

interface AssistantRebuildableLookupBucketEntryV1 {
  entryKey: string
  recordDigest: string
}

interface AssistantRebuildableLookupBucketV1 {
  bucketId: string
  entries: AssistantRebuildableLookupBucketEntryV1[]
  generation: string
  ownerDigest: string
}

export interface AssistantRebuildableLookupReadMetrics {
  bytesRead: number
  elapsedMs: number
  filesRead: number
}

export type AssistantRebuildableLookupRead<T> =
  | {
      kind: 'absent'
      metrics: AssistantRebuildableLookupReadMetrics
    }
  | {
      kind: 'invalid'
      metrics: AssistantRebuildableLookupReadMetrics
      reason: string
    }
  | {
      kind: 'value'
      metrics: AssistantRebuildableLookupReadMetrics
      value: T
    }

export interface AssistantRebuildableLookupChange<T = unknown> {
  key: string
  kind: string
  value: T | null
}

export interface AssistantRebuildableLookupWriteResult {
  bucketDigests: Record<string, string>
  logicalWrites: number
}

interface AssistantRebuildableLookupBucketSnapshot {
  digest: string
  value: AssistantRebuildableLookupBucketV1
}

export function createEmptyAssistantRebuildableLookupBucketDigests(input: {
  generation: string
  owner: string
}): Record<string, string> {
  assertGeneration(input.generation)
  const ownerDigest = hashAssistantRebuildableLookupOwner(input.owner)
  return Object.fromEntries(
    Array.from({ length: ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT }, (_, index) => {
      const bucketId = index.toString(16).padStart(2, '0')
      const value = createEmptyBucket({
        bucketId,
        generation: input.generation,
        ownerDigest,
      })
      return [bucketId, hashAssistantRebuildableLookupBucket(value)]
    }),
  )
}

export function computeAssistantRebuildableLookupBucketDigests(input: {
  changes: readonly AssistantRebuildableLookupChange[]
  generation: string
  owner: string
  paths: AssistantStatePaths
}): Record<string, string> {
  assertGeneration(input.generation)
  const ownerDigest = hashAssistantRebuildableLookupOwner(input.owner)
  const entriesByBucket = new Map<
    string,
    AssistantRebuildableLookupBucketEntryV1[]
  >()
  for (const change of normalizeChanges(input.changes)) {
    if (change.value === null) {
      continue
    }
    const identity = resolveLookupIdentity({
      generation: input.generation,
      key: change.key,
      kind: change.kind,
      owner: input.owner,
      paths: input.paths,
    })
    const record: AssistantRebuildableLookupRecordV1 = {
      generation: input.generation,
      keyDigest: identity.keyDigest,
      kindDigest: identity.kindDigest,
      ownerDigest: identity.ownerDigest,
      payload: change.value,
    }
    const entries = entriesByBucket.get(identity.bucketId) ?? []
    entries.push({
      entryKey: identity.entryKey,
      recordDigest: hashAssistantRebuildableLookupRecord(record),
    })
    entriesByBucket.set(identity.bucketId, entries)
  }

  return Object.fromEntries(
    Array.from({ length: ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT }, (_, index) => {
      const bucketId = index.toString(16).padStart(2, '0')
      const entries = [...(entriesByBucket.get(bucketId) ?? [])]
        .sort((left, right) => left.entryKey.localeCompare(right.entryKey))
      const value: AssistantRebuildableLookupBucketV1 = {
        bucketId,
        entries,
        generation: input.generation,
        ownerDigest,
      }
      return [bucketId, hashAssistantRebuildableLookupBucket(value)]
    }),
  )
}

export function parseAssistantRebuildableLookupBucketDigests(
  value: unknown,
): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new TypeError('Assistant rebuildable lookup bucket digests must be an object.')
  }
  const keys = Object.keys(value).sort()
  if (
    keys.length !== ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT ||
    keys.some((key, index) => key !== index.toString(16).padStart(2, '0'))
  ) {
    throw new TypeError(
      `Assistant rebuildable lookup bucket digests must contain exactly ${ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT} buckets.`,
    )
  }
  return Object.fromEntries(
    keys.map((key) => {
      const digest = value[key]
      if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
        throw new TypeError(
          `Assistant rebuildable lookup bucket ${key} requires a SHA-256 digest.`,
        )
      }
      return [key, digest]
    }),
  )
}

export async function readAssistantRebuildableLookupAtPaths<T>(input: {
  bucketDigests: Readonly<Record<string, string>>
  generation: string
  key: string
  kind: string
  owner: string
  parseValue(value: unknown): T
  paths: AssistantStatePaths
}): Promise<AssistantRebuildableLookupRead<T>> {
  const startedAt = Date.now()
  let bytesRead = 0
  let filesRead = 0
  const finishMetrics = (): AssistantRebuildableLookupReadMetrics => ({
    bytesRead,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    filesRead,
  })

  try {
    assertGeneration(input.generation)
    const identity = resolveLookupIdentity(input)
    const expectedBucketDigest = input.bucketDigests[identity.bucketId]
    if (!expectedBucketDigest || !SHA256_PATTERN.test(expectedBucketDigest)) {
      return {
        kind: 'invalid',
        metrics: finishMetrics(),
        reason: 'publication-bucket-digest-invalid',
      }
    }

    const bucketRead = await readAssistantRebuildableLookupBucketAtPaths({
      bucketId: identity.bucketId,
      generation: input.generation,
      owner: input.owner,
      paths: input.paths,
    })
    bytesRead += bucketRead.bytesRead
    filesRead += bucketRead.filesRead
    if (bucketRead.snapshot.digest !== expectedBucketDigest) {
      return {
        kind: 'invalid',
        metrics: finishMetrics(),
        reason: 'bucket-publication-mismatch',
      }
    }

    const entry = bucketRead.snapshot.value.entries.find(
      (candidate) => candidate.entryKey === identity.entryKey,
    )
    if (!entry) {
      return {
        kind: 'absent',
        metrics: finishMetrics(),
      }
    }

    const recordRead = await readBoundedVersionedJsonFile({
      currentPath: resolveAssistantRebuildableLookupRecordPath({
        generation: input.generation,
        keyDigest: identity.keyDigest,
        kindDigest: identity.kindDigest,
        owner: input.owner,
        paths: input.paths,
      }),
      label: 'assistant rebuildable lookup record',
      maxBytes: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_FILE_MAX_BYTES,
      parseValue: parseAssistantRebuildableLookupRecord,
      schema: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_SCHEMA,
    })
    bytesRead += recordRead.bytesRead
    filesRead += 1
    const record = recordRead.value
    if (
      record.ownerDigest !== identity.ownerDigest ||
      record.generation !== input.generation ||
      record.kindDigest !== identity.kindDigest ||
      record.keyDigest !== identity.keyDigest
    ) {
      return {
        kind: 'invalid',
        metrics: finishMetrics(),
        reason: 'record-identity-mismatch',
      }
    }
    if (hashAssistantRebuildableLookupRecord(record) !== entry.recordDigest) {
      return {
        kind: 'invalid',
        metrics: finishMetrics(),
        reason: 'record-catalog-digest-mismatch',
      }
    }

    let value: T
    try {
      value = input.parseValue(record.payload)
    } catch {
      return {
        kind: 'invalid',
        metrics: finishMetrics(),
        reason: 'record-payload-invalid',
      }
    }
    return {
      kind: 'value',
      metrics: finishMetrics(),
      value,
    }
  } catch (error) {
    return {
      kind: 'invalid',
      metrics: finishMetrics(),
      reason: isMissingFileError(error)
        ? 'record-catalog-dangling'
        : 'lookup-read-failed',
    }
  }
}

/**
 * Apply a bounded owner-planned record set to one unpublished generation view.
 * Callers publish the returned bucket digests only after their canonical write
 * and all post-canonical removals complete.
 */
export async function applyAssistantRebuildableLookupChangesAtPaths(input: {
  bucketDigests: Readonly<Record<string, string>>
  changes: readonly AssistantRebuildableLookupChange[]
  generation: string
  owner: string
  paths: AssistantStatePaths
}): Promise<AssistantRebuildableLookupWriteResult> {
  assertGeneration(input.generation)
  const uniqueChanges = normalizeChanges(input.changes)
  if (uniqueChanges.length === 0) {
    return {
      bucketDigests: { ...input.bucketDigests },
      logicalWrites: 0,
    }
  }

  const identities = uniqueChanges.map((change) => ({
    change,
    identity: resolveLookupIdentity({
      generation: input.generation,
      key: change.key,
      kind: change.kind,
      owner: input.owner,
      paths: input.paths,
    }),
  }))
  const byBucket = new Map<string, typeof identities>()
  for (const item of identities) {
    const existing = byBucket.get(item.identity.bucketId) ?? []
    existing.push(item)
    byBucket.set(item.identity.bucketId, existing)
  }

  const bucketDigests = { ...input.bucketDigests }
  let logicalWrites = 0
  for (const [bucketId, items] of [...byBucket.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const expectedDigest = bucketDigests[bucketId]
    if (!expectedDigest || !SHA256_PATTERN.test(expectedDigest)) {
      throw new TypeError(
        `Assistant rebuildable lookup publication is missing bucket ${bucketId}.`,
      )
    }
    const bucketRead = await readAssistantRebuildableLookupBucketAtPaths({
      bucketId,
      generation: input.generation,
      owner: input.owner,
      paths: input.paths,
    })
    if (bucketRead.snapshot.digest !== expectedDigest) {
      throw new Error(
        `Assistant rebuildable lookup bucket ${bucketId} changed outside its publication.`,
      )
    }

    const entries = new Map(
      bucketRead.snapshot.value.entries.map((entry) => [entry.entryKey, entry.recordDigest]),
    )
    const removeAfterCatalog: string[] = []
    for (const { change, identity } of items) {
      if (change.value === null) {
        if (entries.delete(identity.entryKey)) {
          removeAfterCatalog.push(resolveAssistantRebuildableLookupRecordPath({
            generation: input.generation,
            keyDigest: identity.keyDigest,
            kindDigest: identity.kindDigest,
            owner: input.owner,
            paths: input.paths,
          }))
        }
        continue
      }

      const record: AssistantRebuildableLookupRecordV1 = {
        generation: input.generation,
        keyDigest: identity.keyDigest,
        kindDigest: identity.kindDigest,
        ownerDigest: identity.ownerDigest,
        payload: change.value,
      }
      const recordDigest = hashAssistantRebuildableLookupRecord(record)
      if (entries.get(identity.entryKey) === recordDigest) {
        continue
      }
      await writeVersionedJsonStateFile({
        filePath: resolveAssistantRebuildableLookupRecordPath({
          generation: input.generation,
          keyDigest: identity.keyDigest,
          kindDigest: identity.kindDigest,
          owner: input.owner,
          paths: input.paths,
        }),
        schema: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_SCHEMA,
        schemaVersion: ASSISTANT_REBUILDABLE_LOOKUP_SCHEMA_VERSION,
        value: record,
      })
      entries.set(identity.entryKey, recordDigest)
      logicalWrites += 1
    }

    const nextBucket: AssistantRebuildableLookupBucketV1 = {
      ...bucketRead.snapshot.value,
      entries: [...entries.entries()]
        .map(([entryKey, recordDigest]) => ({ entryKey, recordDigest }))
        .sort((left, right) => left.entryKey.localeCompare(right.entryKey)),
    }
    const nextDigest = hashAssistantRebuildableLookupBucket(nextBucket)
    if (nextDigest !== bucketRead.snapshot.digest) {
      const bucketPath = resolveAssistantRebuildableLookupBucketPath({
        bucketId,
        generation: input.generation,
        owner: input.owner,
        paths: input.paths,
      })
      if (nextBucket.entries.length === 0) {
        await rm(bucketPath, { force: true })
      } else {
        await writeVersionedJsonStateFile({
          filePath: bucketPath,
          schema: ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_SCHEMA,
          schemaVersion: ASSISTANT_REBUILDABLE_LOOKUP_SCHEMA_VERSION,
          value: nextBucket,
        })
      }
      logicalWrites += 1
      bucketDigests[bucketId] = nextDigest
    }

    for (const recordPath of removeAfterCatalog) {
      try {
        await rm(recordPath, { force: true })
        logicalWrites += 1
      } catch {}
    }
  }

  return { bucketDigests, logicalWrites }
}

export async function validateAssistantRebuildableLookupGenerationAtPaths(input: {
  bucketDigests: Readonly<Record<string, string>>
  generation: string
  owner: string
  paths: AssistantStatePaths
}): Promise<boolean> {
  try {
    assertGeneration(input.generation)
    const parsedDigests = parseAssistantRebuildableLookupBucketDigests(
      input.bucketDigests,
    )
    for (const bucketId of Object.keys(parsedDigests)) {
      const read = await readAssistantRebuildableLookupBucketAtPaths({
        bucketId,
        generation: input.generation,
        owner: input.owner,
        paths: input.paths,
      })
      if (read.snapshot.digest !== parsedDigests[bucketId]) {
        return false
      }
      for (const entry of read.snapshot.value.entries) {
        const [kindDigest, keyDigest] = entry.entryKey.split(':')
        if (!kindDigest || !keyDigest) {
          return false
        }
        let recordRead: { bytesRead: number; value: AssistantRebuildableLookupRecordV1 }
        try {
          recordRead = await readBoundedVersionedJsonFile({
            currentPath: resolveAssistantRebuildableLookupRecordPath({
              generation: input.generation,
              keyDigest,
              kindDigest,
              owner: input.owner,
              paths: input.paths,
            }),
            label: 'assistant rebuildable lookup record',
            maxBytes: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_FILE_MAX_BYTES,
            parseValue: parseAssistantRebuildableLookupRecord,
            schema: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_SCHEMA,
          })
        } catch {
          return false
        }
        const record = recordRead.value
        if (
          record.generation !== input.generation ||
          record.ownerDigest !== hashAssistantRebuildableLookupOwner(input.owner) ||
          record.kindDigest !== kindDigest ||
          record.keyDigest !== keyDigest ||
          hashAssistantRebuildableLookupRecord(record) !== entry.recordDigest
        ) {
          return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Recover the witnessed bucket digests for an interrupted unpublished build.
 * Every catalog entry is revalidated against its record before a digest is
 * returned; unreferenced crash-residue records are deliberately ignored.
 */
export async function recoverAssistantRebuildableLookupGenerationBucketDigestsAtPaths(
  input: {
    generation: string
    owner: string
    paths: AssistantStatePaths
  },
): Promise<Record<string, string> | null> {
  try {
    assertGeneration(input.generation)
    const ownerDigest = hashAssistantRebuildableLookupOwner(input.owner)
    const bucketDigests: Record<string, string> = {}
    for (
      let index = 0;
      index < ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_COUNT;
      index += 1
    ) {
      const bucketId = index.toString(16).padStart(2, '0')
      const read = await readAssistantRebuildableLookupBucketAtPaths({
        bucketId,
        generation: input.generation,
        owner: input.owner,
        paths: input.paths,
      })
      for (const entry of read.snapshot.value.entries) {
        const [kindDigest, keyDigest] = entry.entryKey.split(':')
        if (!kindDigest || !keyDigest) {
          return null
        }
        const recordRead = await readBoundedVersionedJsonFile({
          currentPath: resolveAssistantRebuildableLookupRecordPath({
            generation: input.generation,
            keyDigest,
            kindDigest,
            owner: input.owner,
            paths: input.paths,
          }),
          label: 'assistant rebuildable lookup record',
          maxBytes: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_FILE_MAX_BYTES,
          parseValue: parseAssistantRebuildableLookupRecord,
          schema: ASSISTANT_REBUILDABLE_LOOKUP_RECORD_SCHEMA,
        })
        const record = recordRead.value
        if (
          record.generation !== input.generation ||
          record.ownerDigest !== ownerDigest ||
          record.kindDigest !== kindDigest ||
          record.keyDigest !== keyDigest ||
          hashAssistantRebuildableLookupRecord(record) !== entry.recordDigest
        ) {
          return null
        }
      }
      bucketDigests[bucketId] = read.snapshot.digest
    }
    return bucketDigests
  } catch {
    return null
  }
}

export async function listAssistantRebuildableLookupGenerationsAtPaths(input: {
  owner: string
  paths: AssistantStatePaths
}): Promise<string[]> {
  const generationsDirectory = path.join(
    resolveAssistantRebuildableLookupOwnerDirectory(input),
    'generations',
  )
  try {
    const entries = await readdir(generationsDirectory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && GENERATION_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}

export async function removeAssistantRebuildableLookupGenerationAtPaths(input: {
  generation: string
  owner: string
  paths: AssistantStatePaths
}): Promise<void> {
  assertGeneration(input.generation)
  await rm(resolveAssistantRebuildableLookupGenerationDirectory(input), {
    force: true,
    recursive: true,
  })
}

export function resolveAssistantRebuildableLookupOwnerDirectory(input: {
  owner: string
  paths: AssistantStatePaths
}): string {
  const runtimePaths = resolveRuntimePaths(input.paths.absoluteVaultRoot)
  return path.join(
    runtimePaths.projectionsRoot,
    ASSISTANT_REBUILDABLE_LOOKUP_ROOT,
    hashAssistantRebuildableLookupOwner(input.owner),
  )
}

export function resolveAssistantRebuildableLookupGenerationDirectory(input: {
  generation: string
  owner: string
  paths: AssistantStatePaths
}): string {
  assertGeneration(input.generation)
  return path.join(
    resolveAssistantRebuildableLookupOwnerDirectory(input),
    'generations',
    input.generation,
  )
}

export function resolveAssistantRebuildableLookupBucketPath(input: {
  bucketId: string
  generation: string
  owner: string
  paths: AssistantStatePaths
}): string {
  if (!BUCKET_ID_PATTERN.test(input.bucketId)) {
    throw new TypeError('Assistant rebuildable lookup bucket id must be two hex characters.')
  }
  return path.join(
    resolveAssistantRebuildableLookupGenerationDirectory(input),
    'buckets',
    `${input.bucketId}.json`,
  )
}

export function resolveAssistantRebuildableLookupRecordPath(input: {
  generation: string
  keyDigest: string
  kindDigest: string
  owner: string
  paths: AssistantStatePaths
}): string {
  if (!SHA256_PATTERN.test(input.kindDigest) || !SHA256_PATTERN.test(input.keyDigest)) {
    throw new TypeError('Assistant rebuildable lookup record digests must be SHA-256 values.')
  }
  return path.join(
    resolveAssistantRebuildableLookupGenerationDirectory(input),
    'records',
    input.kindDigest,
    `${input.keyDigest}.json`,
  )
}

export function hashAssistantRebuildableLookupOwner(owner: string): string {
  const normalized = normalizeRequiredOpaqueValue(owner, 'owner')
  return hashJson([
    'murph.assistant-rebuildable-lookup-owner.v1',
    normalized,
  ])
}

export function hashAssistantRebuildableLookupKind(input: {
  kind: string
  owner: string
}): string {
  return hashJson([
    'murph.assistant-rebuildable-lookup-kind.v1',
    normalizeRequiredOpaqueValue(input.owner, 'owner'),
    normalizeRequiredOpaqueValue(input.kind, 'kind'),
  ])
}

export function hashAssistantRebuildableLookupKey(input: {
  key: string
  kind: string
  owner: string
}): string {
  return hashJson([
    'murph.assistant-rebuildable-lookup-key.v1',
    normalizeRequiredOpaqueValue(input.owner, 'owner'),
    normalizeRequiredOpaqueValue(input.kind, 'kind'),
    normalizeRequiredOpaqueValue(input.key, 'key'),
  ])
}

async function readAssistantRebuildableLookupBucketAtPaths(input: {
  bucketId: string
  generation: string
  owner: string
  paths: AssistantStatePaths
}): Promise<{
  bytesRead: number
  filesRead: number
  snapshot: AssistantRebuildableLookupBucketSnapshot
}> {
  const ownerDigest = hashAssistantRebuildableLookupOwner(input.owner)
  const bucketPath = resolveAssistantRebuildableLookupBucketPath(input)
  try {
    const read = await readBoundedVersionedJsonFile({
      currentPath: bucketPath,
      label: 'assistant rebuildable lookup bucket',
      maxBytes: ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_FILE_MAX_BYTES,
      parseValue: parseAssistantRebuildableLookupBucket,
      schema: ASSISTANT_REBUILDABLE_LOOKUP_BUCKET_SCHEMA,
    })
    const value = read.value
    if (
      value.ownerDigest !== ownerDigest ||
      value.generation !== input.generation ||
      value.bucketId !== input.bucketId
    ) {
      throw new TypeError('Assistant rebuildable lookup bucket identity is invalid.')
    }
    return {
      bytesRead: read.bytesRead,
      filesRead: 1,
      snapshot: {
        digest: hashAssistantRebuildableLookupBucket(value),
        value,
      },
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    const value = createEmptyBucket({
      bucketId: input.bucketId,
      generation: input.generation,
      ownerDigest,
    })
    return {
      bytesRead: 0,
      filesRead: 0,
      snapshot: {
        digest: hashAssistantRebuildableLookupBucket(value),
        value,
      },
    }
  }
}

async function readBoundedVersionedJsonFile<T>(input: {
  currentPath: string
  label: string
  maxBytes: number
  parseValue(value: unknown): T
  schema: string
}): Promise<{ bytesRead: number; value: T }> {
  const raw = await readFile(input.currentPath, 'utf8')
  const bytesRead = Buffer.byteLength(raw, 'utf8')
  if (bytesRead > input.maxBytes) {
    throw new TypeError(`${input.label} exceeds its bounded file size.`)
  }
  return {
    bytesRead,
    value: parseVersionedJsonStateEnvelope(JSON.parse(raw), {
      label: input.label,
      parseValue: input.parseValue,
      schema: input.schema,
      schemaVersion: ASSISTANT_REBUILDABLE_LOOKUP_SCHEMA_VERSION,
    }),
  }
}

function resolveLookupIdentity(input: {
  generation: string
  key: string
  kind: string
  owner: string
  paths: AssistantStatePaths
}): {
  bucketId: string
  entryKey: string
  keyDigest: string
  kindDigest: string
  ownerDigest: string
} {
  void input.paths
  const ownerDigest = hashAssistantRebuildableLookupOwner(input.owner)
  const kindDigest = hashAssistantRebuildableLookupKind(input)
  const keyDigest = hashAssistantRebuildableLookupKey(input)
  return {
    bucketId: keyDigest.slice(0, 2),
    entryKey: `${kindDigest}:${keyDigest}`,
    keyDigest,
    kindDigest,
    ownerDigest,
  }
}

function normalizeChanges(
  changes: readonly AssistantRebuildableLookupChange[],
): AssistantRebuildableLookupChange[] {
  const byIdentity = new Map<string, AssistantRebuildableLookupChange>()
  for (const change of changes) {
    const kind = normalizeRequiredOpaqueValue(change.kind, 'kind')
    const key = normalizeRequiredOpaqueValue(change.key, 'key')
    const identity = JSON.stringify([kind, key])
    if (byIdentity.has(identity)) {
      throw new TypeError('Assistant rebuildable lookup changes must be unique by kind and key.')
    }
    if (change.value === undefined) {
      throw new TypeError(
        'Assistant rebuildable lookup payload must be explicit or null.',
      )
    }
    byIdentity.set(identity, {
      key,
      kind,
      value: change.value,
    })
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key),
  )
}

function parseAssistantRebuildableLookupRecord(
  value: unknown,
): AssistantRebuildableLookupRecordV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'generation',
    'keyDigest',
    'kindDigest',
    'ownerDigest',
    'payload',
  ])) {
    throw new TypeError('Assistant rebuildable lookup record must be a strict object.')
  }
  const generation = parseGeneration(value.generation)
  const keyDigest = parseSha256(value.keyDigest, 'key digest')
  const kindDigest = parseSha256(value.kindDigest, 'kind digest')
  const ownerDigest = parseSha256(value.ownerDigest, 'owner digest')
  return {
    generation,
    keyDigest,
    kindDigest,
    ownerDigest,
    payload: value.payload,
  }
}

function parseAssistantRebuildableLookupBucket(
  value: unknown,
): AssistantRebuildableLookupBucketV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    'bucketId',
    'entries',
    'generation',
    'ownerDigest',
  ])) {
    throw new TypeError('Assistant rebuildable lookup bucket must be a strict object.')
  }
  const bucketId = typeof value.bucketId === 'string' && BUCKET_ID_PATTERN.test(value.bucketId)
    ? value.bucketId
    : null
  if (!bucketId) {
    throw new TypeError('Assistant rebuildable lookup bucket requires a valid bucket id.')
  }
  if (!Array.isArray(value.entries)) {
    throw new TypeError('Assistant rebuildable lookup bucket entries must be an array.')
  }
  const entries = value.entries.map(parseAssistantRebuildableLookupBucketEntry)
  const sorted = [...entries].sort((left, right) =>
    left.entryKey.localeCompare(right.entryKey),
  )
  if (
    sorted.some((entry, index) => entry.entryKey !== entries[index]?.entryKey) ||
    new Set(entries.map((entry) => entry.entryKey)).size !== entries.length
  ) {
    throw new TypeError('Assistant rebuildable lookup bucket entries must be sorted and unique.')
  }
  if (entries.some((entry) => entry.entryKey.slice(65, 67) !== bucketId)) {
    throw new TypeError(
      'Assistant rebuildable lookup bucket entries must match the key-digest bucket.',
    )
  }
  return {
    bucketId,
    entries,
    generation: parseGeneration(value.generation),
    ownerDigest: parseSha256(value.ownerDigest, 'owner digest'),
  }
}

function parseAssistantRebuildableLookupBucketEntry(
  value: unknown,
): AssistantRebuildableLookupBucketEntryV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['entryKey', 'recordDigest'])) {
    throw new TypeError('Assistant rebuildable lookup bucket entry must be a strict object.')
  }
  const entryKey = typeof value.entryKey === 'string' &&
      /^[0-9a-f]{64}:[0-9a-f]{64}$/u.test(value.entryKey)
    ? value.entryKey
    : null
  if (!entryKey) {
    throw new TypeError('Assistant rebuildable lookup bucket entry key is invalid.')
  }
  return {
    entryKey,
    recordDigest: parseSha256(value.recordDigest, 'record digest'),
  }
}

function createEmptyBucket(input: {
  bucketId: string
  generation: string
  ownerDigest: string
}): AssistantRebuildableLookupBucketV1 {
  return {
    bucketId: input.bucketId,
    entries: [],
    generation: input.generation,
    ownerDigest: input.ownerDigest,
  }
}

function hashAssistantRebuildableLookupRecord(
  value: AssistantRebuildableLookupRecordV1,
): string {
  return hashJson([
    'murph.assistant-rebuildable-lookup-record-digest.v1',
    value,
  ])
}

function hashAssistantRebuildableLookupBucket(
  value: AssistantRebuildableLookupBucketV1,
): string {
  return hashJson([
    'murph.assistant-rebuildable-lookup-bucket-digest.v1',
    value,
  ])
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseGeneration(value: unknown): string {
  if (typeof value !== 'string' || !GENERATION_PATTERN.test(value)) {
    throw new TypeError('Assistant rebuildable lookup generation is invalid.')
  }
  return value
}

function assertGeneration(value: string): void {
  parseGeneration(value)
}

function parseSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`Assistant rebuildable lookup ${label} is invalid.`)
  }
  return value
}

function normalizeRequiredOpaqueValue(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Assistant rebuildable lookup ${label} must be nonempty.`)
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
