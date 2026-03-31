import { loadJsonInputObject } from '@murph/assistant-core/json-input'
import { VaultCliError } from '@murph/assistant-core/vault-cli-errors'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}

interface ApplyRecordPatchInput {
  record: JsonObject
  inputFile?: string
  set?: readonly string[]
  clear?: readonly string[]
  patchLabel: string
}

interface ApplyRecordPatchResult {
  record: JsonObject
  clearedFields: ReadonlySet<string>
  touchedTopLevelFields: ReadonlySet<string>
}

export async function applyRecordPatch(
  input: ApplyRecordPatchInput,
): Promise<ApplyRecordPatchResult> {
  if (
    typeof input.inputFile !== 'string' &&
    (!Array.isArray(input.set) || input.set.length === 0) &&
    (!Array.isArray(input.clear) || input.clear.length === 0)
  ) {
    throw new VaultCliError(
      'invalid_payload',
      'Edit requires at least one mutation source: --input, --set, or --clear.',
    )
  }

  const filePatch =
    typeof input.inputFile === 'string'
      ? (await loadJsonInputObject(input.inputFile, input.patchLabel)) as JsonObject
      : null

  let nextRecord: JsonObject = structuredClone(input.record)
  const touchedTopLevelFields = new Set<string>()

  if (filePatch) {
    for (const key of Object.keys(filePatch)) {
      touchedTopLevelFields.add(key)
    }
    nextRecord = mergeObject(nextRecord, filePatch)
  }

  for (const assignment of input.set ?? []) {
    const { path, value } = parsePathAssignment(assignment)
    touchedTopLevelFields.add(path[0] as string)
    nextRecord = setPathValue(nextRecord, path, value) as JsonObject
  }

  for (const clearPath of input.clear ?? []) {
    const path = parsePathSegments(clearPath)
    touchedTopLevelFields.add(path[0] as string)
    nextRecord = clearPathValue(nextRecord, path) as JsonObject
  }

  const prunedRecord = pruneEmptyObjects(nextRecord)

  return {
    record: prunedRecord,
    clearedFields: computeClearedTopLevelFields(input.record, prunedRecord),
    touchedTopLevelFields,
  }
}

export function computeClearedTopLevelFields(
  original: JsonObject,
  patched: JsonObject,
): ReadonlySet<string> {
  const clearedFields = new Set<string>()

  for (const key of Object.keys(original)) {
    if (!(key in patched)) {
      clearedFields.add(key)
    }
  }

  return clearedFields
}

function mergeObject(target: JsonObject, patch: JsonObject): JsonObject {
  const next: JsonObject = { ...target }

  for (const [key, value] of Object.entries(patch)) {
    next[key] = mergeValue(next[key], value)
  }

  return next
}

function mergeValue(existing: JsonValue | undefined, patch: JsonValue): JsonValue {
  if (isPlainObject(existing) && isPlainObject(patch)) {
    return mergeObject(existing, patch)
  }

  return structuredClone(patch)
}

function parsePathAssignment(input: string): { path: string[]; value: JsonValue } {
  const separatorIndex = input.indexOf('=')

  if (separatorIndex <= 0) {
    throw new VaultCliError(
      'invalid_payload',
      `Path assignment "${input}" must use dotted.path=value form.`,
    )
  }

  return {
    path: parsePathSegments(input.slice(0, separatorIndex)),
    value: parseAssignmentValue(input.slice(separatorIndex + 1)),
  }
}

function parsePathSegments(input: string): string[] {
  const segments = input
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Patch paths may not be empty.',
    )
  }

  return segments
}

function parseAssignmentValue(input: string): JsonValue {
  const trimmed = input.trim()

  if (trimmed === 'null') {
    return null
  }

  if (trimmed === 'true') {
    return true
  }

  if (trimmed === 'false') {
    return false
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(trimmed)) {
    return Number(trimmed)
  }

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as JsonValue
      if (isJsonValue(parsed)) {
        return parsed
      }
    } catch {
      // Fall back to the raw string form below.
    }
  }

  return trimmed
}

function parseIndex(segment: string): number | null {
  return /^\d+$/u.test(segment) ? Number(segment) : null
}

function setPathValue(
  current: JsonValue | undefined,
  path: readonly string[],
  value: JsonValue,
): JsonValue {
  if (path.length === 0) {
    return structuredClone(value)
  }

  const [head, ...tail] = path
  const index = parseIndex(head)

  if (index !== null) {
    const nextArray = Array.isArray(current) ? [...current] : []
    nextArray[index] = setPathValue(nextArray[index] as JsonValue | undefined, tail, value)
    return nextArray as JsonValue
  }

  const nextObject: JsonObject = isPlainObject(current) ? { ...current } : {}
  nextObject[head] = setPathValue(nextObject[head], tail, value)
  return nextObject
}

function clearPathValue(
  current: JsonValue | undefined,
  path: readonly string[],
): JsonValue | undefined {
  if (current === undefined || path.length === 0) {
    return current
  }

  const [head, ...tail] = path
  const index = parseIndex(head)

  if (index !== null) {
    if (!Array.isArray(current)) {
      return current
    }

    const nextArray = [...current]
    if (tail.length === 0) {
      nextArray.splice(index, 1)
      return nextArray as JsonValue
    }

    nextArray[index] = clearPathValue(nextArray[index] as JsonValue | undefined, tail) as JsonValue
    return nextArray as JsonValue
  }

  if (!isPlainObject(current)) {
    return current
  }

  const nextObject: JsonObject = { ...current }
  if (tail.length === 0) {
    delete nextObject[head]
    return nextObject
  }

  if (head in nextObject) {
    const nextValue = clearPathValue(nextObject[head], tail)
    if (nextValue === undefined) {
      delete nextObject[head]
    } else {
      nextObject[head] = nextValue
    }
  }

  return nextObject
}

function pruneEmptyObjects(value: JsonObject): JsonObject {
  const pruned = pruneValue(value)
  return (pruned ?? {}) as JsonObject
}

function pruneValue(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map((entry) => pruneValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined)
  }

  if (!isPlainObject(value)) {
    return value
  }

  const entries = Object.entries(value)
    .map(([key, entry]) => [key, pruneValue(entry)] as const)
    .filter(([, entry]) => entry !== undefined)

  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries) as JsonObject
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry))
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every((entry) => isJsonValue(entry))
}
