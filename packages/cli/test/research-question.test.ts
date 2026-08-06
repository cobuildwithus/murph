import { Cli } from 'incur'
import { describe, expect, it, vi } from 'vitest'

import {
  parseResearchScoutCliProfileInput,
  registerResearchCommands,
} from '../src/commands/research.js'
import {
  fetchExaResearchScoutCandidates,
} from '../src/research-scout-client.js'

const QUESTION_PROFILE = {
  question:
    'What do recent randomized trials and systematic reviews show about creatine and cognitive performance in healthy adults?',
} as const

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
    description: 'focused research question test cli',
    version: '0.0.0-test',
  })
  registerResearchCommands(cli)
  return cli
}

describe('focused public research questions', () => {
  it('accepts a question profile through the existing research scout input parser', () => {
    expect(parseResearchScoutCliProfileInput(QUESTION_PROFILE)).toMatchObject({
      ...QUESTION_PROFILE,
      topics: [],
      behaviors: [],
    })
    expect(parseResearchScoutCliProfileInput({
      profile: QUESTION_PROFILE,
    })).toMatchObject({
      ...QUESTION_PROFILE,
      topics: [],
      behaviors: [],
    })
  })

  it('documents both focused questions and compact tag profiles on the existing command', async () => {
    const output: string[] = []

    await createResearchCli().serve(['research', 'scout', '--help'], {
      exit() {},
      stdout(chunk) {
        output.push(chunk)
      },
    })

    const help = output.join('')
    expect(help).toContain('focused public question')
    expect(help).toContain('compact non-identifying tag profile')
    expect(help).toContain('{"question":"..."}')
    expect(help).toContain('--input @file.json')
    expect(help).toContain('--input -')
    expect(help).toContain(
      'Preserve public study titles, researcher names, institutions, and other public entities',
    )
  })

  it('gives actionable guidance for invalid focused-question input', () => {
    expect(() => parseResearchScoutCliProfileInput({
      question: 'What should I do about my LDL 181 mg/dL?',
    })).toThrow(/either .*focused public question or a compact profile/u)
  })

  it('uses the existing Exa request path and reports the sent profile kind', async () => {
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
      profile: parseResearchScoutCliProfileInput(QUESTION_PROFILE),
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
      expect.stringContaining(QUESTION_PROFILE.question),
    )
    expect(requestBody.systemPrompt).toEqual(
      expect.stringContaining('focused public question'),
    )
    expect(result.privacy).toEqual({
      persistedByTool: false,
      rawVaultValuesSent: false,
      sentProfileKind: 'public_question',
      tokenSource: 'env',
    })
    expect(result.response).toEqual(providerPayload)
  })

  it('rejects private question text before any Exa request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(fetchExaResearchScoutCandidates({
      profile: {
        question: 'What should I do about my LDL 181 mg/dL?',
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
    }, {
      env: {
        EXA_API_KEY: 'exa-test-token',
      },
      fetchImpl,
    })).rejects.toThrow(/focused public questions/u)

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
