import { describe, expect, it } from 'vitest'
import { automationDeviceActivitySourceValues } from '@murphai/contracts'

import { deriveAutomationModelInputSchema } from '../src/assistant-codex/dynamic-tools/automation-model-input-schema.js'
import {
  MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA,
  MURPH_AUTOMATION_TOOL,
  readAutomationDynamicToolRequest,
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
    allowedByAction.set(action, Object.keys(branchProperties).sort())
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: [...properties].sort(),
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
    allowedByAction.set(action, Object.keys(branchProperties).sort())
    requiredByAction.set(action, asStringArray(branch.required))
  }
  return {
    actions,
    properties: Object.keys(properties).sort(),
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
  it('advertises the canonical device source enum in runtime and model schemas', () => {
    for (const schema of [MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA, MURPH_AUTOMATION_TOOL.inputSchema]) {
      const sources = collectKeys(schema, 'source')
      expect(sources.length).toBeGreaterThan(0)
      for (const source of sources) {
        expect(asObject(source).enum).toEqual(automationDeviceActivitySourceValues)
      }
    }
  })

  it('explains workout and sleep filtering versus all recorded activity kinds', () => {
    for (const schema of [MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA, MURPH_AUTOMATION_TOOL.inputSchema]) {
      const kinds = collectKeys(schema, 'activityKind')
      expect(kinds.length).toBeGreaterThan(0)
      for (const kind of kinds) {
        const description = asObject(kind).description
        expect(description).toContain('Use "workout" for workouts, "sleep" for sleep')
        expect(description).toContain('Omit only to match all recorded activity kinds, including sleep.')
      }
    }
  })

  it('explains device activity selectors alongside canonical schedule shapes', () => {
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      '{"kind":"deviceActivity","activityKind":"workout","source":"garmin","after":"2026-01-01T00:00:00.000Z"}',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'with the requested lowercase source and exact recorded-after cutoff',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'set schedule.activityKind to workout for workout requests',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'omitted activityKind matches all recorded kinds including sleep, and omitted source matches all providers',
    )
  })

  it.each([undefined, 'whoop', 'whoop_v2', 'garmin', 'oura', 'fitbit', 'google_health', 'google-health', 'unknown-provider'])(
    'validates device source %s for hosted save and patch',
    (source) => {
      const schedule = {
        kind: 'deviceActivity',
        activityKind: 'workout',
        after: '2026-06-07T11:00:00.000Z',
        ...(source === undefined ? {} : { source }),
      }
      const accepted = source === undefined
        || automationDeviceActivitySourceValues.some((value) => value === source)
      for (const args of [
        { action: 'save', title: 'Activity check-in', instructions: 'Ask how the activity felt.', schedule },
        { action: 'patch', lookup: 'auto_activity', expectedUpdatedAt: '2026-06-07T10:00:00.000Z', schedule },
      ]) {
        const result = readAutomationDynamicToolRequest({
          arguments: args,
          tool: MURPH_AUTOMATION_TOOL.name,
        })
        expect(result?.kind).toBe(accepted ? 'automation' : 'invalid-automation-arguments')
        if (result?.kind === 'automation') {
          expect(result.request).toMatchObject({ action: args.action, schedule })
          expect(result.request).not.toHaveProperty('retargetToCurrentConversation')
        }
      }
    },
  )

  it('advertises Terra as the reminder default and Luna only for a fixed cue', () => {
    const schemaDescriptions = collectKeys(
      MURPH_AUTOMATION_TOOL.inputSchema,
      'description',
    ).filter((value): value is string => typeof value === 'string')
    const modelSchemaDescription = schemaDescriptions.find((description) =>
      description.startsWith('Optional model for this automation turn only.'),
    )

    expect(modelSchemaDescription).toBeDefined()
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'For an ordinary reminder, set assistantTargetOverride.model explicitly',
    )
    for (const guidance of [
      MURPH_AUTOMATION_TOOL.description,
      modelSchemaDescription ?? '',
    ]) {
      const normalizedGuidance = guidance.toLowerCase()

      expect(normalizedGuidance).toContain(
        'use luna only when the complete future turn is a fixed, fully self-contained cue',
      )
      expect(normalizedGuidance).toContain(
        'use terra for all reminders that do not meet that luna exception; when unsure, use terra.',
      )
      expect(normalizedGuidance).toContain('for a non-reminder automation')
      expect(normalizedGuidance).not.toContain(
        'use luna for self-contained cues and reminders',
      )
    }
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'when its instructions or context requirements materially change or the member explicitly asks to change its model or reasoning',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'omit assistantTargetOverride for timing-only or status-only edits to preserve the stored override',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'On a non-reminder patch, assistantTargetOverride replaces the whole stored override: use null to return that automation to conversation inheritance',
    )
  })

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
      action: 'save',
      instructions: 'Open and follow the group newsletter skill.',
      schedule: {
        expression: '0 9 * * 0',
        kind: 'cron',
        timeZone: 'America/New_York',
      },
      slug: 'group-health-newsletter',
      title: 'Weekly health',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'patch',
      expectedUpdatedAt: '2026-08-21T10:00:00.000Z',
      lookup: 'morning-reminder',
      status: 'archived',
    })).toBe(true)
    expect(advertisesRootShape(schema, {
      action: 'patch',
      expectedUpdatedAt: '2026-08-21T10:00:00.000Z',
      lookup: 'automation_01K1ABCDEFGHJKMNPQRSTVWXYZ',
      slug: 'morning-reminder',
    })).toBe(false)
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

  it('returns the full schema instead of adding reference expansion machinery', () => {
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
    expect(model).toBe(canonical)
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
