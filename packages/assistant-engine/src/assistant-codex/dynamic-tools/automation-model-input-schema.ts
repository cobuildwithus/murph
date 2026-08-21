type JsonSchemaObject = Record<string, unknown>

type ResolveResult =
  | { ok: true; value: unknown }
  | { ok: false }

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

function resolveJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return undefined
  }

  let current: unknown = root
  for (const rawToken of ref.slice(2).split('/')) {
    const token = decodeJsonPointerToken(rawToken)
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(token)) {
        return undefined
      }
      current = current[Number.parseInt(token, 10)]
      continue
    }
    if (!isJsonSchemaObject(current) || !Object.hasOwn(current, token)) {
      return undefined
    }
    current = current[token]
  }
  return current
}

function resolveLocalReferences(
  value: unknown,
  root: JsonSchemaObject,
  activeRefs: ReadonlySet<string>,
): ResolveResult {
  if (Array.isArray(value)) {
    const resolved: unknown[] = []
    for (const item of value) {
      const result = resolveLocalReferences(item, root, activeRefs)
      if (!result.ok) {
        return result
      }
      resolved.push(result.value)
    }
    return { ok: true, value: resolved }
  }

  if (!isJsonSchemaObject(value)) {
    return { ok: true, value }
  }

  if (Object.hasOwn(value, '$ref')) {
    const ref = value.$ref
    if (typeof ref !== 'string' || activeRefs.has(ref)) {
      return { ok: false }
    }
    const target = resolveJsonPointer(root, ref)
    if (target === undefined) {
      return { ok: false }
    }
    const nextRefs = new Set(activeRefs)
    nextRefs.add(ref)
    const resolvedTarget = resolveLocalReferences(target, root, nextRefs)
    if (!resolvedTarget.ok || !isJsonSchemaObject(resolvedTarget.value)) {
      return { ok: false }
    }

    const siblings: JsonSchemaObject = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref') {
        continue
      }
      const result = resolveLocalReferences(item, root, activeRefs)
      if (!result.ok || Object.hasOwn(resolvedTarget.value, key)) {
        return { ok: false }
      }
      siblings[key] = result.value
    }
    return {
      ok: true,
      value: { ...resolvedTarget.value, ...siblings },
    }
  }

  const resolved: JsonSchemaObject = {}
  for (const [key, item] of Object.entries(value)) {
    const result = resolveLocalReferences(item, root, activeRefs)
    if (!result.ok) {
      return result
    }
    resolved[key] = result.value
  }
  return { ok: true, value: resolved }
}

function withoutTopLevelDescription(schema: JsonSchemaObject): JsonSchemaObject {
  const result: JsonSchemaObject = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'description') {
      result[key] = value
    }
  }
  return result
}

function schemaKey(value: unknown): string {
  return JSON.stringify(value)
}

function schemaAlternatives(schema: JsonSchemaObject): unknown[] {
  const normalized = withoutTopLevelDescription(schema)
  if (
    Object.keys(normalized).length === 1
    && Array.isArray(normalized.anyOf)
  ) {
    return normalized.anyOf
  }
  return [normalized]
}

function schemaCovers(
  candidate: JsonSchemaObject,
  other: JsonSchemaObject,
): boolean {
  const candidateKeys = new Set(schemaAlternatives(candidate).map(schemaKey))
  return schemaAlternatives(other).every((item) => candidateKeys.has(schemaKey(item)))
}

function descriptionLength(schema: JsonSchemaObject): number {
  return typeof schema.description === 'string' ? schema.description.length : 0
}

function mergePropertySchemas(schemas: JsonSchemaObject[]): JsonSchemaObject {
  const unique = [...new Map(schemas.map((schema) => [schemaKey(schema), schema])).values()]
  if (unique.length === 1) {
    return unique[0]
  }

  const covering = unique
    .filter((candidate) => unique.every((other) => schemaCovers(candidate, other)))
    .sort((left, right) => descriptionLength(right) - descriptionLength(left))
  if (covering[0]) {
    return covering[0]
  }

  return { anyOf: unique }
}

function containsReference(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsReference)
  }
  if (!isJsonSchemaObject(value)) {
    return false
  }
  return Object.entries(value).some(
    ([key, item]) => key === '$ref' || containsReference(item),
  )
}

export function deriveAutomationModelInputSchema(
  canonicalSchema: JsonSchemaObject,
): JsonSchemaObject {
  const resolved = resolveLocalReferences(canonicalSchema, canonicalSchema, new Set())
  if (!resolved.ok || !isJsonSchemaObject(resolved.value)) {
    return canonicalSchema
  }

  const branches = resolved.value.oneOf
  if (!Array.isArray(branches) || branches.length === 0) {
    return canonicalSchema
  }

  const actions: string[] = []
  const propertyOrder: string[] = []
  const propertyVariants = new Map<string, JsonSchemaObject[]>()
  const requiredByAction: JsonSchemaObject[] = []
  const actionDescriptions: JsonSchemaObject[] = []

  for (const branch of branches) {
    if (
      !isJsonSchemaObject(branch)
      || branch.type !== 'object'
      || branch.additionalProperties !== false
      || !isJsonSchemaObject(branch.properties)
      || !isStringArray(branch.required)
      || !branch.required.includes('action')
    ) {
      return canonicalSchema
    }

    const actionSchema = branch.properties.action
    if (
      !isJsonSchemaObject(actionSchema)
      || typeof actionSchema.const !== 'string'
      || actions.includes(actionSchema.const)
    ) {
      return canonicalSchema
    }
    const action = actionSchema.const
    actions.push(action)
    actionDescriptions.push(actionSchema)

    for (const [name, propertySchema] of Object.entries(branch.properties)) {
      if (!isJsonSchemaObject(propertySchema)) {
        return canonicalSchema
      }
      if (name === 'action') {
        continue
      }
      if (!propertyVariants.has(name)) {
        propertyOrder.push(name)
        propertyVariants.set(name, [])
      }
      propertyVariants.get(name)?.push(propertySchema)
    }

    requiredByAction.push({
      properties: { action: { const: action } },
      required: branch.required,
    })
  }

  const actionDescription = actionDescriptions
    .filter((schema) => typeof schema.description === 'string')
    .sort((left, right) => descriptionLength(right) - descriptionLength(left))[0]
    ?.description
  const properties: JsonSchemaObject = {
    action: {
      type: 'string',
      enum: actions,
      ...(typeof actionDescription === 'string'
        ? { description: actionDescription }
        : {}),
    },
  }
  for (const name of propertyOrder) {
    const variants = propertyVariants.get(name)
    if (!variants || variants.length === 0) {
      return canonicalSchema
    }
    properties[name] = mergePropertySchemas(variants)
  }

  const modelSchema: JsonSchemaObject = {
    ...(typeof resolved.value.$schema === 'string'
      ? { $schema: resolved.value.$schema }
      : {}),
    type: 'object',
    properties,
    required: ['action'],
    oneOf: requiredByAction,
    additionalProperties: false,
  }
  return containsReference(modelSchema) ? canonicalSchema : modelSchema
}
