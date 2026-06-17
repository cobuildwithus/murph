import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { describe, expect, it, vi } from 'vitest'

import {
  buildExaResearchScoutRequest,
  fetchExaResearchScoutCandidates,
} from '../src/research-scout-client.js'
import type { ResearchScoutInput } from '../src/research-scout.js'

const RESEARCH_SCOUT_INPUT = {
  profile: {
    topics: ['sleep'],
    biomarkers: ['hsCRP'],
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

describe('research scout', () => {
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

  it('posts one deep-reasoning research-paper search with a compact tag profile', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
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
      }))

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
      type?: unknown
    }
    expect(requestBody.type).toBe('deep-reasoning')
    expect(requestBody.category).toBe('research paper')
    expect(requestBody.startPublishedDate).toBe(RESEARCH_SCOUT_INPUT.since)
    expect(requestBody.endPublishedDate).toBe(RESEARCH_SCOUT_INPUT.until)
    expect(requestBody.numResults).toBe(2)
    expect(requestBody.query).toEqual(expect.stringContaining('sleep'))
    expect(requestBody.query).toEqual(expect.stringContaining('hsCRP'))
    expect(requestBody.query).not.toEqual(expect.stringContaining('raw lab'))
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
    expect(result.candidates).toEqual([
      expect.objectContaining({
        clinicianDiscussionOnly: true,
        matchedProfileTags: ['sleep', 'better recovery'],
        sourceName: 'Example Journal',
        sourceUrl: 'https://example.test/research/sleep-recovery',
        title: 'Example sleep recovery review',
      }),
    ])
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
    ).rejects.toThrow(
      'Research scout profile tags must be non-identifying categories',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows compact non-identifying numeric category tags', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output: {
          content: {
            candidates: [createStructuredCandidate()],
          },
        },
        results: [{
          title: 'Kept source',
          url: 'https://example.test/kept',
        }],
      }))

    const result = await fetchExaResearchScoutCandidates({
      ...RESEARCH_SCOUT_INPUT,
      profile: {
        ...RESEARCH_SCOUT_INPUT.profile,
        behaviors: ['zone 2 training'],
        conditionsOrConcerns: ['type 2 diabetes'],
        supplements: ['omega-3'],
      },
    }, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.candidates).toHaveLength(1)
  })

  it('filters weak, generic, and high-hype candidates while preserving warnings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
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
      }))

    const result = await fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(result.candidates.map((candidate) => candidate.title)).toEqual(['Kept source'])
    expect(result.warnings).toEqual([
      'Dropped 5 weak, generic, or unlinked research candidates.',
    ])
  })

  it('rejects malformed structured output or unlinked search results as provider response errors', async () => {
    const invalidStructuredOutputFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output: {
          content: '{"candidates":[{"resultIndex":0}]}',
        },
        results: [],
      }))

    await expect(
      fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl: invalidStructuredOutputFetch,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_invalid_response',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)

    const invalidUrlFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output: {
          content: {
            candidates: [createStructuredCandidate()],
          },
        },
        results: [{
          title: 'Invalid URL source',
          url: 'not a valid URL',
        }],
      }))

    await expect(
      fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl: invalidUrlFetch,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_invalid_response',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)

    const nonWebUrlFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output: {
          content: {
            candidates: [createStructuredCandidate()],
          },
        },
        results: [{
          title: 'Non-web URL source',
          url: 'file:///tmp/research.pdf',
        }],
      }))

    await expect(
      fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl: nonWebUrlFetch,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_invalid_response',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)

    const missingUrlFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        output: {
          content: {
            candidates: [createStructuredCandidate()],
          },
        },
        results: [{
          title: 'Missing URL source',
        }],
      }))

    await expect(
      fetchExaResearchScoutCandidates(RESEARCH_SCOUT_INPUT, {
        env: {
          EXA_API_KEY: 'exa-test-token',
        },
        fetchImpl: missingUrlFetch,
      }),
    ).rejects.toMatchObject({
      code: 'research_exa_invalid_response',
      name: 'VaultCliError',
    } satisfies Partial<VaultCliError>)
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
