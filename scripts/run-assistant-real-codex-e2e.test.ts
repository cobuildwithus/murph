import { describe, expect, it } from 'vitest'

import {
  buildAssistantRealCodexListArgs,
  buildAssistantRealCodexLoginEnv,
  buildAssistantRealCodexRunEnv,
  buildAssistantRealCodexVitestArgs,
  executeAssistantRealCodexRun,
  parseAssistantRealCodexRunArgs,
  type AssistantRealCodexCommandRequest,
} from './run-assistant-real-codex-e2e.ts'

describe('assistant real Codex local runner', () => {
  it('defaults to subscription auth and requires one focused test pattern', () => {
    expect(parseAssistantRealCodexRunArgs([
      '--test',
      'adaptive wearable no-data outreach',
    ])).toEqual({
      authMode: 'subscription',
      codexHome: null,
      help: false,
      model: null,
      testPattern: 'adaptive wearable no-data outreach',
    })
    expect(() => parseAssistantRealCodexRunArgs([])).toThrow(
      'A focused --test name pattern is required.',
    )
  })

  it('supports explicit provider auth and model selection', () => {
    expect(parseAssistantRealCodexRunArgs([
      'member preference',
      '--auth',
      'provider',
      '--model',
      'gpt-5.6-sol',
    ])).toEqual({
      authMode: 'provider',
      codexHome: null,
      help: false,
      model: 'gpt-5.6-sol',
      testPattern: 'member preference',
    })
  })

  it('supports one explicit Codex home for subscription auth', () => {
    expect(parseAssistantRealCodexRunArgs([
      'member preference',
      '--codex-home',
      '/alternate-codex-home',
    ])).toEqual({
      authMode: 'subscription',
      codexHome: '/alternate-codex-home',
      help: false,
      model: null,
      testPattern: 'member preference',
    })
    expect(() => parseAssistantRealCodexRunArgs([
      'member preference',
      '--auth',
      'provider',
      '--codex-home',
      '/alternate-codex-home',
    ])).toThrow('--codex-home is available only with subscription auth.')
    expect(() => parseAssistantRealCodexRunArgs([
      'member preference',
      '--codex-home',
      'relative-codex-home',
    ])).toThrow('--codex-home requires an absolute path.')
  })

  it('sets only the live-test controls owned by the selected auth mode', () => {
    const options = parseAssistantRealCodexRunArgs(['focused journey'])
    expect(buildAssistantRealCodexRunEnv({
      options,
      sourceEnv: {
        CODEX_HOME: '/alternate-codex-home',
        MURPH_REAL_CODEX_COMMAND: 'legacy-wrapper',
        MURPH_REAL_CODEX_HOME: '/ambient-real-codex-home',
        MURPH_REAL_CODEX_MODEL_PROVIDER: 'openai-env',
        OPENAI_API_KEY: 'provider-value',
        PATH: '/usr/bin:/bin',
      },
    })).toEqual({
      MURPH_REAL_CODEX_AUTH: 'subscription',
      MURPH_RUN_REAL_CODEX_E2E: '1',
      OPENAI_API_KEY: 'provider-value',
      PATH: '/usr/bin:/bin',
    })
    expect(buildAssistantRealCodexLoginEnv({
      CODEX_HOME: '/alternate-codex-home',
      HOME: '/normal-home',
      PATH: '/usr/bin:/bin',
    })).toEqual({
      HOME: '/normal-home',
      PATH: '/usr/bin:/bin',
    })
    const selectedRunEnv = buildAssistantRealCodexRunEnv({
      options: parseAssistantRealCodexRunArgs([
        'focused journey',
        '--codex-home',
        '/selected-codex-home',
      ]),
      sourceEnv: {
        CODEX_HOME: '/ambient-codex-home',
        HOME: '/normal-home',
        MURPH_REAL_CODEX_HOME: '/ambient-real-codex-home',
        PATH: '/usr/bin:/bin',
      },
    })
    expect(selectedRunEnv.CODEX_HOME).toBeUndefined()
    expect(selectedRunEnv.MURPH_REAL_CODEX_HOME).toBe('/selected-codex-home')
    const selectedLoginEnv = buildAssistantRealCodexLoginEnv(
      {
        CODEX_HOME: '/ambient-codex-home',
        HOME: '/normal-home',
        MURPH_REAL_CODEX_HOME: '/ambient-real-codex-home',
        PATH: '/usr/bin:/bin',
      },
      '/selected-codex-home',
    )
    expect(selectedLoginEnv.CODEX_HOME).toBe('/selected-codex-home')
    expect(selectedLoginEnv.MURPH_REAL_CODEX_HOME).toBeUndefined()
  })

  it('builds package-relative list and focused run invocations', () => {
    expect(buildAssistantRealCodexListArgs('adaptive wearable')).toEqual([
      '--dir',
      'packages/assistant-engine',
      'exec',
      'vitest',
      'list',
      '--config',
      'vitest.config.ts',
      'test/assistant-codex-real-e2e.test.ts',
      '--testNamePattern',
      'adaptive wearable',
      '--tagsFilter',
      'real-codex-live',
      '--json',
    ])
    expect(buildAssistantRealCodexVitestArgs(
      'real Codex adaptive wearable > saves (10 days)',
    )).toEqual([
      '--dir',
      'packages/assistant-engine',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      '--no-coverage',
      'test/assistant-codex-real-e2e.test.ts',
      '--testNamePattern',
      '^real Codex adaptive wearable saves \\(10 days\\)$',
      '--tagsFilter',
      'real-codex-live',
    ])
  })

  it.each([
    {
      listed: [],
      message: 'did not match a live journey',
    },
    {
      listed: [
        { name: 'real Codex journey one' },
        { name: 'real Codex journey two' },
      ],
      message: 'matched 2 live journeys',
    },
  ])('blocks $message before login or a paid run', ({ listed, message }) => {
    const requests: AssistantRealCodexCommandRequest[] = []
    const errors: string[] = []
    const status = executeAssistantRealCodexRun(
      parseAssistantRealCodexRunArgs(['real Codex']),
      {
        runCommand: (request) => {
          requests.push(request)
          return {
            status: 0,
            stdout: JSON.stringify(listed),
          }
        },
        sourceEnv: {
          CODEX_HOME: '/alternate-codex-home',
          PATH: '/usr/bin:/bin',
        },
        writeStderr: (value) => errors.push(value),
        writeStdout: () => undefined,
      },
    )

    expect(status).toBe(2)
    expect(errors.join('')).toContain(message)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.stdio).toBe('capture')
  })

  it('routes one explicit subscription home through preflight and the live journey', () => {
    const requests: AssistantRealCodexCommandRequest[] = []
    const output: string[] = []
    const status = executeAssistantRealCodexRun(
      parseAssistantRealCodexRunArgs([
        'adaptive wearable',
        '--codex-home',
        '/selected-codex-home',
      ]),
      {
        runCommand: (request) => {
          requests.push(request)
          return request.stdio === 'capture'
            ? {
                status: 0,
                stdout: JSON.stringify([
                  { name: 'real Codex adaptive wearable journey' },
                ]),
              }
            : { status: 0 }
        },
        sourceEnv: {
          CODEX_HOME: '/ambient-codex-home',
          HOME: '/normal-home',
          MURPH_REAL_CODEX_HOME: '/ambient-real-codex-home',
          PATH: '/usr/bin:/bin',
        },
        writeStderr: () => undefined,
        writeStdout: (value) => output.push(value),
      },
    )

    expect(status).toBe(0)
    expect(requests.map(({ command, stdio }) => ({ command, stdio }))).toEqual([
      { command: 'pnpm', stdio: 'capture' },
      { command: 'codex', stdio: 'ignore' },
      { command: 'pnpm', stdio: 'inherit' },
    ])
    expect(requests[0]?.env).toMatchObject({
      HOME: '/normal-home',
      MURPH_REAL_CODEX_HOME: '/selected-codex-home',
    })
    expect(requests[0]?.env.CODEX_HOME).toBeUndefined()
    expect(requests[1]?.env).toMatchObject({
      CODEX_HOME: '/selected-codex-home',
      HOME: '/normal-home',
    })
    expect(requests[1]?.env.MURPH_REAL_CODEX_HOME).toBeUndefined()
    expect(requests[2]?.env).toMatchObject({
      HOME: '/normal-home',
      MURPH_REAL_CODEX_HOME: '/selected-codex-home',
    })
    expect(requests[2]?.env.CODEX_HOME).toBeUndefined()
    expect(requests[2]?.args).toContain(
      '^real Codex adaptive wearable journey$',
    )
    expect(output.join('')).toContain(
      'use a dedicated home for production-like evidence',
    )
  })

  it('keeps provider mode free of a subscription login preflight', () => {
    const requests: AssistantRealCodexCommandRequest[] = []
    const status = executeAssistantRealCodexRun(
      parseAssistantRealCodexRunArgs([
        'provider journey',
        '--auth',
        'provider',
      ]),
      {
        runCommand: (request) => {
          requests.push(request)
          return request.stdio === 'capture'
            ? {
                status: 0,
                stdout: JSON.stringify([{ name: 'provider journey' }]),
              }
            : { status: 0 }
        },
        sourceEnv: {
          CODEX_HOME: '/ambient-provider-home',
          OPENAI_API_KEY: 'provider-value',
          PATH: '/usr/bin:/bin',
        },
        writeStderr: () => undefined,
        writeStdout: () => undefined,
      },
    )

    expect(status).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests.every(({ command }) => command === 'pnpm')).toBe(true)
    expect(requests[1]?.env.CODEX_HOME).toBe('/ambient-provider-home')
  })
})
