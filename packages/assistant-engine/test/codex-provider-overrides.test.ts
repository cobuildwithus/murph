import { describe, expect, it } from 'vitest'

import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import {
  resolveCodexModelProviderConfigOverrides,
} from '../src/assistant/providers/helpers.ts'

describe('Codex provider config overrides', () => {

  it('keeps reserved OpenAI provider ids on built-in Codex config', () => {
    expect(resolveCodexModelProviderConfigOverrides('openai')).toBeUndefined()
  })

  it('fails closed when a provider id has no known provider config', () => {
    expect(() =>
      resolveCodexModelProviderConfigOverrides('unknown-provider'),
    ).toThrow(/Unknown Codex model provider: unknown-provider/u)
  })


  it('allows hosted-local test provider ids to use the prewritten Codex config', () => {
    const overrides =
      resolveCodexModelProviderConfigOverrides('openai-local-test')

    expect(overrides).toBeUndefined()
  })

  it('allows hosted ChatGPT auth to use the prewritten Codex config', () => {
    const overrides = resolveCodexModelProviderConfigOverrides(
      HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
    )

    expect(overrides).toBeUndefined()
  })
})
