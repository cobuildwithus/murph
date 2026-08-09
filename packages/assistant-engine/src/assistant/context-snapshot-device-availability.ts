import { isStrictIsoDate } from '@murphai/contracts'
import { listMetricPointsBatch } from '@murphai/query'
import {
  readVersionedJsonStateFile,
  writeAssistantStateVersionedJson,
} from '@murphai/runtime-state/node'

import {
  ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
  ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  readAssistantContextSnapshotState,
  resolveAssistantContextSnapshotPath,
  type AssistantContextSnapshotRefreshResult,
  type AssistantContextSnapshotState,
} from './context-snapshot.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'

const ASSISTANT_DEVICE_AVAILABILITY_SNAPSHOT_VERSION = 1
const ASSISTANT_DEVICE_AVAILABILITY_PROMPT_HEADER =
  'Canonical health-measurement availability for navigation only:'
const BODY_METRIC_KEYS = new Set([
  'body-fat-percentage',
  'body-weight',
])
const BLOOD_PRESSURE_METRIC_KEYS = new Set([
  'diastolic-blood-pressure',
  'systolic-blood-pressure',
])
const DEVICE_AVAILABILITY_METRIC_FILTERS = [
  { metricKey: 'body-fat-percentage', limit: 1 },
  { metricKey: 'body-weight', limit: 1 },
  { metricKey: 'diastolic-blood-pressure', limit: 1 },
  { metricKey: 'systolic-blood-pressure', limit: 1 },
] as const

type DeviceAvailabilityMetricPoint = Awaited<
  ReturnType<typeof listMetricPointsBatch>
>[number]

interface AssistantDeviceAvailabilitySnapshotState
  extends AssistantContextSnapshotState {
  deviceAvailabilitySnapshotVersion?: number
}

export interface AssistantDeviceAvailabilityRefreshInput {
  now?: (() => string) | null
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal | null
  vaultRoot: string
}

export async function isAssistantDeviceAvailabilitySnapshotRefreshPending(input: {
  vaultRoot: string
}): Promise<boolean> {
  const state = await readAssistantContextSnapshotState(input.vaultRoot)
  if (state?.lastCompleted === null || !state?.lastCompleted) {
    return false
  }
  if (state.pendingDirtyDomains.length > 0) {
    return false
  }

  return (
    await readAssistantDeviceAvailabilitySnapshotVersion(input.vaultRoot)
  ) !== ASSISTANT_DEVICE_AVAILABILITY_SNAPSHOT_VERSION
}

export async function refreshAssistantDeviceAvailabilitySnapshot(
  input: AssistantDeviceAvailabilityRefreshInput,
  coreResult: AssistantContextSnapshotRefreshResult,
): Promise<AssistantContextSnapshotRefreshResult> {
  if (assistantDeviceAvailabilityRefreshShouldYield(input)) {
    return coreResult
  }

  const startedState = await readAssistantContextSnapshotState(input.vaultRoot)
  if (
    !startedState?.lastCompleted
    || startedState.pendingDirtyDomains.length > 0
    || await readAssistantDeviceAvailabilitySnapshotVersion(input.vaultRoot)
      === ASSISTANT_DEVICE_AVAILABILITY_SNAPSHOT_VERSION
  ) {
    return coreResult
  }

  const deviceAvailabilityPrompt = await buildAssistantDeviceAvailabilityPrompt(input)
  if (assistantDeviceAvailabilityRefreshShouldYield(input)) {
    return coreResult
  }

  let wroteSnapshot = false
  await withAssistantRuntimeWriteLock(input.vaultRoot, async () => {
    const latestState = await readAssistantContextSnapshotState(input.vaultRoot)
    if (
      !latestState?.lastCompleted
      || latestState.pendingDirtyDomains.length > 0
      || latestState.dirtySequence !== startedState.dirtySequence
    ) {
      return
    }

    const basePrompt = stripAssistantDeviceAvailabilityPrompt(
      latestState.lastCompleted.promptBlock,
    )
    const promptBlock = joinPromptSections(basePrompt, deviceAvailabilityPrompt)
    const nextState: AssistantDeviceAvailabilitySnapshotState = {
      ...latestState,
      deviceAvailabilitySnapshotVersion:
        ASSISTANT_DEVICE_AVAILABILITY_SNAPSHOT_VERSION,
      lastCompleted: {
        ...latestState.lastCompleted,
        promptBlock,
      },
    }

    await writeAssistantStateVersionedJson({
      filePath: resolveAssistantContextSnapshotPath(input.vaultRoot),
      schema: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
      schemaVersion: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
      value: nextState,
    })
    wroteSnapshot = true
  })

  return wroteSnapshot
    ? {
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      }
    : coreResult
}

async function buildAssistantDeviceAvailabilityPrompt(
  input: AssistantDeviceAvailabilityRefreshInput,
): Promise<string | null> {
  const points = await listMetricPointsBatch(
    input.vaultRoot,
    DEVICE_AVAILABILITY_METRIC_FILTERS,
  )
  const bodyDate = latestEffectiveDate(
    points.filter((point) =>
      BODY_METRIC_KEYS.has(point.metricKey)
      && point.source.kind === 'wearable-summary',
    ),
  )
  const bloodPressureDate = latestEffectiveDate(
    points.filter((point) => BLOOD_PRESSURE_METRIC_KEYS.has(point.metricKey)),
  )
  const lines = [
    bodyDate
      ? `- Body/scale measurement history is available (latest canonical reading ${bodyDate}). Read canonical body summaries with \`vault-cli wearables body list --limit 30 --format json\`.`
      : null,
    bloodPressureDate
      ? `- Blood-pressure measurement history is available (latest canonical reading ${bloodPressureDate}). Read canonical events with \`vault-cli measurement list --from ${bloodPressureDate} --limit 100 --format json\`; inspect \`systolic-blood-pressure\` and \`diastolic-blood-pressure\` entries, treating values as paired only when they come from the same event, and widen the date range when needed.`
      : null,
  ].filter((line): line is string => Boolean(line))

  if (lines.length === 0) {
    return null
  }

  return [
    ASSISTANT_DEVICE_AVAILABILITY_PROMPT_HEADER,
    ...lines,
    '- Availability is not evidence of a current value. Query the canonical vault before quoting, comparing, or interpreting readings; do not use raw Junction artifacts unless canonical data is unexpectedly absent.',
  ].join('\n')
}

function latestEffectiveDate(
  points: readonly DeviceAvailabilityMetricPoint[],
): string | null {
  return points
    .map((point) => point.effectiveDate)
    .filter(isStrictIsoDate)
    .sort((left, right) => right.localeCompare(left))[0]
    ?? null
}

async function readAssistantDeviceAvailabilitySnapshotVersion(
  vaultRoot: string,
): Promise<number> {
  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath: resolveAssistantContextSnapshotPath(vaultRoot),
      label: 'assistant context snapshot device availability',
      parseValue(rawValue) {
        if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
          return 0
        }

        const version = (
          rawValue as { deviceAvailabilitySnapshotVersion?: unknown }
        ).deviceAvailabilitySnapshotVersion
        return typeof version === 'number' && Number.isInteger(version)
          ? version
          : 0
      },
      schema: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA,
      schemaVersion: ASSISTANT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    })
    return value
  } catch {
    return 0
  }
}

function stripAssistantDeviceAvailabilityPrompt(
  promptBlock: string | null,
): string | null {
  const normalized = normalizePromptSection(promptBlock)
  if (!normalized) {
    return null
  }

  if (normalized.startsWith(ASSISTANT_DEVICE_AVAILABILITY_PROMPT_HEADER)) {
    return null
  }

  const sectionSeparator = `\n\n${ASSISTANT_DEVICE_AVAILABILITY_PROMPT_HEADER}`
  const sectionIndex = normalized.lastIndexOf(sectionSeparator)
  return sectionIndex >= 0
    ? normalizePromptSection(normalized.slice(0, sectionIndex))
    : normalized
}

function joinPromptSections(
  left: string | null,
  right: string | null,
): string | null {
  const sections = [left, right]
    .map(normalizePromptSection)
    .filter((section): section is string => Boolean(section))
  return sections.length > 0 ? sections.join('\n\n') : null
}

function normalizePromptSection(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function assistantDeviceAvailabilityRefreshShouldYield(
  input: AssistantDeviceAvailabilityRefreshInput,
): boolean {
  return input.signal?.aborted === true || input.shouldYield?.() === true
}
