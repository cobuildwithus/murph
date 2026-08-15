import { createHash } from 'node:crypto'

import * as z from '@murphai/contracts/zod-runtime'

export const SAFE_TOOL_CALL_VALIDATION_DIGEST_SCHEMA =
  'murph.tool-call-validation-digest.v1'

export interface SafeToolCallValidationDigest {
  [key: string]: unknown
  detailsSchema: typeof SAFE_TOOL_CALL_VALIDATION_DIGEST_SCHEMA
  toolName?: string
  requestedToolNameSafe?: string
  schemaName?: string
  schemaFingerprint?: string
  validationFingerprint: string
  rootType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'unknown'
  rootKeysPresent?: string[]
  rootKeyCount?: number
  unsafeRootKeyCount?: number
  missingPaths?: string[]
  unknownKeyCount?: number
  invalidPaths?: string[]
  issueCodes?: string[]
  pathIssues?: Array<{
    path: string
    code: string
    expected?: string
    received?: string
  }>
  inputShape?: string[]
}

interface BuildSafeToolCallValidationDigestInput {
  error: unknown
  rawInput: unknown
  requestedToolName?: string | null
  schemaFingerprint?: string | null
  schemaName?: string | null
  schemaPaths?: readonly string[] | null
  schemaRootKeys?: readonly string[] | null
  toolName?: string | null
}

interface ValidationFacts {
  invalidPaths: string[]
  issueCodes: string[]
  missingPaths: string[]
  pathIssues: NonNullable<SafeToolCallValidationDigest['pathIssues']>
  unknownKeyCount: number
}

const MAX_ROOT_KEYS = 16
const MAX_PATHS = 16
const MAX_ISSUE_CODES = 12
const MAX_PATH_ISSUES = 12
const MAX_INPUT_SHAPE = 16
const MAX_SCHEMA_PATHS = 256
const MAX_SCHEMA_PATH_DEPTH = 16
const MAX_SCHEMA_NODES = 1_024
const MAX_FLATTENED_ISSUES = 64
const MAX_ISSUE_NESTING_DEPTH = 8
const MAX_UNION_BRANCHES = 8

export function buildSafeToolCallValidationDigest(
  input: BuildSafeToolCallValidationDigestInput,
): SafeToolCallValidationDigest {
  const rootType = getRootType(input.rawInput)
  const rootRecord = asRecord(input.rawInput)
  const rootKeys = rootRecord ? Object.keys(rootRecord) : []
  const schemaRootKeySet = normalizeSchemaRootKeySet(input.schemaRootKeys)
  const schemaPathSet = normalizeSchemaPathSet(input.schemaPaths)
  const schemaRootKeysPresent = schemaRootKeySet
    ? uniqueSorted(rootKeys.filter((key) => schemaRootKeySet.has(key))).slice(0, MAX_ROOT_KEYS)
    : []
  const unsafeRootKeyCount = schemaRootKeySet
    ? rootKeys.length - schemaRootKeysPresent.length
    : rootKeys.length
  const inputShape = buildInputShape(input.rawInput, schemaRootKeysPresent)
  const facts = readValidationFacts(
    input.error,
    input.rawInput,
    schemaRootKeySet,
    schemaPathSet,
  )

  const fingerprintFacts = {
    invalidPaths: facts.invalidPaths,
    issueCodes: facts.issueCodes,
    missingPaths: facts.missingPaths,
    pathIssues: facts.pathIssues,
    rootKeyCount: rootKeys.length,
    rootKeysPresent: schemaRootKeysPresent,
    rootType,
    schemaFingerprint: normalizeSafeIdentifier(input.schemaFingerprint),
    toolName: normalizeSafeIdentifier(input.toolName),
    unknownKeyCount: facts.unknownKeyCount,
    unsafeRootKeyCount,
  }
  const validationFingerprint = `tvd_${hashJson(fingerprintFacts).slice(0, 12)}`

  return omitEmptyFields({
    detailsSchema: SAFE_TOOL_CALL_VALIDATION_DIGEST_SCHEMA,
    toolName: normalizeSafeIdentifier(input.toolName),
    requestedToolNameSafe: normalizeSafeIdentifier(input.requestedToolName),
    schemaName: normalizeSafeIdentifier(input.schemaName),
    schemaFingerprint: normalizeSafeIdentifier(input.schemaFingerprint),
    validationFingerprint,
    rootType,
    rootKeysPresent: schemaRootKeysPresent,
    rootKeyCount: rootKeys.length > 0 ? rootKeys.length : undefined,
    unsafeRootKeyCount: unsafeRootKeyCount > 0
      ? unsafeRootKeyCount
      : undefined,
    missingPaths: facts.missingPaths,
    unknownKeyCount: facts.unknownKeyCount > 0 ? facts.unknownKeyCount : undefined,
    invalidPaths: facts.invalidPaths,
    issueCodes: facts.issueCodes,
    pathIssues: facts.pathIssues,
    inputShape,
  })
}

export function isSafeSchemaLikeKey(key: string): boolean {
  if (key.length < 2 || key.length > 64) {
    return false
  }
  return (
    /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/.test(key) ||
    /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(key)
  )
}

/**
 * Collect trusted validation paths from a provider-facing JSON schema.
 *
 * The returned paths contain only schema property names plus the `[]` array
 * marker. They are safe to use as an allowlist for Zod issue paths because no
 * submitted input is consulted while building them.
 */
export function collectSafeJsonSchemaValidationPaths(schema: unknown): string[] {
  const paths = new Set<string>()
  let nodeCount = 0

  const visit = (
    value: unknown,
    segments: string[],
    ancestors: ReadonlySet<object>,
  ): void => {
    if (
      paths.size >= MAX_SCHEMA_PATHS ||
      nodeCount >= MAX_SCHEMA_NODES ||
      segments.length > MAX_SCHEMA_PATH_DEPTH
    ) {
      return
    }
    const record = asRecord(value)
    if (!record || ancestors.has(record)) {
      return
    }
    nodeCount += 1
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(record)

    const properties = asRecord(record.properties)
    const patternProperties = asRecord(record.patternProperties)
    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!isSafeSchemaLikeKey(key) || paths.size >= MAX_SCHEMA_PATHS) {
          continue
        }
        const propertySegments = [...segments, key]
        paths.add(formatSchemaPath(propertySegments))
        visit(propertySchema, propertySegments, nextAncestors)

        if (patternProperties) {
          for (const [pattern, patternSchema] of Object.entries(patternProperties)) {
            if (matchesSchemaPropertyPattern(key, pattern)) {
              visit(patternSchema, propertySegments, nextAncestors)
            }
          }
        }
      }
    }

    if (record.items !== undefined) {
      const itemSegments = [...segments, '[]']
      paths.add(formatSchemaPath(itemSegments))
      visit(record.items, itemSegments, nextAncestors)
    }

    for (const branchKey of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = record[branchKey]
      if (!Array.isArray(branches)) {
        continue
      }
      for (const branch of branches) {
        visit(branch, segments, nextAncestors)
      }
    }
  }

  visit(schema, [], new Set())
  return uniqueSorted([...paths]).slice(0, MAX_SCHEMA_PATHS)
}

function readValidationFacts(
  error: unknown,
  rawInput: unknown,
  schemaRootKeySet: ReadonlySet<string> | null,
  schemaPathSet: ReadonlySet<string> | null,
): ValidationFacts {
  if (!(error instanceof z.ZodError)) {
    return {
      invalidPaths: [],
      issueCodes: ['validation_failed'],
      missingPaths: [],
      pathIssues: [],
      unknownKeyCount: 0,
    }
  }

  const missingPaths: string[] = []
  let unknownKeyCount = 0
  const invalidPaths: string[] = []
  const issueCodes: string[] = []
  const pathIssues: NonNullable<SafeToolCallValidationDigest['pathIssues']> = []

  const issues = schemaPathSet
    ? flattenZodValidationIssues(error.issues)
    : error.issues
  for (const issue of issues) {
    const issueRecord = asRecord(issue)
    const path = normalizeIssuePath(
      issueRecord?.path,
      schemaRootKeySet,
      schemaPathSet,
    )
    const rawCode = typeof issueRecord?.code === 'string' ? issueRecord.code : null

    if (rawCode === 'unrecognized_keys') {
      const parentPath = path && path !== 'root' ? path : null
      const keys = Array.isArray(issueRecord?.keys) ? issueRecord.keys : []
      let recognizedUnknownKeyCount = 0
      for (const keyValue of keys) {
        if (typeof keyValue !== 'string') {
          continue
        }
        unknownKeyCount += 1
        recognizedUnknownKeyCount += 1
      }
      if (recognizedUnknownKeyCount > 0) {
        pathIssues.push({
          path: parentPath ?? 'root',
          code: 'unrecognized_key',
          received: `keys.${bucketCount(recognizedUnknownKeyCount)}`,
        })
      }
      issueCodes.push('unrecognized_key')
      continue
    }

    if (!path) {
      issueCodes.push(normalizeIssueCode(rawCode, null))
      continue
    }

    const received = describeValueShape(readValueAtPath(rawInput, issueRecord?.path))
    const code = normalizeIssueCode(rawCode, received)
    issueCodes.push(code)

    if (code === 'missing_required') {
      missingPaths.push(path)
    } else {
      invalidPaths.push(path)
    }

    pathIssues.push(omitEmptyFields({
      path,
      code,
      expected: describeExpectedShape(issueRecord),
      received: received ?? undefined,
    }))
  }

  return {
    invalidPaths: uniqueSorted(invalidPaths).slice(0, MAX_PATHS),
    issueCodes: uniqueSorted(issueCodes).slice(0, MAX_ISSUE_CODES),
    missingPaths: uniqueSorted(missingPaths).slice(0, MAX_PATHS),
    pathIssues: dedupePathIssues(pathIssues).slice(0, MAX_PATH_ISSUES),
    unknownKeyCount,
  }
}

function normalizeIssueCode(
  rawCode: string | null,
  received: string | null,
): string {
  if (rawCode === 'invalid_type' && received === 'undefined') {
    return 'missing_required'
  }
  if (!rawCode) {
    return 'validation_failed'
  }
  const normalized = rawCode.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized.length > 0 && normalized.length <= 64
    ? normalized
    : 'validation_failed'
}

function describeExpectedShape(issue: Record<string, unknown> | null): string | undefined {
  const code = typeof issue?.code === 'string' ? issue.code : null
  const origin = typeof issue?.origin === 'string' ? normalizeShapeToken(issue.origin) : null
  if ((code === 'too_small' || code === 'too_big') && origin) {
    const bound = typeof issue?.minimum === 'number'
      ? issue.minimum
      : typeof issue?.maximum === 'number'
        ? issue.maximum
        : null
    if (bound !== null && Number.isFinite(bound)) {
      return `${origin}.${code === 'too_small' ? 'min' : 'max'}_${Math.max(0, Math.min(10_000, Math.trunc(bound)))}`
    }
    return origin
  }

  if (typeof issue?.expected === 'string') {
    return normalizeShapeToken(issue.expected) ?? undefined
  }

  return origin ?? undefined
}

function buildInputShape(rawInput: unknown, safeRootKeys: string[]): string[] | undefined {
  const shape = [`root.${describeValueShape(rawInput) ?? 'unknown'}`]
  const rootRecord = asRecord(rawInput)
  if (rootRecord) {
    for (const key of safeRootKeys.slice(0, MAX_INPUT_SHAPE - 1)) {
      shape.push(`${key}.${describeValueShape(rootRecord[key]) ?? 'unknown'}`)
    }
  }
  return shape.length > 0 ? shape.slice(0, MAX_INPUT_SHAPE) : undefined
}

function readValueAtPath(rawInput: unknown, rawPath: unknown): unknown {
  if (!Array.isArray(rawPath) || rawPath.length === 0) {
    return rawInput
  }

  let current = rawInput
  for (const segment of rawPath) {
    if (typeof segment === 'string') {
      const record = asRecord(current)
      if (!record || !(segment in record)) {
        return undefined
      }
      current = record[segment]
      continue
    }
    if (typeof segment === 'number' && Number.isInteger(segment)) {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return undefined
      }
      current = current[segment]
      continue
    }
    return undefined
  }
  return current
}

function normalizeIssuePath(
  rawPath: unknown,
  schemaRootKeySet: ReadonlySet<string> | null,
  schemaPathSet: ReadonlySet<string> | null,
): string | null {
  if (!Array.isArray(rawPath) || rawPath.length === 0) {
    return 'root'
  }

  const segments: string[] = []
  for (const [index, segment] of rawPath.entries()) {
    if (typeof segment === 'string') {
      if (!isSafeSchemaLikeKey(segment)) {
        return null
      }
      if (index === 0) {
        if (!schemaRootKeySet || !schemaRootKeySet.has(segment)) {
          return null
        }
      } else if (!schemaPathSet) {
        return null
      }
      segments.push(segment)
      continue
    }
    if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) {
      segments.push('[]')
      continue
    }
    return null
  }

  const path = formatSchemaPath(segments)
  return !schemaPathSet || schemaPathSet.has(path) ? path : null
}

function normalizeSchemaRootKeySet(keys: readonly string[] | null | undefined): ReadonlySet<string> | null {
  if (!keys || keys.length === 0) {
    return null
  }
  return new Set(keys.filter(isSafeSchemaLikeKey).slice(0, MAX_ROOT_KEYS))
}

function normalizeSchemaPathSet(
  paths: readonly string[] | null | undefined,
): ReadonlySet<string> | null {
  if (!paths || paths.length === 0) {
    return null
  }
  const normalized = paths
    .map(normalizeSchemaPath)
    .filter((path): path is string => path !== null)
    .slice(0, MAX_SCHEMA_PATHS)
  return normalized.length > 0 ? new Set(normalized) : null
}

function flattenZodValidationIssues(
  issues: readonly unknown[],
  parentPath: readonly unknown[] = [],
  depth = 0,
  output: unknown[] = [],
): unknown[] {
  for (const issue of issues) {
    if (output.length >= MAX_FLATTENED_ISSUES) {
      break
    }
    const issueRecord = asRecord(issue)
    if (!issueRecord) {
      output.push(issue)
      continue
    }
    const issuePath = Array.isArray(issueRecord.path) ? issueRecord.path : []
    const path = pathStartsWith(issuePath, parentPath)
      ? issuePath
      : [...parentPath, ...issuePath]
    const unionErrors = issueRecord.errors
    if (
      issueRecord.code === 'invalid_union' &&
      Array.isArray(unionErrors) &&
      depth < MAX_ISSUE_NESTING_DEPTH
    ) {
      const nestedIssueStart = output.length
      for (const branchIssues of unionErrors.slice(0, MAX_UNION_BRANCHES)) {
        if (Array.isArray(branchIssues)) {
          flattenZodValidationIssues(
            branchIssues,
            path,
            depth + 1,
            output,
          )
        }
      }
      if (output.length > nestedIssueStart) {
        continue
      }
    }
    output.push({ ...issueRecord, path })
  }
  return output
}

function pathStartsWith(
  path: readonly unknown[],
  prefix: readonly unknown[],
): boolean {
  return prefix.every((segment, index) => path[index] === segment)
}

function normalizeSchemaPath(path: string): string | null {
  if (path.length === 0 || path.length > 512) {
    return null
  }
  const segments: string[] = []
  for (const rawSegment of path.split('.')) {
    if (rawSegment === '[]') {
      segments.push(rawSegment)
      continue
    }
    const hasArrayMarker = rawSegment.endsWith('[]')
    const property = hasArrayMarker ? rawSegment.slice(0, -2) : rawSegment
    if (!isSafeSchemaLikeKey(property)) {
      return null
    }
    segments.push(property)
    if (hasArrayMarker) {
      segments.push('[]')
    }
  }
  return segments.length <= MAX_SCHEMA_PATH_DEPTH
    ? formatSchemaPath(segments)
    : null
}

function formatSchemaPath(segments: readonly string[]): string {
  return segments.reduce((path, segment) => {
    if (segment === '[]') {
      return `${path}[]`
    }
    return path.length === 0 ? segment : `${path}.${segment}`
  }, '')
}

function matchesSchemaPropertyPattern(key: string, pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 256) {
    return false
  }
  try {
    return new RegExp(pattern, 'u').test(key)
  } catch {
    return false
  }
}

function describeValueShape(value: unknown): string | null {
  if (value === undefined) {
    return 'undefined'
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return `string.${bucketLength(value.length)}`
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : 'number.nonfinite'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  if (Array.isArray(value)) {
    return `array.${bucketCount(value.length)}`
  }
  if (typeof value === 'object') {
    return `object.${bucketCount(Object.keys(value).length)}`
  }
  return 'unknown'
}

function getRootType(
  value: unknown,
): SafeToolCallValidationDigest['rootType'] {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  switch (typeof value) {
    case 'object':
      return 'object'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
  }
  return 'unknown'
}

function bucketLength(length: number): string {
  if (length === 0) {
    return 'len_0'
  }
  if (length <= 32) {
    return 'len_1_32'
  }
  if (length <= 128) {
    return 'len_33_128'
  }
  if (length <= 512) {
    return 'len_129_512'
  }
  return 'len_gt_512'
}

function bucketCount(count: number): string {
  if (count === 0) {
    return 'count_0'
  }
  if (count <= 10) {
    return 'count_1_10'
  }
  if (count <= 100) {
    return 'count_11_100'
  }
  return 'count_gt_100'
}

function normalizeSafeIdentifier(value: string | null | undefined): string | undefined {
  if (!value || value.length > 128) {
    return undefined
  }
  return /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)
    ? value
    : undefined
}

function normalizeShapeToken(value: string): string | null {
  const normalized = value.replace(/[^a-z0-9_]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '')
  return normalized.length > 0 && normalized.length <= 64 ? normalized : null
}

function dedupePathIssues(
  issues: NonNullable<SafeToolCallValidationDigest['pathIssues']>,
): NonNullable<SafeToolCallValidationDigest['pathIssues']> {
  const byKey = new Map<string, NonNullable<SafeToolCallValidationDigest['pathIssues']>[number]>()
  for (const issue of issues) {
    const key = JSON.stringify(issue)
    if (!byKey.has(key)) {
      byKey.set(key, issue)
    }
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`),
  )
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function omitEmptyFields<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    const current = value[key]
    if (current === undefined) {
      delete value[key]
      continue
    }
    if (Array.isArray(current) && current.length === 0) {
      delete value[key]
    }
  }
  return value
}
