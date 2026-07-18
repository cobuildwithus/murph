import { Cli } from 'incur'
import { describe, expect, it } from 'vitest'

import {
  parseResearchScoutBatchCliPayloadInput,
  normalizeResearchScoutTimestampOption,
  parseResearchScoutCliProfileInput,
  registerResearchCommands,
} from '../src/commands/research.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

interface PayloadSchemaResult {
  command: string
  examples?: unknown[]
  schema: {
    additionalProperties?: unknown
    properties?: Record<string, unknown>
  }
  schemaName?: string
  schemaVersion: string
}

function createResearchCli() {
  const cli = Cli.create('vault-cli', {
    description: 'research scout test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerResearchCommands(cli)
  return cli
}

describe('research scout', () => {
  it('accepts raw profile JSON and an exact profile wrapper for CLI input', () => {
    const rawProfile = {
      topics: ['sleep', 'recovery'],
      behaviors: ['exercise'],
    }

    expect(parseResearchScoutCliProfileInput(rawProfile)).toMatchObject({
      topics: ['sleep', 'recovery'],
      behaviors: ['exercise'],
      biomarkers: [],
      supplements: [],
      conditionsOrConcerns: [],
      goals: [],
      activeExperiments: [],
    })

    expect(parseResearchScoutCliProfileInput({ profile: rawProfile })).toMatchObject({
      topics: ['sleep', 'recovery'],
      behaviors: ['exercise'],
    })
  })

  it('rejects generic tags and full request-shaped input with actionable CLI guidance', () => {
    expect(() =>
      parseResearchScoutCliProfileInput({
        tags: ['sleep', 'recovery'],
      })).toThrow(/bucket fields: topics, biomarkers, behaviors/u)
    expect(() =>
      parseResearchScoutCliProfileInput({
        profile: {
          topics: ['sleep'],
        },
        since: '2026-04-25T00:00:00.000Z',
      })).toThrow(/Pass since, until, and maxCandidates as CLI options/u)
  })

  it('accepts compact research scout batch lane payloads', () => {
    expect(parseResearchScoutBatchCliPayloadInput({
      lanes: [
        {
          label: 'sleep',
          profile: {
            topics: ['sleep'],
            behaviors: ['morning light'],
          },
        },
      ],
    })).toMatchObject({
      lanes: [
        {
          label: 'sleep',
          profile: {
            topics: ['sleep'],
            behaviors: ['morning light'],
            biomarkers: [],
            supplements: [],
            conditionsOrConcerns: [],
            goals: [],
            activeExperiments: [],
          },
        },
      ],
    })
  })

  it('rejects full request-shaped batch input with actionable CLI guidance', () => {
    expect(() =>
      parseResearchScoutBatchCliPayloadInput({
        lanes: [
          {
            label: 'sleep',
            profile: {
              topics: ['sleep'],
            },
          },
        ],
        since: '2024-06-18T00:00:00.000Z',
      })).toThrow(/Pass since, until, and maxCandidatesPerLane as CLI options/u)
  })

  it('normalizes date-only research scout bounds before provider work', () => {
    const now = new Date('2026-06-24T12:34:56.789Z')

    expect(
      normalizeResearchScoutTimestampOption('2026-04-25', 'since', now),
    ).toBe('2026-04-25T00:00:00.000Z')
    expect(
      normalizeResearchScoutTimestampOption('2026-06-23', 'until', now),
    ).toBe('2026-06-23T23:59:59.999Z')
    expect(
      normalizeResearchScoutTimestampOption('2026-06-24', 'until', now),
    ).toBe('2026-06-24T12:34:56.789Z')
    expect(
      normalizeResearchScoutTimestampOption('2026-06-24T12:00:00Z', 'until', now),
    ).toBe('2026-06-24T12:00:00.000Z')
    expect(
      normalizeResearchScoutTimestampOption('2026-06-24T23:59:59Z', 'until', now),
    ).toBe('2026-06-24T12:34:56.789Z')
    expect(
      normalizeResearchScoutTimestampOption('2026-02-31', 'since', now),
    ).toBeNull()
  })

  it('emits a discoverable payload schema for the research scout input body', async () => {
    const payloadSchema = requireData(
      (await runInProcessJsonCli<PayloadSchemaResult>(createResearchCli(), [
        'research',
        'payload-schema',
      ])).envelope,
    )

    expect(payloadSchema.schemaVersion).toBe('murph.payload-schema.v1')
    expect(payloadSchema.command).toBe('research scout --input')
    expect(payloadSchema.schemaName).toBe('ResearchScoutProfile')
    expect(payloadSchema.schema.properties).toHaveProperty('topics')
    expect(payloadSchema.schema.properties).toHaveProperty('behaviors')
    expect(payloadSchema.schema.properties).not.toHaveProperty('tags')
    expect(payloadSchema.schema.additionalProperties).toBe(false)
    expect(payloadSchema.examples?.[0]).toMatchObject({
      topics: ['sleep', 'recovery'],
      behaviors: ['exercise'],
    })
  })

  it('emits a discoverable payload schema for research scout batch lanes', async () => {
    const payloadSchema = requireData(
      (await runInProcessJsonCli<PayloadSchemaResult>(createResearchCli(), [
        'research',
        'scout-batch-payload-schema',
      ])).envelope,
    )

    expect(payloadSchema.schemaVersion).toBe('murph.payload-schema.v1')
    expect(payloadSchema.command).toBe('research scout-batch --input')
    expect(payloadSchema.schemaName).toBe('ResearchScoutBatchPayload')
    expect(payloadSchema.schema.properties).toHaveProperty('lanes')
    const example = payloadSchema.examples?.[0] as {
      lanes?: Array<{ label?: unknown; profile?: unknown }>
    } | undefined
    expect(example?.lanes).toEqual([
      expect.objectContaining({
        label: 'sleep',
        profile: expect.objectContaining({
          behaviors: ['morning light'],
          topics: ['sleep'],
        }),
      }),
      expect.objectContaining({
        label: 'training recovery',
        profile: expect.objectContaining({
          behaviors: ['resistance training'],
          topics: ['recovery'],
        }),
      }),
    ])
  })
})
