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
  requiredByAction: Map<string, string[]>
} {
  const actions: string[] = []
  const properties = new Set<string>()
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
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: [...properties],
    requiredByAction,
  }
}

function modelShape(schema: JsonSchemaObject): {
  actions: string[]
  properties: string[]
  requiredByAction: Map<string, string[]>
} {
  const properties = asObject(schema.properties)
  const actions = asStringArray(asObject(properties.action).enum)
  const requiredByAction = new Map<string, string[]>()
  for (const branch of asObjectArray(schema.oneOf)) {
    const action = asObject(asObject(branch.properties).action).const
    expect(action).toBeTypeOf('string')
    if (typeof action !== 'string') {
      throw new TypeError('Expected an action literal.')
    }
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: Object.keys(properties),
    requiredByAction,
  }
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
    expect(model.requiredByAction).toEqual(canonical.requiredByAction)
    expect(collectKeys(MURPH_AUTOMATION_TOOL.inputSchema, '$ref')).toEqual([])
    expect(modelBytes).toBeLessThanOrEqual(Math.floor(canonicalBytes * 0.55))
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

  it('returns the full schema when the expected union shape is unsupported', () => {
    const unsupported = {
      type: 'object',
      properties: { action: { type: 'string' } },
    }
    expect(deriveAutomationModelInputSchema(unsupported)).toBe(unsupported)
  })
})
