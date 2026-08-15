import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { Cli } from 'incur'
import { describe, expect, it, vi } from 'vitest'

import {
  parseResearchScoutBatchCliPayloadInput,
  normalizeResearchScoutTimestampOption,
  parseResearchScoutCliProfileInput,
  registerResearchCommands,
} from '../src/commands/research.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  buildExaResearchScoutRequest,
  fetchExaResearchScoutBatchCandidates,
  fetchExaResearchScoutCandidates,
} from '../src/research-scout-client.js'
import type {
  ResearchScoutBatchInput,
  ResearchScoutInput,
} from '../src/research-scout.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

const RESEARCH_SCOUT_INPUT = {
  profile: {
    mode: 'focused',
    topics: ['sleep'],
    biomarkers: ['hs-crp'],
    behaviors: ['zone 2 training'],
    supplements: [],
    conditionsOrConcerns: [],
    goals: ['better recovery'],
    activeExperiments: ['morning light'],
  },
  since: '2026-04-18T00:00:00.000Z',
  until: '2026-06-17T00:00:00.000Z',
  maxCandidates: 2,
} satisfies ResearchScoutInput

const RESEARCH_SCOUT_BATCH_INPUT = {
  lanes: [
    {
      label: 'sleep',
      profile: {
        topics: ['sleep'],
        biomarkers: [],
        behaviors: ['morning light'],
        supplements: [],
        conditionsOrConcerns: [],
        goals: [],
        activeExperiments: ['screen curfew'],
      },
    },
    {
      label: 'training recovery',
      profile: {
        topics: ['recovery'],
        biomarkers: [],
        behaviors: ['resistance training'],
        supplements: [],
        conditionsOrConcerns: [],
        goals: ['better recovery'],
        activeExperiments: [],
      },
    },
  ],
  since: '2024-06-18T00:00:00.000Z',
  until: '2026-06-17T00:00:00.000Z',
  maxCandidatesPerLane: 5,
} satisfies ResearchScoutBatchInput

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  })
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

function createStructuredCandidate(input: {
  evidenceStrength?: 'strong' | 'moderate' | 'early' | 'weak'
  hypeRisk?: 'low' | 'medium' | 'high'
  matchedProfileTags?: string[]
  resultIndex?: number
  studyType?:
    | 'guideline'
    | 'meta_analysis'
    | 'systematic_review'
    | 'randomized_trial'
    | 'prospective_cohort'
    | 'observational'
    | 'case_study'
    | 'preclinical'
    | 'preprint'
    | 'news_or_commentary'
} = {}) {
  return {
    actionOrQuestion: 'Discuss whether the finding changes any local follow-up questions.',
    doNotOverinterpret: 'Do not treat one source as a diagnosis or treatment plan.',
    evidenceStrength: input.evidenceStrength ?? 'moderate',
    hypeRisk: input.hypeRisk ?? 'low',
    keyFinding: 'Recent human evidence reports a bounded health finding.',
    matchedProfileTags: input.matchedProfileTags ?? ['sleep', 'better recovery'],
    resultIndex: input.resultIndex ?? 0,
    studyType: input.studyType ?? 'systematic_review',
    whyItMayMatter: 'The result overlaps with non-identifying profile tags.',
  }
}

describe('research scout', () => {
  it('accepts raw profile JSON and an exact profile wrapper for CLI input', () => {
    const rawProfile = {
      mode: 'focused',
      topics: ['sleep', 'recovery'],
      behaviors: ['exercise'],
    }

    expect(parseResearchScoutCliProfileInput(rawProfile)).toMatchObject({
      mode: 'focused',
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
    expect(payloadSchema.schema.properties).toHaveProperty('mode')
    expect(payloadSchema.schema.properties).toHaveProperty('topics')
    expect(payloadSchema.schema.properties).toHaveProperty('behaviors')
    expect(payloadSchema.schema.properties).not.toHaveProperty('tags')
    expect(payloadSchema.schema.additionalProperties).toBe(false)
    expect(payloadSchema.examples?.[0]).toMatchObject({
      mode: 'focused',
      topics: ['cognition'],
      supplements: ['creatine'],
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

  it('requires EXA_API_KEY before making an external request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
        env: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_token_missing',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires EXA_API_KEY before making batch external requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      fetchExaResearchScoutBatchCandidates(RESEARCH_SCOUT_BATCH_INPUT, {
        env: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_token_missing',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts one deep-reasoning research-paper search with a finite focused profile', async () => {
    const providerPayload = {
      output: {
        content: JSON.stringify({
          candidates: [createStructuredCandidate()],
        }),
      },
      results: [{
        author: 'Example Journal',
        publishedDate: '2026-06-01',
        title: 'Example sleep recovery review',
        url: 'https://example.test/research/sleep-recovery',
      }],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(providerPayload))

    const result = await fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [target, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(target)).toBe('https://api.exa.ai/search')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe('exa-test-token')
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8')

    const requestBody = JSON.parse(String(init?.body)) as {
      category?: unknown
      contents?: unknown
      endPublishedDate?: unknown
      numResults?: unknown
      outputSchema?: {
        properties?: {
          candidates?: {
            items?: {
              properties?: Record<string, unknown>
            }
            maxItems?: unknown
          }
        }
      }
      query?: unknown
      startPublishedDate?: unknown
      systemPrompt?: unknown
      type?: unknown
    }
    expect(requestBody.type).toBe('deep-reasoning')
    expect(requestBody.category).toBe('research paper')
    expect(requestBody.contents).toBeUndefined()
    expect(requestBody.startPublishedDate).toBe(RESEARCH_SCOUT_INPUT.since)
    expect(requestBody.endPublishedDate).toBe(RESEARCH_SCOUT_INPUT.until)
    expect(requestBody.numResults).toBe(2)
    expect(requestBody.query).toEqual(expect.stringContaining('sleep'))
    expect(requestBody.query).toEqual(expect.stringContaining('hs-crp'))
    expect(requestBody.query).toEqual(expect.stringContaining('focused structured scope'))
    expect(requestBody.query).not.toEqual(expect.stringContaining('raw lab'))
    expect(requestBody.systemPrompt).toEqual(expect.stringContaining('focused structured scope'))
    expect(requestBody.systemPrompt).toEqual(expect.stringContaining('not personalized medical advice or tasks to do'))
    expect(requestBody.systemPrompt).toEqual(expect.stringContaining('not a behavior prescription'))
    expect(requestBody.outputSchema?.properties?.candidates?.maxItems).toBe(2)
    expect(
      requestBody.outputSchema?.properties?.candidates?.items?.properties?.resultIndex,
    ).toBeDefined()
    expect(
      requestBody.outputSchema?.properties?.candidates?.items?.properties?.sourceUrl,
    ).toBeUndefined()

    expect(result.provider).toEqual({
      endpoint: 'search',
      mode: 'deep-reasoning',
      name: 'exa',
    })
    expect(result.privacy).toEqual({
      persistedByTool: false,
      rawVaultValuesSent: false,
      sentProfileKind: 'focused_profile',
      tokenSource: 'env',
    })
    expect(result.response).toEqual(providerPayload)
  })

  it('cancels rejected Exa bodies without exposing provider text', async () => {
    const cancel = vi.fn()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream({ cancel }),
      { status: 503 },
    ))

    await expect(fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: { EXA_API_KEY: 'exa-test-token' },
      fetchImpl,
    })).rejects.toMatchObject({
      code: 'research_exa_request_failed',
      context: expect.objectContaining({ status: 503 }),
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('composes caller cancellation without retrying or exposing the abort reason', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>(async (_target, init) => {
      const signal = init?.signal
      if (!signal) {
        throw new Error('Expected the Exa request to carry an abort signal.')
      }
      return await new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(signal.reason)
        if (signal.aborted) {
          rejectOnAbort()
          return
        }
        signal.addEventListener('abort', rejectOnAbort, { once: true })
      })
    })

    const request = fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: { EXA_API_KEY: 'exa-test-token' },
      fetchImpl,
      signal: controller.signal,
    })
    controller.abort(new Error('private caller abort reason'))

    await expect(request).rejects.toMatchObject({
      code: 'research_exa_request_failed',
      context: {
        abortedByCaller: true,
        failureStage: 'request',
        timedOut: false,
      },
      message: 'Exa research scout request was aborted.',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)
    await expect(request).rejects.not.toThrow(/private caller abort reason/u)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns redacted structured HTTP failures without retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      message: 'echoed private query and exa-test-token',
    }, 429))

    const request = fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: { EXA_API_KEY: 'exa-test-token' },
      fetchImpl,
    })

    await expect(request).rejects.toMatchObject({
      code: 'research_exa_request_failed',
      context: {
        failureStage: 'response',
        status: 429,
      },
      message: 'Exa research scout request failed.',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)
    await expect(request).rejects.not.toThrow(/echoed private query|exa-test-token/u)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('posts one bounded research-paper search for each batch lane', async () => {
    const providerPayloads = [
      {
        output: {
          content: {
            candidates: [createStructuredCandidate({ matchedProfileTags: ['sleep'] })],
          },
        },
        results: [{ title: 'Sleep source', url: 'https://example.test/sleep' }],
      },
      {
        output: {
          content: {
            candidates: [createStructuredCandidate({ matchedProfileTags: ['recovery'] })],
          },
        },
        results: [{ title: 'Recovery source', url: 'https://example.test/recovery' }],
      },
    ]
    let requestIndex = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const payload = providerPayloads[requestIndex] ?? providerPayloads[0]
      requestIndex += 1
      return jsonResponse(payload)
    })

    const result = await fetchExaResearchScoutBatchCandidates(RESEARCH_SCOUT_BATCH_INPUT, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstRequest = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      numResults?: unknown
      query?: unknown
    }
    const secondRequest = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      numResults?: unknown
      query?: unknown
    }
    expect(firstRequest.numResults).toBe(5)
    expect(firstRequest.query).toEqual(expect.stringContaining('Topics: sleep'))
    expect(firstRequest.query).toEqual(expect.stringContaining('Active experiments: screen curfew'))
    expect(secondRequest.numResults).toBe(5)
    expect(secondRequest.query).toEqual(expect.stringContaining('Behaviors: resistance training'))
    expect(result.provider).toEqual({
      endpoint: 'search',
      mode: 'deep-reasoning',
      name: 'exa',
    })
    expect(result.privacy.rawVaultValuesSent).toBe(false)
    expect(result.lanes).toEqual([
      {
        label: 'sleep',
        response: providerPayloads[0],
      },
      {
        label: 'training recovery',
        response: providerPayloads[1],
      },
    ])
  })

  it('runs one schema-valid managed batch lane through the CLI parser and client', async () => {
    const payload = parseResearchScoutBatchCliPayloadInput({
      lanes: [{
        label: 'creatine and cognition',
        profile: {
          topics: ['cognition'],
          supplements: ['creatine'],
          conditionsOrConcerns: ['healthy adults'],
          goals: ['cognitive performance'],
        },
      }],
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      output: { content: { candidates: [] } },
      results: [],
    }))

    await fetchExaResearchScoutBatchCandidates({
      ...payload,
      since: '2024-08-07T00:00:00.000Z',
      until: '2026-08-07T00:00:00.000Z',
      maxCandidatesPerLane: 8,
    }, {
      env: { EXA_API_KEY: 'exa-test-token' },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      query?: unknown
      systemPrompt?: unknown
    }
    expect(request.query).toEqual(expect.stringContaining('Topics: cognition'))
    expect(request.query).toEqual(expect.stringContaining('Supplements: creatine'))
    expect(request.systemPrompt).toEqual(
      expect.stringContaining('practical interpretive value'),
    )
  })

  it('rejects unsupported batch lane concepts before Exa fetches', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      fetchExaResearchScoutBatchCandidates({
        ...RESEARCH_SCOUT_BATCH_INPUT,
        lanes: [
          {
            label: 'sleep',
            profile: {
              topics: ['sleep'],
              behaviors: ['morning light'],
              supplements: [],
              conditionsOrConcerns: [],
              goals: [],
              activeExperiments: ['screen curfew'],
              biomarkers: ['LDL 143 mg/dL'],
            },
          },
        ],
      }, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl,
      }),
    ).rejects.toThrow(/exact server-owned public concepts/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    {
      field: 'biomarkers',
      value: 'LDL 143 mg/dL',
    },
    {
      field: 'conditionsOrConcerns',
      value: 'DOB 1990-01-02',
    },
    {
      field: 'goals',
      value: 'my private recovery note with too much personal context',
    },
    {
      field: 'topics',
      value: 'person@example.test',
    },
    {
      field: 'behaviors',
      value: '+1 555 222 3333',
    },
  ] as const)('rejects unsafe raw profile tags before Exa fetches: $field', async ({
    field,
    value,
  }) => {
    const fetchImpl = vi.fn<typeof fetch>()
    const input = {
      ...RESEARCH_SCOUT_INPUT,
      profile: {
        ...RESEARCH_SCOUT_INPUT.profile,
        [field]: [value],
      },
    }

    await expect(
      fetchExaResearchScoutCandidates(input, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl,
      }),
    ).rejects.toThrow(/exact server-owned public concepts/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows exact finite public concepts', async () => {
    const providerPayload = {
      output: {
        content: {
          candidates: [createStructuredCandidate()],
        },
      },
      results: [{
        title: 'Kept source',
        url: 'https://example.test/kept',
      }],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(providerPayload))

    const result = await fetchExaResearchScoutCandidates({
      ...RESEARCH_SCOUT_INPUT,
      profile: {
        ...RESEARCH_SCOUT_INPUT.profile,
        behaviors: ['zone 2 training', 'yoga'],
        conditionsOrConcerns: ['type 2 diabetes', 'menopause'],
        supplements: ['omega-3'],
      },
    }, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.response).toEqual(providerPayload)
  })

  it('returns Exa payloads without local candidate filtering', async () => {
    const providerPayload = {
      output: {
        content: {
          candidates: [
            createStructuredCandidate({ evidenceStrength: 'weak', resultIndex: 0 }),
            createStructuredCandidate({ hypeRisk: 'high', resultIndex: 1 }),
            createStructuredCandidate({ resultIndex: 2, studyType: 'preclinical' }),
            createStructuredCandidate({ resultIndex: 3, studyType: 'news_or_commentary' }),
            createStructuredCandidate({ matchedProfileTags: [], resultIndex: 4 }),
            createStructuredCandidate({ resultIndex: 5 }),
          ],
        },
      },
      results: [
        { title: 'Weak source', url: 'https://example.test/weak' },
        { title: 'Hyped source', url: 'https://example.test/hyped' },
        { title: 'Preclinical source', url: 'https://example.test/preclinical' },
        { title: 'News source', url: 'https://example.test/news' },
        { title: 'Generic source', url: 'https://example.test/generic' },
        { title: 'Kept source', url: 'https://example.test/kept' },
      ],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(providerPayload))

    const result = await fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(result.response).toEqual(providerPayload)
  })

  it('passes through malformed structured content and unlinked search results', async () => {
    const providerPayload = {
      output: {
        content: '{"candidates":[{"resultIndex":0}]}',
      },
      results: [
        { title: 'Invalid URL source', url: 'not a valid URL' },
        { title: 'Non-web URL source', url: 'file:///tmp/research.pdf' },
        { title: 'Missing URL source' },
      ],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(providerPayload))

    const result = await fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(result.response).toEqual(providerPayload)
  })

  it('keeps the Exa structured-output schema within the shallow citation-free contract', () => {
    const request = buildExaResearchScoutRequest(RESEARCH_SCOUT_INPUT)
    const candidateProperties =
      request.outputSchema.properties.candidates.items.properties

    expect(Object.keys(request.outputSchema.properties)).toEqual(['candidates'])
    expect(candidateProperties).toHaveProperty('resultIndex')
    expect(candidateProperties).not.toHaveProperty('sourceUrl')
    expect(candidateProperties).not.toHaveProperty('title')
    expect(candidateProperties).not.toHaveProperty('doi')
  })
})
