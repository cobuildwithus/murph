import { Cli } from 'incur'
import { describe, expect, it, vi } from 'vitest'

import {
  parseResearchScoutCliProfileInput,
  registerResearchCommands,
} from '../src/commands/research.js'
import {
  createPayloadSchemaResult,
} from '../src/commands/payload-schema-command.js'
import {
  fetchExaResearchScoutCandidates,
} from '../src/research-scout-client.js'
import {
  researchScoutProfileSchema,
} from '../src/research-scout.js'
import { vaultCliCommandDescriptors } from '../src/vault-cli-command-manifest.js'

const FOCUSED_PROFILE = {
  mode: 'focused',
  topics: ['cognition'],
  supplements: ['creatine'],
  conditionsOrConcerns: ['healthy adults'],
  goals: ['cognitive performance'],
} as const

const FOCUSED_PROFILE_FIELDS = [
  'topics',
  'biomarkers',
  'behaviors',
  'supplements',
  'conditionsOrConcerns',
  'goals',
  'activeExperiments',
] as const

const PRIVATE_FOCUSED_VALUES = [
  'sampleperson recurring headaches',
  'TeSt SuBjEcT supplement use'.toLowerCase(),
  'examplelab staff sleep',
  'participant 7304 headache',
  'tenant at 456 sample boulevard',
  'passphrase demo-access',
  'intake summary persistent sleeplessness',
] as const

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
    description: 'focused research scope test cli',
    version: '0.0.0-test',
  })
  registerResearchCommands(cli)
  return cli
}

describe('focused structured research', () => {
  it('accepts focused compact categories through the existing scout input parser', () => {
    expect(parseResearchScoutCliProfileInput(FOCUSED_PROFILE)).toMatchObject({
      ...FOCUSED_PROFILE,
      behaviors: [],
      biomarkers: [],
    })
    expect(parseResearchScoutCliProfileInput({
      profile: FOCUSED_PROFILE,
    })).toMatchObject({
      ...FOCUSED_PROFILE,
      behaviors: [],
      biomarkers: [],
    })
  })

  it('documents focused single-scout input and routes broad discovery to batch', async () => {
    const output: string[] = []

    await createResearchCli().serve(['research', 'scout', '--help'], {
      exit() {},
      stdout(chunk) {
        output.push(chunk)
      },
    })

    const help = output.join('')
    expect(help).toContain('focused structured scope')
    expect(help).toContain('{"mode":"focused"}')
    expect(help).toContain('exact server-owned public concepts')
    expect(help).toContain('supplements=[caffeine, creatine')
    expect(help).toContain('--input @file.json')
    expect(help).toContain('--input -')
    expect(help).toContain(
      'resultIndex maps to a returned source with a title, web URL',
    )
    expect(help).toContain('otherwise report no usable current source')
    expect(help).toContain('Use research scout-batch for broad discovery or automation')

    const payloadSchema = createPayloadSchemaResult({
      command: 'research scout --input',
      schema: researchScoutProfileSchema,
    })
    const serializedPayloadSchema = JSON.stringify(payloadSchema.schema)
    expect(serializedPayloadSchema).toContain('cognition, memory')
    expect(serializedPayloadSchema).toContain('creatine, magnesium')
    expect(serializedPayloadSchema).toContain('healthy adults, insomnia')
  })

  it('keeps the static command manifest aligned with the focused-only scout', () => {
    const researchDescriptor = vaultCliCommandDescriptors.find(
      (descriptor) => descriptor.id === 'research',
    )
    if (
      !researchDescriptor
      || !('leafCommands' in researchDescriptor)
      || !researchDescriptor.leafCommands
    ) {
      throw new Error('Expected the research command descriptor to define leaf commands.')
    }

    const payloadSchema = researchDescriptor.leafCommands.find(
      (command) => command.path.join(' ') === 'research payload-schema',
    )
    const scout = researchDescriptor.leafCommands.find(
      (command) => command.path.join(' ') === 'research scout',
    )
    if (!scout || !('hint' in scout)) {
      throw new Error('Expected the research scout descriptor to define a hint.')
    }

    expect(payloadSchema?.description).toContain('focused-scope')
    expect(scout?.description).toContain('focused structured scope')
    expect(scout?.hint).toContain('{"mode":"focused"}')
    expect(scout?.hint).toContain('exact server-owned public concepts')
    expect(scout?.hint).toContain('conditionsOrConcerns=[adults, anxiety')
    expect(scout?.hint).toContain('resultIndex maps to a returned source')
    expect(scout?.hint).toContain('without fabricating or repeating')
    expect(scout?.hint).toContain('broad discovery and automation use research scout-batch')
  })

  it('gives actionable guidance for arbitrary question input', () => {
    expect(() => parseResearchScoutCliProfileInput({
      question: 'What should I do about my LDL 181 mg/dL?',
    })).toThrow(/expects compact profile bucket fields/u)
  })

  it('uses the existing Exa request path and reports the focused profile kind', async () => {
    const providerPayload = {
      output: {
        content: {
          candidates: [],
        },
      },
      results: [],
    }
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(providerPayload)
    )

    const result = await fetchExaResearchScoutCandidates({
      profile: parseResearchScoutCliProfileInput(FOCUSED_PROFILE),
      since: '2021-01-01T00:00:00.000Z',
      until: '2026-08-06T00:00:00.000Z',
      maxCandidates: 6,
    }, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [target, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(target)).toBe('https://api.exa.ai/search')
    expect(init?.method).toBe('POST')
    const requestBody = JSON.parse(String(init?.body)) as {
      category?: unknown
      query?: unknown
      systemPrompt?: unknown
      type?: unknown
    }
    expect(requestBody.type).toBe('deep-reasoning')
    expect(requestBody.category).toBe('research paper')
    expect(requestBody.query).toEqual(
      expect.stringContaining('Topics: cognition'),
    )
    expect(requestBody.query).toEqual(
      expect.stringContaining('Supplements: creatine'),
    )
    expect(requestBody.query).not.toEqual(
      expect.stringContaining('Question:'),
    )
    expect(requestBody.systemPrompt).toEqual(
      expect.stringContaining('focused structured scope'),
    )
    expect(result.privacy).toEqual({
      persistedByTool: false,
      rawVaultValuesSent: false,
      sentProfileKind: 'focused_profile',
      tokenSource: 'env',
    })
    expect(result.response).toEqual(providerPayload)
  })

  it.each([
    "What evidence applies to sampleperson's recurring migraines?",
    "What evidence applies to SAMPLEPERSON's recurring migraines?",
    "What evidence applies to SaMpLePeRsOn's recurring migraines?",
    'What evidence applies to sampleperson taking lithium?',
    'What evidence applies to s a m p l e p e r s o n with recurring migraines?',
    'What does the research say about the resident at 123 Main Street?',
  ])('rejects arbitrary question prose before any Exa request: %s', async (question) => {
    const fetchImpl = vi.fn<typeof fetch>()
    const rawInput = {
      profile: {
        question,
        topics: [],
        biomarkers: [],
        behaviors: [],
        supplements: [],
        conditionsOrConcerns: [],
        goals: [],
        activeExperiments: [],
      },
      since: '2021-01-01T00:00:00.000Z',
      until: '2026-08-06T00:00:00.000Z',
      maxCandidates: 6,
    }

    await expect(fetchExaResearchScoutCandidates(rawInput, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })).rejects.toThrow()

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects private-shaped values in every focused field before any Exa request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    for (const field of FOCUSED_PROFILE_FIELDS) {
      for (const value of PRIVATE_FOCUSED_VALUES) {
        await expect(fetchExaResearchScoutCandidates({
          profile: {
            mode: 'focused',
            topics: [],
            biomarkers: [],
            behaviors: [],
            supplements: [],
            conditionsOrConcerns: [],
            goals: [],
            activeExperiments: [],
            [field]: [value],
          },
          since: '2021-01-01T00:00:00.000Z',
          until: '2026-08-06T00:00:00.000Z',
          maxCandidates: 6,
        }, {
          env: {
            EXA_API_KEY: 'exa-test-token',
          },
          fetchImpl,
        })).rejects.toThrow(/exact server-owned public concepts/u)
      }
    }

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects mode-less values in every field before any Exa request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    for (const field of FOCUSED_PROFILE_FIELDS) {
      await expect(fetchExaResearchScoutCandidates({
        profile: {
          topics: [],
          biomarkers: [],
          behaviors: [],
          supplements: [],
          conditionsOrConcerns: [],
          goals: [],
          activeExperiments: [],
          [field]: ['sleep'],
        },
        since: '2021-01-01T00:00:00.000Z',
        until: '2026-08-06T00:00:00.000Z',
        maxCandidates: 6,
      }, {
        env: { EXA_API_KEY: 'exa-test-token' },
        fetchImpl,
      })).rejects.toThrow()
    }

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
