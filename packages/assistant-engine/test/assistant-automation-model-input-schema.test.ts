import { describe, expect, it } from 'vitest'

import { deriveAutomationModelInputSchema } from '../src/assistant-codex/dynamic-tools/automation-model-input-schema.js'
import {
  MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA,
  MURPH_AUTOMATION_TOOL,
} from '../src/assistant-codex/dynamic-tools/automation.js'

type JsonSchemaObject = Record<string, unknown>

function asObject(value: unknown): JsonSchemaObject {
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  return value as JsonSchemaObject
}

function asObjectArray(value: unknown): JsonSchemaObject[] {
  expect(Array.isArray(value)).toBe(true)
  return (value as unknown[]).map(asObject)
}

function asStringArray(value: unknown): string[] {
  expect(Array.isArray(value)).toBe(true)
  const result = value as unknown[]
  expect(result.every((item) => typeof item === 'string')).toBe(true)
  return result.filter((item): item is string => typeof item === 'string')
}

function canonicalShape(schema: JsonSchemaObject): {
  actions: string[]
  properties: string[]
  allowedByAction: Map<string, string[]>
  requiredByAction: Map<string, string[]>
} {
  const actions: string[] = []
  const properties = new Set<string>()
  const allowedByAction = new Map<string, string[]>()
  const requiredByAction = new Map<string, string[]>()
  for (const branch of asObjectArray(schema.oneOf)) {
    const branchProperties = asObject(branch.properties)
    for (const property of Object.keys(branchProperties)) {
      properties.add(property)
    }
    const action = asObject(branchProperties.action).const
    expect(action).toBeTypeOf('string')
    if (typeof action !== 'string') {
      throw new TypeError('Expected an action literal.')
    }
    actions.push(action)
    allowedByAction.set(action, Object.keys(branchProperties))
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: [...properties],
    allowedByAction,
    requiredByAction,
  }
}

function modelShape(schema: JsonSchemaObject): {
  actions: string[]
  properties: string[]
  allowedByAction: Map<string, string[]>
  requiredByAction: Map<string, string[]>
} {
  const properties = asObject(schema.properties)
  const actions = asStringArray(asObject(properties.action).enum)
  const allowedByAction = new Map<string, string[]>()
  const requiredByAction = new Map<string, string[]>()
  for (const branch of asObjectArray(schema.oneOf)) {
    const branchProperties = asObject(branch.properties)
    const action = asObject(branchProperties.action).const
    expect(action).toBeTypeOf('string')
    if (typeof action !== 'string') {
      throw new TypeError('Expected an action literal.')
    }
    allowedByAction.set(action, Object.keys(branchProperties))
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: Object.keys(properties),
    allowedByAction,
    requiredByAction,
  }
}

function actionContract(
  schema: JsonSchemaObject,
  action: string,
): JsonSchemaObject {
  const contract = asObjectArray(schema.oneOf).find((branch) => {
    const properties = asObject(branch.properties)
    return asObject(properties.action).const === action
  })
  expect(contract).toBeDefined()
  if (!contract) {
    throw new Error(`Missing compact contract for ${action}.`)
  }
  return contract
}

function advertisesRootShape(
  schema: JsonSchemaObject,
  value: JsonSchemaObject,
): boolean {
  const action = value.action
  if (typeof action !== 'string') {
    return false
  }
  const branch = asObjectArray(schema.oneOf).find((candidate) => {
    const properties = asObject(candidate.properties)
    return asObject(properties.action).const === action
  })
  if (!branch) {
    return false
  }
  const allowed = new Set(Object.keys(asObject(branch.properties)))
  const required = asStringArray(branch.required)
  return (
    Object.keys(value).every((name) => allowed.has(name))
    && required.every((name) => Object.hasOwn(value, name))
  )
}

function collectKeys(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeys(item, key))
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }
  return Object.entries(value).flatMap(([entryKey, item]) => [
    ...(entryKey === key ? [item] : []),
    ...collectKeys(item, key),
  ])
}

describe('automation model input schema', () => {
  it('derives a compact complete advertisement from the canonical runtime schema', () => {
    const canonical = canonicalShape(MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA)
    const model = modelShape(MURPH_AUTOMATION_TOOL.inputSchema)
    const canonicalBytes = Buffer.byteLength(
      JSON.stringify(MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA),
    )
    const modelBytes = Buffer.byteLength(
      JSON.stringify(MURPH_AUTOMATION_TOOL.inputSchema),
    )

    expect(MURPH_AUTOMATION_TOOL.inputSchema).not.toBe(
      MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA,
    )
    expect(MURPH_AUTOMATION_TOOL.inputSchema).toMatchObject({
      type: 'object',
      required: ['action'],
      additionalProperties: false,
    })
    expect(model.actions).toEqual(canonical.actions)
    expect(model.properties).toEqual(canonical.properties)
    expect(model.allowedByAction).toEqual(canonical.allowedByAction)
    expect(model.requiredByAction).toEqual(canonical.requiredByAction)
    expect(collectKeys(MURPH_AUTOMATION_TOOL.inputSchema, '$ref')).toEqual([])
    expect(modelBytes).toBeLessThanOrEqual(Math.floor(canonicalBytes * 0.55))
  })

  it('advertises strict action-specific root contracts', () => {
    const schema = MURPH_AUTOMATION_TOOL.inputSchema

    expect(advertisesRootShape(schema, {
      action: 'inspect',
      lookup: 'morning-reminder',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'inspect',
      lookup: 'morning-reminder',
      status: 'archived',
    })).toBe(false)
    expect(advertisesRootShape(schema, {
      action: 'save_onboarding_first_personal_read',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'save_onboarding_first_personal_read',
      title: 'Not accepted by the canonical action',
    })).toBe(false)
    expect(advertisesRootShape(schema, {
      action: 'save',
      instructions: 'A useful reminder.',
      schedule: { kind: 'every', everyMs: 3_600_000 },
      title: 'Useful reminder',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'patch',
      expectedUpdatedAt: '2026-08-21T10:00:00.000Z',
      lookup: 'morning-reminder',
      status: 'archived',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'reconcile',
      desiredAutomationIds: [],
      supportSeriesId: 'weekly-plan',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'dismiss_local_at_recovery',
      localAtRecoveryKey: 'recovery-key',
      resolvedLocalDate: '2026-08-21',
    })).toBe(true)

    const rootLookup = asObject(asObject(schema.properties).lookup)
    expect(rootLookup).not.toHaveProperty('description')
    expect(asObject(asObject(actionContract(schema, 'inspect').properties).lookup))
      .toEqual({})
    expect(asObject(asObject(actionContract(schema, 'patch').properties).lookup))
      .toEqual({})
  })

  it('resolves local references before building the inline model schema', () => {
    const canonical = {
      $defs: {
        title: { type: 'string', minLength: 1 },
      },
      oneOf: [
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'save' },
            title: { $ref: '#/$defs/title' },
          },
          required: ['action', 'title'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'patch' },
            title: { $ref: '#/$defs/title' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      ],
    }

    const model = deriveAutomationModelInputSchema(canonical)
    expect(model).not.toBe(canonical)
    expect(collectKeys(model, '$ref')).toEqual([])
    expect(asObject(asObject(model.properties).title)).toEqual({
      type: 'string',
      minLength: 1,
    })
  })

  it('retains action-specific value schemas when variants differ', () => {
    const canonical = {
      oneOf: [
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'save' },
            value: { type: 'string', minLength: 1 },
          },
          required: ['action', 'value'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { type: 'string', const: 'patch' },
            value: { type: 'number', minimum: 0 },
          },
          required: ['action', 'value'],
          additionalProperties: false,
        },
      ],
    }

    const model = deriveAutomationModelInputSchema(canonical)
    expect(asObject(asObject(actionContract(model, 'save').properties).value))
      .toEqual({ type: 'string', minLength: 1 })
    expect(asObject(asObject(actionContract(model, 'patch').properties).value))
      .toEqual({ type: 'number', minimum: 0 })
  })

  it('returns the full schema when the expected union shape is unsupported', () => {
    const unsupported = {
      type: 'object',
      properties: { action: { type: 'string' } },
    }
    expect(deriveAutomationModelInputSchema(unsupported)).toBe(unsupported)
  })
})
