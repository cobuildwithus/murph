import { open, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
  type ContractSchema,
  allergyFrontmatterSchema,
  conditionFrontmatterSchema,
  goalFrontmatterSchema,
  regimenFrontmatterSchema,
  safeParseContract,
  type RegimenFrontmatter,
} from '@murphai/contracts'
import {
  parseFrontmatterDocument,
  resolveVaultPath,
  VAULT_LAYOUT,
  walkVaultFilesInterruptible,
  type HostedCanonicalWriteReceipt,
} from '@murphai/core'
import {
  readVersionedJsonStateFile,
  writeAssistantStateVersionedJson,
} from '@murphai/runtime-state/node'

import {
  buildAssistantActiveExperimentContextBlock,
} from './active-experiment-context.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError, normalizeNullableString } from './shared.js'
import { resolveAssistantStatePaths } from './store/paths.js'

export const ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA =
  'murph.assistant-context-snapshot'
export const ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION = 1
export const ASSISTANT_CONTEXT_SNAPSHOT_FILE_NAME = 'context-snapshot.json'

export const ASSISTANT_CONTEXT_SNAPSHOT_DIRTY_DOMAINS = [
  'experiments',
  'blood_tests',
  'health_context',
] as const

export type AssistantContextSnapshotDirtyDomain =
  (typeof ASSISTANT_CONTEXT_SNAPSHOT_DIRTY_DOMAINS)[number]

export interface AssistantContextSnapshotCompleted {
  generatedAt: string
  includedDomains: readonly AssistantContextSnapshotDirtyDomain[]
  promptBlock: string | null
  sectionPresence: AssistantContextSnapshotSectionPresence
  sourceDirtySequence: number
}

export interface AssistantContextSnapshotSectionPresence {
  activeExperiments: boolean
  bloodTests: boolean
  healthContext: boolean
}

export interface AssistantContextSnapshotRefreshAttempt {
  attemptedAt: string
  errorCode: string | null
  status: 'failed' | 'succeeded'
}

export interface AssistantContextSnapshotState {
  dirtySequence: number
  lastCompleted: AssistantContextSnapshotCompleted | null
  lastRefreshAttempt: AssistantContextSnapshotRefreshAttempt | null
  pendingDirtyDomains: readonly AssistantContextSnapshotDirtyDomain[]
}

export interface AssistantContextSnapshotRefreshResult {
  pendingDirtyDomains: readonly AssistantContextSnapshotDirtyDomain[]
  refreshed: boolean
  skipped: boolean
}

type AssistantContextSnapshotBuildResult = Pick<
  AssistantContextSnapshotCompleted,
  'includedDomains' | 'promptBlock' | 'sectionPresence'
>

const ASSISTANT_CONTEXT_SNAPSHOT_ALL_DOMAINS =
  ['experiments', 'blood_tests', 'health_context'] as const

const BLOOD_TEST_SPECIMEN_TYPE_SET = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES)
const MAX_ASSISTANT_CONTEXT_SNAPSHOT_PROMPT_BYTES = 64 * 1024
const MAX_ASSISTANT_CONTEXT_FRONTMATTER_FILES_PER_DIR = 200
const MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_FILES = 3
const MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_BYTES = 256 * 1024
const MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_LINES = 5000

export function resolveAssistantContextSnapshotPath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    ASSISTANT_CONTEXT_SNAPSHOT_FILE_NAME,
  )
}

export async function readAssistantContextSnapshotPrompt(input: {
  allowSensitiveHealthContext: boolean
  vaultRoot: string
}): Promise<string | null> {
  if (!input.allowSensitiveHealthContext) {
    return null
  }

  const { state } = await readAssistantContextSnapshotStateStatus({
    maxBytes: MAX_ASSISTANT_CONTEXT_SNAPSHOT_PROMPT_BYTES,
    vaultRoot: input.vaultRoot,
  })
  return normalizeNullableString(state?.lastCompleted?.promptBlock)
}

export async function isAssistantContextSnapshotRefreshPending(input: {
  vaultRoot: string
}): Promise<boolean> {
  return assistantContextSnapshotNeedsRefresh(
    await readAssistantContextSnapshotStateStatus({
      vaultRoot: input.vaultRoot,
    }),
  )
}

export async function markAssistantContextSnapshotDirty(input: {
  domains: readonly AssistantContextSnapshotDirtyDomain[]
  vaultRoot: string
}): Promise<void> {
  const domains = normalizeDirtyDomains(input.domains)
  if (domains.length === 0) {
    return
  }

  await withAssistantRuntimeWriteLock(input.vaultRoot, async () => {
    const current = await readAssistantContextSnapshotState(input.vaultRoot)
    const next = mergeAssistantContextSnapshotDirtyState(current, domains)
    await writeAssistantContextSnapshotState(input.vaultRoot, next)
  })
}

export async function refreshAssistantContextSnapshot(input: {
  now?: (() => string) | null
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal | null
  vaultRoot: string
}): Promise<AssistantContextSnapshotRefreshResult> {
  const startedRead = await readAssistantContextSnapshotStateStatus({
    vaultRoot: input.vaultRoot,
  })
  if (!assistantContextSnapshotNeedsRefresh(startedRead)) {
    return {
      pendingDirtyDomains: [],
      refreshed: false,
      skipped: true,
    }
  }

  assertAssistantContextSnapshotCanContinue(input)
  const built = await buildAssistantContextSnapshotPrompt({
    shouldYield: input.shouldYield ?? null,
    signal: input.signal ?? null,
    vaultRoot: input.vaultRoot,
  })
  const attemptedAt = resolveSnapshotTimestamp(input.now)
  const startedDirtySequence = startedRead.state?.dirtySequence ?? 0

  return await withAssistantRuntimeWriteLock(input.vaultRoot, async () => {
    const latest =
      await readAssistantContextSnapshotState(input.vaultRoot)
      ?? createEmptyAssistantContextSnapshotState()
    const concurrentDirty = latest.dirtySequence > startedDirtySequence
    const pendingDirtyDomains = concurrentDirty
      ? latest.pendingDirtyDomains
      : []
    const sourceDirtySequence = concurrentDirty
      ? startedDirtySequence
      : latest.dirtySequence
    const next: AssistantContextSnapshotState = {
      dirtySequence: latest.dirtySequence,
      lastCompleted: {
        generatedAt: attemptedAt,
        includedDomains: built.includedDomains,
        promptBlock: built.promptBlock,
        sectionPresence: built.sectionPresence,
        sourceDirtySequence,
      },
      lastRefreshAttempt: {
        attemptedAt,
        errorCode: null,
        status: 'succeeded',
      },
      pendingDirtyDomains,
    }

    await writeAssistantContextSnapshotState(input.vaultRoot, next)

    return {
      pendingDirtyDomains,
      refreshed: true,
      skipped: false,
    }
  })
}

export async function refreshAssistantContextSnapshotBestEffort(input: {
  now?: (() => string) | null
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal | null
  vaultRoot: string
}): Promise<AssistantContextSnapshotRefreshResult> {
  try {
    return await refreshAssistantContextSnapshot(input)
  } catch (error) {
    if (isAssistantContextSnapshotPreemptionError(error)) {
      const current = await readAssistantContextSnapshotState(input.vaultRoot)
      const pendingDirtyDomains = current?.pendingDirtyDomains ?? []
      return {
        pendingDirtyDomains,
        refreshed: false,
        skipped: pendingDirtyDomains.length === 0,
      }
    }
    await recordAssistantContextSnapshotRefreshFailureBestEffort({
      error,
      now: input.now ?? null,
      vaultRoot: input.vaultRoot,
    })
    const current = await readAssistantContextSnapshotState(input.vaultRoot)
    const pendingDirtyDomains = current?.pendingDirtyDomains ?? []
    return {
      pendingDirtyDomains,
      refreshed: false,
      skipped: false,
    }
  }
}

export function listAssistantContextSnapshotDirtyDomainsForCanonicalWrite(
  receipt: Pick<HostedCanonicalWriteReceipt, 'actions'>,
): AssistantContextSnapshotDirtyDomain[] {
  const domains = new Set<AssistantContextSnapshotDirtyDomain>()
  for (const action of receipt.actions) {
    for (const domain of listAssistantContextSnapshotDirtyDomainsForPath(
      action.targetRelativePath,
    )) {
      domains.add(domain)
    }
  }

  return [...domains].sort(compareDirtyDomains)
}

export function listAssistantContextSnapshotDirtyDomainsForPath(
  relativePath: string,
): AssistantContextSnapshotDirtyDomain[] {
  const normalized = normalizeDirtyRelativePath(relativePath)
  if (!normalized) {
    return []
  }

  if (isPathUnder(normalized, VAULT_LAYOUT.auditDirectory)) {
    return []
  }

  if (isPathUnder(normalized, VAULT_LAYOUT.experimentsDirectory)) {
    return ['experiments']
  }

  if (
    isPathUnder(normalized, VAULT_LAYOUT.goalsDirectory)
    || isPathUnder(normalized, VAULT_LAYOUT.conditionsDirectory)
    || isPathUnder(normalized, VAULT_LAYOUT.allergiesDirectory)
    || isPathUnder(normalized, VAULT_LAYOUT.regimensDirectory)
  ) {
    return ['health_context']
  }

  if (isPathUnder(normalized, VAULT_LAYOUT.eventLedgerDirectory)) {
    return ['blood_tests']
  }

  return []
}

export async function readAssistantContextSnapshotState(
  vaultRoot: string,
): Promise<AssistantContextSnapshotState | null> {
  return (await readAssistantContextSnapshotStateStatus({ vaultRoot })).state
}

async function readAssistantContextSnapshotStateStatus(input: {
  maxBytes?: number
  vaultRoot: string
}): Promise<{
  exists: boolean
  state: AssistantContextSnapshotState | null
}> {
  const currentPath = resolveAssistantContextSnapshotPath(input.vaultRoot)
  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath,
      label: 'assistant context snapshot',
      parseValue: parseAssistantContextSnapshotState,
      schema: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
      schemaVersion: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    }, input.maxBytes
      ? {
          readFile(filePath) {
            return readBoundedTextFile(filePath, input.maxBytes ?? 0)
          },
        }
      : undefined)
    return {
      exists: true,
      state: value,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        exists: false,
        state: null,
      }
    }
    return {
      exists: true,
      state: null,
    }
  }
}

async function buildAssistantContextSnapshotPrompt(input: {
  shouldYield: (() => boolean) | null
  signal: AbortSignal | null
  vaultRoot: string
}): Promise<AssistantContextSnapshotBuildResult> {
  assertAssistantContextSnapshotCanContinue(input)
  const activeExperimentContext =
    await buildAssistantActiveExperimentContextBlock(input.vaultRoot, {
      shouldYield: input.shouldYield,
      signal: input.signal,
    })
  assertAssistantContextSnapshotCanContinue(input)
  const coverage = await buildAssistantSnapshotCoverage(input)
  assertAssistantContextSnapshotCanContinue(input)

  const lines = [
    'Assistant context snapshot for navigation only:',
    '- This is a compact, possibly stale snapshot. Treat it as orientation, not canonical evidence.',
    '- Before making factual claims about current values, dates, counts, progress, or outcomes, query the relevant vault surface.',
    coverage.bloodTestsLine,
    coverage.healthContextLine,
    coverage.regimensLine,
  ].filter((line): line is string => Boolean(line))

  const promptBlock = [
    lines.length > 3 ? lines.join('\n') : null,
    activeExperimentContext,
  ].filter((section): section is string =>
    Boolean(normalizeNullableString(section)),
  ).join('\n\n')

  return {
    includedDomains: ASSISTANT_CONTEXT_SNAPSHOT_ALL_DOMAINS,
    promptBlock: normalizeNullableString(promptBlock),
    sectionPresence: {
      activeExperiments: activeExperimentContext !== null,
      bloodTests: coverage.bloodTestCount > 0,
      healthContext:
        coverage.goalCount > 0
        || coverage.conditionCount > 0
        || coverage.allergyCount > 0
        || coverage.regimenCount > 0,
    },
  }
}

async function buildAssistantSnapshotCoverage(input: {
  shouldYield: (() => boolean) | null
  signal: AbortSignal | null
  vaultRoot: string
}): Promise<{
  allergyCount: number
  bloodTestCount: number
  bloodTestsLine: string | null
  conditionCount: number
  goalCount: number
  healthContextLine: string | null
  regimenCount: number
  regimensLine: string | null
  supplementCount: number
}> {
  const eventCoverage = await collectAssistantSnapshotEventLedgerCoverage(input)
  const goals = await listAssistantSnapshotFrontmatterRecords(
    input,
    VAULT_LAYOUT.goalsDirectory,
    goalFrontmatterSchema,
  )
  const conditions = await listAssistantSnapshotFrontmatterRecords(
    input,
    VAULT_LAYOUT.conditionsDirectory,
    conditionFrontmatterSchema,
  )
  const allergies = await listAssistantSnapshotFrontmatterRecords(
    input,
    VAULT_LAYOUT.allergiesDirectory,
    allergyFrontmatterSchema,
  )
  const regimens = await listAssistantSnapshotFrontmatterRecords(
    input,
    VAULT_LAYOUT.regimensDirectory,
    regimenFrontmatterSchema,
  )
  const supplementCount = regimens.filter(isSupplementRegimen).length
  const healthParts = [
    summarizePositiveCount(goals.length, 'goal'),
    summarizePositiveCount(conditions.length, 'condition'),
    summarizePositiveCount(allergies.length, 'allergy'),
  ].filter((part): part is string => Boolean(part))
  const regimenParts = [
    summarizePositiveCount(regimens.length, 'regimen record'),
    summarizePositiveCount(supplementCount, 'supplement'),
  ].filter((part): part is string => Boolean(part))

  return {
    allergyCount: allergies.length,
    bloodTestCount: eventCoverage.bloodTestCount,
    bloodTestsLine: eventCoverage.bloodTestCount > 0
      ? '- Blood test records are present.'
      : null,
    conditionCount: conditions.length,
    goalCount: goals.length,
    healthContextLine: healthParts.length > 0
      ? `- Saved health context includes ${joinWithAnd(healthParts)}.`
      : null,
    regimenCount: regimens.length,
    regimensLine: regimenParts.length > 0
      ? `- Bank coverage includes ${joinWithAnd(regimenParts)}.`
      : null,
    supplementCount,
  }
}

async function listAssistantSnapshotFrontmatterRecords<TRecord>(
  input: {
    shouldYield: (() => boolean) | null
    signal: AbortSignal | null
    vaultRoot: string
  },
  relativeDirectory: string,
  schema: ContractSchema<TRecord>,
): Promise<TRecord[]> {
  assertAssistantContextSnapshotCanContinue(input)
  const { relativePaths } = await walkVaultFilesInterruptible(
    input.vaultRoot,
    relativeDirectory,
    {
      extension: '.md',
      maxMatches: MAX_ASSISTANT_CONTEXT_FRONTMATTER_FILES_PER_DIR,
      shouldContinue: () => {
        assertAssistantContextSnapshotCanContinue(input)
        return true
      },
    },
  )
  const records: TRecord[] = []

  for (const relativePath of relativePaths) {
    assertAssistantContextSnapshotCanContinue(input)
    try {
      const resolved = resolveVaultPath(input.vaultRoot, relativePath)
      const document = parseFrontmatterDocument(
        await readFile(resolved.absolutePath, 'utf8'),
      )
      assertAssistantContextSnapshotCanContinue(input)
      const result = safeParseContract(schema, document.attributes)
      if (result.success) {
        records.push(result.data)
      }
    } catch (error) {
      if (isAssistantContextSnapshotPreemptionError(error)) {
        throw error
      }
      continue
    }
  }

  return records
}

async function collectAssistantSnapshotEventLedgerCoverage(input: {
  shouldYield: (() => boolean) | null
  signal: AbortSignal | null
  vaultRoot: string
}): Promise<{
  bloodTestCount: number
}> {
  assertAssistantContextSnapshotCanContinue(input)
  const { relativePaths } = await walkVaultFilesInterruptible(
    input.vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    {
      extension: '.jsonl',
      maxMatches: MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_FILES,
      shouldContinue: () => {
        assertAssistantContextSnapshotCanContinue(input)
        return true
      },
      sortOrder: 'descending',
    },
  )
  let bloodTestCount = 0
  let lineCount = 0

  for (const relativePath of relativePaths) {
    assertAssistantContextSnapshotCanContinue(input)
    const resolved = resolveVaultPath(input.vaultRoot, relativePath)
    const raw = await readTailTextFile(
      resolved.absolutePath,
      MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_BYTES,
    )
    for (const line of raw.split('\n')) {
      assertAssistantContextSnapshotCanContinue(input)
      if (lineCount >= MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_LINES) {
        break
      }
      lineCount += 1
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      const record = parseJsonRecord(trimmed)
      if (!record) {
        continue
      }
      if (isBloodTestEventRecord(record)) {
        bloodTestCount += 1
        break
      }
    }
    if (
      bloodTestCount > 0
      || lineCount >= MAX_ASSISTANT_CONTEXT_EVENT_LEDGER_LINES
    ) {
      break
    }
  }

  return {
    bloodTestCount,
  }
}

async function recordAssistantContextSnapshotRefreshFailureBestEffort(input: {
  error: unknown
  now: (() => string) | null
  vaultRoot: string
}): Promise<void> {
  try {
    await withAssistantRuntimeWriteLock(input.vaultRoot, async () => {
      const current =
        await readAssistantContextSnapshotState(input.vaultRoot)
        ?? createEmptyAssistantContextSnapshotState()
      await writeAssistantContextSnapshotState(input.vaultRoot, {
        ...current,
        lastRefreshAttempt: {
          attemptedAt: resolveSnapshotTimestamp(input.now),
          errorCode: deriveSnapshotRefreshErrorCode(input.error),
          status: 'failed',
        },
      })
    })
  } catch {
    return
  }
}

async function writeAssistantContextSnapshotState(
  vaultRoot: string,
  state: AssistantContextSnapshotState,
): Promise<void> {
  await writeAssistantStateVersionedJson({
    filePath: resolveAssistantContextSnapshotPath(vaultRoot),
    schema: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
    schemaVersion: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    value: state,
  })
}

function assistantContextSnapshotNeedsRefresh(
  read: {
    exists: boolean
    state: AssistantContextSnapshotState | null
  },
): boolean {
  return read.exists
    && (read.state === null
    || read.state.lastCompleted === null
    || read.state.pendingDirtyDomains.length > 0
    )
}

function mergeAssistantContextSnapshotDirtyState(
  state: AssistantContextSnapshotState | null,
  domains: readonly AssistantContextSnapshotDirtyDomain[],
): AssistantContextSnapshotState {
  const current = state ?? createEmptyAssistantContextSnapshotState()
  const pendingDirtyDomains = normalizeDirtyDomains([
    ...current.pendingDirtyDomains,
    ...domains,
  ])
  return {
    ...current,
    dirtySequence: current.dirtySequence + 1,
    pendingDirtyDomains,
  }
}

function createEmptyAssistantContextSnapshotState(): AssistantContextSnapshotState {
  return {
    dirtySequence: 0,
    lastCompleted: null,
    lastRefreshAttempt: null,
    pendingDirtyDomains: [],
  }
}

function parseAssistantContextSnapshotState(
  value: unknown,
): AssistantContextSnapshotState {
  if (!isPlainRecord(value)) {
    throw new TypeError('assistant context snapshot value must be an object.')
  }

  return {
    dirtySequence: parseNonNegativeInteger(value.dirtySequence),
    lastCompleted: parseCompletedSnapshot(value.lastCompleted),
    lastRefreshAttempt: parseRefreshAttempt(value.lastRefreshAttempt),
    pendingDirtyDomains: parseDirtyDomains(value.pendingDirtyDomains),
  }
}

function parseCompletedSnapshot(
  value: unknown,
): AssistantContextSnapshotCompleted | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!isPlainRecord(value)) {
    throw new TypeError('assistant context snapshot lastCompleted must be an object.')
  }

  const generatedAt = parseRequiredString(value.generatedAt)
  const promptBlock = parseNullableString(value.promptBlock)
  const sectionPresence = parseSectionPresence(value.sectionPresence)

  return {
    generatedAt,
    includedDomains: parseDirtyDomains(value.includedDomains),
    promptBlock,
    sectionPresence,
    sourceDirtySequence: parseNonNegativeInteger(value.sourceDirtySequence),
  }
}

function parseSectionPresence(
  value: unknown,
): AssistantContextSnapshotSectionPresence {
  if (!isPlainRecord(value)) {
    throw new TypeError('assistant context snapshot sectionPresence must be an object.')
  }

  return {
    activeExperiments: value.activeExperiments === true,
    bloodTests: value.bloodTests === true,
    healthContext: value.healthContext === true,
  }
}

function parseRefreshAttempt(
  value: unknown,
): AssistantContextSnapshotRefreshAttempt | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!isPlainRecord(value)) {
    throw new TypeError('assistant context snapshot lastRefreshAttempt must be an object.')
  }
  const status = value.status
  if (status !== 'failed' && status !== 'succeeded') {
    throw new TypeError('assistant context snapshot refresh status is invalid.')
  }

  return {
    attemptedAt: parseRequiredString(value.attemptedAt),
    errorCode: parseNullableString(value.errorCode),
    status,
  }
}

function parseDirtyDomains(
  value: unknown,
): AssistantContextSnapshotDirtyDomain[] {
  if (!Array.isArray(value)) {
    return []
  }

  return normalizeDirtyDomains(
    value.filter((entry): entry is AssistantContextSnapshotDirtyDomain =>
      typeof entry === 'string' && isAssistantContextSnapshotDirtyDomain(entry),
    ),
  )
}

function normalizeDirtyDomains(
  domains: readonly AssistantContextSnapshotDirtyDomain[],
): AssistantContextSnapshotDirtyDomain[] {
  return [...new Set(domains)].sort(compareDirtyDomains)
}

function isAssistantContextSnapshotDirtyDomain(
  value: string,
): value is AssistantContextSnapshotDirtyDomain {
  return ASSISTANT_CONTEXT_SNAPSHOT_DIRTY_DOMAINS.some(
    (domain) => domain === value,
  )
}

function compareDirtyDomains(
  left: AssistantContextSnapshotDirtyDomain,
  right: AssistantContextSnapshotDirtyDomain,
): number {
  return ASSISTANT_CONTEXT_SNAPSHOT_DIRTY_DOMAINS.indexOf(left)
    - ASSISTANT_CONTEXT_SNAPSHOT_DIRTY_DOMAINS.indexOf(right)
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('assistant context snapshot field must be a string.')
  }
  return value
}

function parseNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseNonNegativeInteger(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
  ) {
    return 0
  }

  return value
}

function isSupplementRegimen(regimen: RegimenFrontmatter): boolean {
  return normalizeToken(regimen.kind) === 'supplement'
}

function isBloodTestEventRecord(record: Record<string, unknown>): boolean {
  if (firstString(record, ['kind']) !== 'test') {
    return false
  }

  const testCategory = firstString(record, ['testCategory'])
  const specimenType = firstString(record, ['specimenType'])

  return testCategory === BLOOD_TEST_CATEGORY
    || (specimenType !== null && BLOOD_TEST_SPECIMEN_TYPE_SET.has(specimenType))
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line)
    return isPlainRecord(value) ? value : null
  } catch {
    return null
  }
}

function firstString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) {
    return null
  }

  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function normalizeToken(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)
  return normalized ? normalized.toLowerCase() : null
}

function summarizePositiveCount(count: number, noun: string): string | null {
  return count > 0 ? `${count} ${noun}${count === 1 ? '' : 's'}` : null
}

function joinWithAnd(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? ''
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`
  }

  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function normalizeDirtyRelativePath(relativePath: string): string | null {
  const normalized = relativePath
    .replace(/\\/gu, '/')
    .replace(/^\/+/u, '')
    .replace(/\/+/gu, '/')
    .replace(/\/$/u, '')
    .trim()
  return normalized.length > 0 ? normalized : null
}

function isPathUnder(relativePath: string, relativeRoot: string): boolean {
  return relativePath === relativeRoot || relativePath.startsWith(`${relativeRoot}/`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveSnapshotTimestamp(now: (() => string) | null | undefined): string {
  return now?.() ?? new Date().toISOString()
}

function deriveSnapshotRefreshErrorCode(error: unknown): string | null {
  if (
    error
    && typeof error === 'object'
    && 'name' in error
    && typeof error.name === 'string'
    && error.name.trim().length > 0
  ) {
    return error.name
  }

  return null
}

function isAssistantContextSnapshotPreemptionError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && error.name === 'AbortError',
  )
}

function assertAssistantContextSnapshotCanContinue(input: {
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal | null
}): void {
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new DOMException('Assistant context snapshot refresh aborted.', 'AbortError')
  }
  if (input.shouldYield?.() === true) {
    throw new DOMException(
      'Assistant context snapshot refresh yielded to foreground input.',
      'AbortError',
    )
  }
}

async function readBoundedTextFile(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    if (stats.size > maxBytes) {
      throw new TypeError('assistant context snapshot file is too large.')
    }
    const buffer = Buffer.alloc(stats.size)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readTailTextFile(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    const byteLength = Math.min(stats.size, maxBytes)
    const buffer = Buffer.alloc(byteLength)
    const start = Math.max(0, stats.size - byteLength)
    const { bytesRead } = await handle.read(buffer, 0, byteLength, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
