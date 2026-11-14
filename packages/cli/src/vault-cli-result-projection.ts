import { z } from 'incur'

// Every vault-scoped command result is read by the assistant model, and each
// byte stays in the turn context. These top-level fields only echo the caller's
// own vault root, internal storage locations, ids already present under another
// name, or filters that were never set, so the run wrapper removes them.
const incurSentinel = Symbol.for('incur.sentinel')
const omittedResultKeys = ['vault', 'ledgerFile'] as const

export function projectVaultCliRunResult(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }
  if (incurSentinel in value) {
    return value[incurSentinel] === 'ok'
      ? { ...value, data: projectVaultCliResult(value.data) }
      : value
  }
  return projectVaultCliResult(value)
}

function projectVaultCliResult(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  const result: Record<string, unknown> = { ...value }
  for (const key of omittedResultKeys) {
    if (typeof result[key] === 'string') {
      delete result[key]
    }
  }
  if (result.manifestFile === null) {
    delete result.manifestFile
  }
  if (typeof result.lookupId === 'string' && repeatsAnotherId(result, result.lookupId)) {
    delete result.lookupId
  }
  if (
    typeof result.path === 'string' &&
    isRecord(result.entity) &&
    result.entity.path === result.path
  ) {
    delete result.path
  }
  if (isRecord(result.filters)) {
    const filters = Object.fromEntries(
      Object.entries(result.filters).filter(([, filter]) => !isUnsetFilter(filter)),
    )
    if (Object.keys(filters).length > 0) {
      result.filters = filters
    } else {
      delete result.filters
    }
  }
  return result
}

// Keep `--schema` and MCP output schemas truthful about the projected result.
export function projectVaultCliOutputSchema(schema: unknown): unknown {
  return schema instanceof z.ZodType ? projectOutputSchema(schema) : schema
}

function projectOutputSchema(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodUnion) {
    const options = schema.options.map((option) =>
      option instanceof z.ZodType ? projectOutputSchema(option) : option,
    )
    return options.every((option, index) => option === schema.options[index])
      ? schema
      : withMetadataOf(schema, z.union(options))
  }
  return isPlainObjectSchema(schema)
    ? withMetadataOf(schema, projectObjectSchema(schema))
    : schema
}

function projectObjectSchema(schema: z.ZodObject): z.ZodObject {
  const shape = schema.shape
  const omitted: Partial<Record<(typeof omittedResultKeys)[number], true>> = {}
  for (const key of omittedResultKeys) {
    if (key in shape) {
      omitted[key] = true
    }
  }
  const relaxedKeys = ['lookupId', 'manifestFile', ...('entity' in shape ? ['path'] : [])]
  const relaxed: Record<string, z.ZodType> = Object.fromEntries(
    relaxedKeys.filter((key) => key in shape).map((key) => [key, shape[key].optional()]),
  )
  if (isPlainObjectSchema(shape.filters)) {
    relaxed.filters = shape.filters.partial().optional()
  }

  const withoutOmitted = Object.keys(omitted).length > 0 ? schema.omit(omitted) : schema
  return Object.keys(relaxed).length > 0 ? withoutOmitted.extend(relaxed) : withoutOmitted
}

// Rebuilt schemas drop registry metadata such as descriptions and MCP root types.
function withMetadataOf(source: z.ZodType, schema: z.ZodType): z.ZodType {
  if (schema === source) {
    return schema
  }
  const metadata = source.meta()
  return metadata === undefined ? schema : schema.meta(metadata)
}

function repeatsAnotherId(result: Record<string, unknown>, lookupId: string): boolean {
  return Object.entries(result).some(
    ([key, value]) => key !== 'lookupId' && key.endsWith('Id') && value === lookupId,
  )
}

function isUnsetFilter(value: unknown): boolean {
  return value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

// Zod forbids omit/extend on objects that carry refinements; leave those as declared.
function isPlainObjectSchema(schema: unknown): schema is z.ZodObject {
  return schema instanceof z.ZodObject && (schema._zod.def.checks?.length ?? 0) === 0
}

function isRecord(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Streams and other class instances pass through untouched.
function isPlainRecord(value: unknown): value is Record<string | symbol, unknown> {
  if (!isRecord(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
