import { describe, expect, it } from 'vitest'
import { compileToolInputSchema } from './support/tool-input-schema-validation.ts'
import { automationDeviceActivitySourceValues } from '@murphai/contracts'

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

// Validate the advertised document, independently of the production argument parser.
// This replaces the old root-key-only approximation, which ignored field types,
// nested requirements, enum values, bounds, and date formats. Runtime-only
// refinements are not claimed as structural parity coverage.
const advertisedInput = compileToolInputSchema(MURPH_AUTOMATION_TOOL.inputSchema)

function advertisesInput(value: JsonSchemaObject): boolean {
  return advertisedInput(value)
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
  const version = '2026-08-21T10:00:00.000Z'
  const patch = { action: 'patch', lookup: 'automation_synthetic', expectedUpdatedAt: version, title: 'Synthetic reminder' }
  const reference = { entityKind: 'condition', entityId: 'condition_synthetic' }
  const cases: { label: string; args: JsonSchemaObject; accepted: boolean }[] = [
    { label: 'inspect', args: { action: 'inspect', lookup: patch.lookup }, accepted: true },
    { label: 'save', args: { action: 'save', title: patch.title, instructions: 'Synthetic cue.', schedule: { kind: 'every', everyMs: 3_600_000 } }, accepted: true },
    { label: 'versioned patch', args: patch, accepted: true },
    { label: 'onboarding save', args: { action: 'save_onboarding_first_personal_read' }, accepted: true },
    { label: 'reconcile', args: { action: 'reconcile', desiredAutomationIds: [], supportSeriesId: 'synthetic-series' }, accepted: true },
    { label: 'follow-up', args: { action: 'attach_follow_up', afterMinutes: 30, instructions: 'Synthetic follow-up.' }, accepted: true },
    { label: 'recovery dismissal', args: { action: 'dismiss_local_at_recovery', localAtRecoveryKey: 'a'.repeat(64), resolvedLocalDate: '2026-08-21' }, accepted: true },
    { label: 'missing version', args: { action: 'patch', lookup: patch.lookup, title: patch.title }, accepted: false },
    { label: 'invalid version format', args: { ...patch, expectedUpdatedAt: 'yesterday' }, accepted: false },
    { label: 'wrong version type', args: { ...patch, expectedUpdatedAt: 42 }, accepted: false },
    { label: 'unknown property', args: { ...patch, unexpected: true }, accepted: false },
    { label: 'unknown action', args: { action: 'overwrite' }, accepted: false },
    { label: 'empty title', args: { ...patch, title: '' }, accepted: false },
    { label: 'maximum title', args: { ...patch, title: 'x'.repeat(160) }, accepted: true },
    { label: 'overlong title', args: { ...patch, title: 'x'.repeat(161) }, accepted: false },
    { label: 'nested reference', args: { ...patch, contextReferences: [reference] }, accepted: true },
    { label: 'duplicate references', args: { ...patch, contextReferences: [reference, reference] }, accepted: false },
    { label: 'missing reference id', args: { ...patch, contextReferences: [{ entityKind: reference.entityKind }] }, accepted: false },
    { label: 'wrong reference id type', args: { ...patch, contextReferences: [{ ...reference, entityId: 42 }] }, accepted: false },
    { label: 'invalid reference kind pattern', args: { ...patch, contextReferences: [{ ...reference, entityKind: 'Invalid Kind' }] }, accepted: false },
    { label: 'wrong reference array type', args: { ...patch, contextReferences: reference }, accepted: false },
    { label: 'nested schedule', args: { ...patch, schedule: { kind: 'every', everyMs: 3_600_000 } }, accepted: true },
    { label: 'missing schedule interval', args: { ...patch, schedule: { kind: 'every' } }, accepted: false },
    { label: 'wrong interval type', args: { ...patch, schedule: { kind: 'every', everyMs: '3600000' } }, accepted: false },
    { label: 'negative interval', args: { ...patch, schedule: { kind: 'every', everyMs: -1 } }, accepted: false },
    { label: 'unknown status', args: { ...patch, status: 'made_up' }, accepted: false },
    { label: 'clear nullable summary', args: { ...patch, summary: null }, accepted: true },
    { label: 'wrong nullable summary type', args: { ...patch, summary: 42 }, accepted: false },
    { label: 'too many reconciliation ids', args: { action: 'reconcile', supportSeriesId: 'synthetic-series', desiredAutomationIds: Array.from({ length: 201 }, (_, i) => `automation_${i}`) }, accepted: false },
  ]

  it.each(cases)('matches advertised and runtime structural admission: $label', ({ args, accepted }) => {
    expect(advertisedInput(args), 'advertised JSON Schema').toBe(accepted)
    const parsed = readAutomationDynamicToolRequest({ arguments: args, tool: MURPH_AUTOMATION_TOOL.name })
    expect(parsed).not.toBeNull()
    expect(parsed?.kind !== 'invalid-automation-arguments', 'production argument parser').toBe(accepted)
  })

  it('covers every advertised automation action with an accepted runtime fixture', () => {
    const actions = asObjectArray(MURPH_AUTOMATION_TOOL.inputSchema.oneOf)
      .map((branch) => asObject(asObject(branch.properties).action).const)
    expect([...new Set(cases.filter((entry) => entry.accepted).map((entry) => entry.args.action))].sort())
      .toEqual(actions.sort())
  })

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

  it('advertises the complete canonical runtime schema with self-contained action branches', () => {
    const schema = MURPH_AUTOMATION_TOOL.inputSchema
    expect(schema).toBe(MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA)
    expect(asStringArray(actionContract(schema, 'patch').required)).toContain('expectedUpdatedAt')
    expect(collectKeys(schema, '$ref')).toEqual([])
    const patch = actionContract(schema, 'patch')
    expect(asObject(patch.properties).expectedUpdatedAt).toMatchObject({
      type: 'string',
      description: expect.stringContaining('most recent readback'),
    })
    expect(MURPH_AUTOMATION_TOOL.description).toMatch(/^To edit an existing automation: inspect it, then patch/u)
    expect(MURPH_AUTOMATION_TOOL.description).toContain('for a wording edit, include the new wording')
  })

  it('advertises strict action-specific root contracts', () => {
    const schema = MURPH_AUTOMATION_TOOL.inputSchema

    expect(advertisesInput({
      action: 'inspect',
      lookup: 'morning-reminder',
    })).toBe(true)
    expect(advertisesInput({
      action: 'inspect',
      lookup: 'morning-reminder',
      status: 'archived',
    })).toBe(false)
    expect(advertisesInput({
      action: 'save_onboarding_first_personal_read',
    })).toBe(true)
    expect(advertisesInput({
      action: 'save_onboarding_first_personal_read',
      title: 'Not accepted by the canonical action',
    })).toBe(false)
    expect(advertisesInput({
      action: 'save',
      instructions: 'A useful reminder.',
      schedule: { kind: 'every', everyMs: 3_600_000 },
      title: 'Useful reminder',
    })).toBe(true)
    expect(advertisesInput({
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
    expect(advertisesInput({
      action: 'patch',
      expectedUpdatedAt: '2026-08-21T10:00:00.000Z',
      lookup: 'morning-reminder',
      status: 'archived',
    })).toBe(true)
    expect(advertisesInput({
      action: 'patch',
      expectedUpdatedAt: '2026-08-21T10:00:00.000Z',
      lookup: 'automation_01K1ABCDEFGHJKMNPQRSTVWXYZ',
      slug: 'morning-reminder',
    })).toBe(false)
    expect(advertisesInput({
      action: 'reconcile',
      desiredAutomationIds: [],
      supportSeriesId: 'weekly-plan',
    })).toBe(true)
    expect(advertisesInput({
      action: 'dismiss_local_at_recovery',
      localAtRecoveryKey: 'a'.repeat(64),
      resolvedLocalDate: '2026-08-21',
    })).toBe(true)

    for (const action of ['inspect', 'patch']) {
      expect(asObject(asObject(actionContract(schema, action).properties).lookup))
        .toMatchObject({ type: 'string', minLength: 1 })
    }
    expect(advertisesInput({
      action: 'patch', lookup: 'automation_synthetic', instructions: 'Updated cue.',
    })).toBe(false)
  })
})
