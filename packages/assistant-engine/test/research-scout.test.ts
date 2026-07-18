import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  buildExaResearchScoutRequest,
  type ResearchScoutBatchInput,
  type ResearchScoutInput,
} from '@murphai/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  fetchExaResearchScoutBatchCandidates,
  fetchExaResearchScoutCandidates,
} from '../src/research-scout.js'

const RESEARCH_SCOUT_INPUT = {
  profile: {
    activeExperiments: ['morning light'],
    behaviors: ['zone 2 training'],
    biomarkers: ['hs-crp'],
    conditionsOrConcerns: [],
    goals: ['better recovery'],
    supplements: [],
    topics: ['sleep'],
  },
  maxCandidates: 2,
  since: '2026-04-18T00:00:00.000Z',
  until: '2026-06-17T00:00:00.000Z',
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

const dependencies = {
  env: { EXA_API_KEY: 'test-provider-key' },
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  })
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

describe('Exa research scout response bounds', () => {
  it('combines caller cancellation with the provider deadline', async () => {
    const turnAbort = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>((_request, init) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) {
        throw new Error('Expected the provider request signal.')
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    })

    const result = fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      ...dependencies,
      abortSignal: turnAbort.signal,
      fetchImpl,
    })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    const providerSignal = fetchImpl.mock.calls[0]?.[1]?.signal
    if (!(providerSignal instanceof AbortSignal)) {
      throw new Error('Expected the composed provider request signal.')
    }
    expect(providerSignal).not.toBe(turnAbort.signal)

    turnAbort.abort(new Error('scheduled turn cancelled'))
    await expect(result).rejects.toThrow(
      'Exa research scout request failed: scheduled turn cancelled.',
    )
    expect(providerSignal.aborted).toBe(true)
  })

  it('rejects an oversized content length before reading the body', async () => {
    const readBody = vi.fn(() => null)
    const response = {
      get body() {
        return readBody()
      },
      headers: new Headers({ 'content-length': '256001' }),
      ok: true,
    } as Response
    const fetchImpl = vi.fn<typeof fetch>(async () => response)

    await expect(fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      ...dependencies,
      fetchImpl,
    })).rejects.toThrow('response exceeded 256000 bytes')
    expect(readBody).not.toHaveBeenCalled()
  })

  it('cancels and rejects a streamed response once it crosses the byte cap', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(200_000))
        controller.enqueue(new Uint8Array(56_001))
      },
    }))
    const fetchImpl = vi.fn<typeof fetch>(async () => response)

    await expect(fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      ...dependencies,
      fetchImpl,
    })).rejects.toThrow('response exceeded 256000 bytes')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects a successful response with no body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null))

    await expect(fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      ...dependencies,
      fetchImpl,
    })).rejects.toThrow('returned an empty response')
  })
})

describe('Exa research scout client', () => {
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

  it('posts one deep-reasoning research-paper search with a compact tag profile', async () => {
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
    const headers = new Headers(init?.headers)
    expect(headers.get('x-api-key')).toBe('exa-test-token')
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8')

    const requestBody = JSON.parse(String(init?.body)) as {
      category?: unknown
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
    expect(requestBody.startPublishedDate).toBe(RESEARCH_SCOUT_INPUT.since)
    expect(requestBody.endPublishedDate).toBe(RESEARCH_SCOUT_INPUT.until)
    expect(requestBody.numResults).toBe(2)
    expect(requestBody.query).toEqual(expect.stringContaining('sleep'))
    expect(requestBody.query).toEqual(expect.stringContaining('hs-crp'))
    expect(requestBody.query).toEqual(
      expect.stringContaining('local context decides send-worthiness'),
    )
    expect(requestBody.query).not.toEqual(expect.stringContaining('raw lab'))
    expect(requestBody.systemPrompt).toEqual(
      expect.stringContaining('practical interpretive value'),
    )
    expect(requestBody.systemPrompt).toEqual(
      expect.stringContaining('not personalized medical advice or tasks to do'),
    )
    expect(requestBody.systemPrompt).toEqual(
      expect.stringContaining('not a behavior prescription'),
    )
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
      sentProfileKind: 'tag_profile',
      tokenSource: 'env',
    })
    expect(result.response).toEqual(providerPayload)
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
            candidates: [createStructuredCandidate({
              matchedProfileTags: ['recovery'],
            })],
          },
        },
        results: [{
          title: 'Recovery source',
          url: 'https://example.test/recovery',
        }],
      },
    ]
    let requestIndex = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const payload = providerPayloads[requestIndex] ?? providerPayloads[0]
      requestIndex += 1
      return jsonResponse(payload)
    })

    const result = await fetchExaResearchScoutBatchCandidates(
      RESEARCH_SCOUT_BATCH_INPUT,
      {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl,
      },
    )

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
    expect(firstRequest.query).toEqual(
      expect.stringContaining('Active experiments: screen curfew'),
    )
    expect(secondRequest.numResults).toBe(5)
    expect(secondRequest.query).toEqual(
      expect.stringContaining('Behaviors: resistance training'),
    )
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

  it('rejects unsafe batch lane profiles before Exa fetches', async () => {
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
    ).rejects.toThrow(/non-identifying categories/u)
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
    ).rejects.toThrow(/non-identifying categories/u)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows compact non-identifying free-form category tags', async () => {
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
            createStructuredCandidate({
              resultIndex: 3,
              studyType: 'news_or_commentary',
            }),
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

  it('uses the shallow citation-free structured-output contract', () => {
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
