import { describe, expect, it } from 'vitest'

import { buildAssistantCliProcessEnv } from '../src/assistant-cli-tools/execution-adapters.ts'

describe('buildAssistantCliProcessEnv', () => {
  it('does not inject unrelated hosted assistant referenced secrets', () => {
    const env = buildAssistantCliProcessEnv({
      ambientEnv: {
        HOME: '/tmp/murph-home',
        HOSTED_ASSISTANT_API_KEY_ENV: 'STRIPE_SECRET_KEY',
        OPENAI_API_KEY: 'openai-secret',
        PATH: '/usr/bin',
        STRIPE_SECRET_KEY: 'stripe-secret',
      },
    })

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBe('STRIPE_SECRET_KEY')
    expect(env.OPENAI_API_KEY).toBe('openai-secret')
    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
    expect(env.NO_COLOR).toBe('1')
  })

  it('includes shared assistant provider env names needed by hosted assistants', () => {
    const env = buildAssistantCliProcessEnv({
      ambientEnv: {
        HOME: '/tmp/murph-home',
        PATH: '/usr/bin',
        VERCEL_AI_API_KEY: 'vercel-secret',
      },
    })

    expect(env.VERCEL_AI_API_KEY).toBe('vercel-secret')
  })

  it('canonicalizes Windows Path into PATH for child launcher resolution', () => {
    const env = buildAssistantCliProcessEnv({
      ambientEnv: {
        HOME: '/tmp/murph-home',
        Path: 'C:\\Windows\\System32',
      } as NodeJS.ProcessEnv,
    })

    expect(env.PATH).toMatch(/C:\\Windows\\System32$/)
    expect(env.Path).toBeUndefined()
  })
})
