type JsonSchemaObject = Record<string, unknown>

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
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

function mergePropertySchemas(schemas: JsonSchemaObject[]): JsonSchemaObject {
  const unique = [...new Map(schemas.map((schema) => {
    const semanticSchema = withoutTopLevelDescription(schema)
    return [schemaKey(semanticSchema), semanticSchema] as const
  })).values()]
  let merged: JsonSchemaObject
  if (unique.length === 1) {
    merged = unique[0]
  } else {
    const covering = unique.find((candidate) =>
      unique.every((other) => schemaCovers(candidate, other)))
    merged = covering ?? { anyOf: unique }
  }
  return merged
}

function buildActionPropertyConstraint(
  actionSchema: JsonSchemaObject,
  mergedSchema: JsonSchemaObject,
): JsonSchemaObject {
  const actionSemanticSchema = withoutTopLevelDescription(actionSchema)
  const mergedSemanticSchema = withoutTopLevelDescription(mergedSchema)
  const semanticConstraint = schemaKey(actionSemanticSchema) === schemaKey(
    mergedSemanticSchema,
  )
    ? {}
    : actionSemanticSchema
  return semanticConstraint
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
  if (containsReference(canonicalSchema)) {
    return canonicalSchema
  }

  const branches = canonicalSchema.oneOf
  if (!Array.isArray(branches) || branches.length === 0) {
    return canonicalSchema
  }

  const actions: string[] = []
  const propertyOrder: string[] = []
  const propertyVariants = new Map<string, JsonSchemaObject[]>()
  const branchByAction: Array<{
    action: string
    properties: JsonSchemaObject
    required: string[]
  }> = []

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

    branchByAction.push({
      action,
      properties: branch.properties,
      required: branch.required,
    })
  }

  const properties: JsonSchemaObject = {
    action: {
      enum: actions,
    },
  }
  for (const name of propertyOrder) {
    const variants = propertyVariants.get(name)
    if (!variants || variants.length === 0) {
      return canonicalSchema
    }
    properties[name] = mergePropertySchemas(variants)
  }

  const actionContracts: JsonSchemaObject[] = []
  for (const branch of branchByAction) {
    const actionProperties: JsonSchemaObject = {
      action: { const: branch.action },
    }
    for (const [name, propertySchema] of Object.entries(branch.properties)) {
      if (name === 'action' || !isJsonSchemaObject(propertySchema)) {
        continue
      }
      const mergedSchema = properties[name]
      if (!isJsonSchemaObject(mergedSchema)) {
        return canonicalSchema
      }
      actionProperties[name] = buildActionPropertyConstraint(
        propertySchema,
        mergedSchema,
      )
    }
    actionContracts.push({
      properties: actionProperties,
      required: branch.required,
      additionalProperties: false,
    })
  }

  const modelSchema: JsonSchemaObject = {
    type: 'object',
    properties,
    required: ['action'],
    oneOf: actionContracts,
    additionalProperties: false,
  }
  return containsReference(modelSchema) ? canonicalSchema : modelSchema
}

export const AUTOMATION_PATCH_MUTATION_KEYS = [
  'activeUntil',
  'assistantTargetOverride',
  'continuityPolicy',
  'contextReferences',
  'instructions',
  'plannedOccurrenceOffsetMs',
  'retargetToCurrentConversation',
  'schedule',
  'slug',
  'status',
  'summary',
  'supportKind',
  'supportSeriesId',
  'tags',
  'title',
] as const

/**
 * Zod refinements are not represented by z.toJSONSchema. Restore the existing
 * rules that fit Codex's compact supported schema subset; conditional support
 * ownership and recovery coupling remain explicit in the description and full
 * runtime validation feedback.
 */
export function addAutomationModelInputRefinementConstraints(
  modelSchema: JsonSchemaObject,
): JsonSchemaObject {
  const properties = requireJsonSchemaObject(
    modelSchema.properties,
    'automation model properties',
  )
  addNonemptyTargetOverrideConstraint(properties.assistantTargetOverride)
  addExactlyOneLocalDateConstraint(properties.schedule)

  const branches = requireJsonSchemaObjectArray(
    modelSchema.oneOf,
    'automation action contracts',
  )
  for (const branch of branches) {
    const branchProperties = requireJsonSchemaObject(
      branch.properties,
      'automation action properties',
    )
    const action = requireJsonSchemaObject(
      branchProperties.action,
      'automation action property',
    ).const
    if (action !== 'patch') {
      continue
    }
    branch.allOf = [{
      anyOf: AUTOMATION_PATCH_MUTATION_KEYS.map((key) => ({ required: [key] })),
    }]
  }
  return modelSchema
}

function addNonemptyTargetOverrideConstraint(value: unknown): void {
  const schema = requireJsonSchemaObject(value, 'assistantTargetOverride schema')
  const objectBranch = requireJsonSchemaObjectArray(
    schema.anyOf,
    'assistantTargetOverride variants',
  ).find((branch) => branch.type === 'object')
  if (!objectBranch) {
    throw new Error('Automation target override object schema is missing.')
  }
  objectBranch.anyOf = [
    { required: ['model'] },
    { required: ['reasoningEffort'] },
  ]
}

function addExactlyOneLocalDateConstraint(value: unknown): void {
  const schema = requireJsonSchemaObject(value, 'automation schedule schema')
  const localAtSchedule = requireJsonSchemaObjectArray(
    schema.anyOf,
    'automation schedule variants',
  ).find((branch) => {
    const properties = isJsonSchemaObject(branch.properties)
      ? branch.properties
      : null
    const kind = properties && isJsonSchemaObject(properties.kind)
      ? properties.kind
      : null
    return kind?.const === 'at'
  })
  if (!localAtSchedule) {
    throw new Error('Automation local-at schedule schema is missing.')
  }
  const localAt = requireJsonSchemaObject(
    requireJsonSchemaObject(
      localAtSchedule.properties,
      'automation local-at schedule properties',
    ).localAt,
    'automation local-at schema',
  )
  localAt.oneOf = [
    { required: ['date'] },
    { required: ['relativeDay'] },
  ]
}

function requireJsonSchemaObject(
  value: unknown,
  label: string,
): JsonSchemaObject {
  if (!isJsonSchemaObject(value)) {
    throw new TypeError(`Expected ${label}.`)
  }
  return value
}

function requireJsonSchemaObjectArray(
  value: unknown,
  label: string,
): JsonSchemaObject[] {
  if (!Array.isArray(value) || !value.every(isJsonSchemaObject)) {
    throw new TypeError(`Expected ${label}.`)
  }
  return value
}
