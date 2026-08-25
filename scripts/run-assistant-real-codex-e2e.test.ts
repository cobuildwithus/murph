import { describe, expect, it } from 'vitest'

import {
  buildAssistantRealCodexRunEnv,
  buildAssistantRealCodexVitestArgs,
  parseAssistantRealCodexRunArgs,
} from './run-assistant-real-codex-e2e.ts'

describe('assistant real Codex local runner', () => {
  it('defaults to subscription auth and requires one focused test pattern', () => {
    expect(parseAssistantRealCodexRunArgs([
      '--test',
      'adaptive wearable no-data outreach',
    ])).toEqual({
      authMode: 'subscription',
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
      help: false,
      model: 'gpt-5.6-sol',
      testPattern: 'member preference',
    })
  })

  it('sets only the live-test controls owned by the selected auth mode', () => {
    const options = parseAssistantRealCodexRunArgs(['focused journey'])
    expect(buildAssistantRealCodexRunEnv({
      options,
      sourceEnv: {
        MURPH_REAL_CODEX_COMMAND: 'legacy-wrapper',
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
  })

  it('builds the package-relative focused Vitest invocation', () => {
    expect(buildAssistantRealCodexVitestArgs('adaptive wearable')).toEqual([
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
      'adaptive wearable',
    ])
  })
})
