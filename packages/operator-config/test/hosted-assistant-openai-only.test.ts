import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  ensureHostedAssistantOperatorDefaults,
  readHostedAssistantApiKeyEnvName,
} from '../src/hosted-assistant-config.ts'
import { readOperatorConfig } from '../src/operator-config.ts'

test.each(['venice', 'hosted-custom-inference', 'vercel-ai-gateway', 'ollama', 'lmstudio'])(
  'hosted assistant rejects removed provider %s without saving a fallback',
  async (provider) => {
    const homeDirectory = await mkdtemp(path.join(tmpdir(), 'murph-provider-rejection-'))
    try {
      await assert.rejects(ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: { HOSTED_ASSISTANT_PROVIDER: provider },
        homeDirectory,
      }), /must be openai for hosted assistant execution/u)
      assert.equal(await readOperatorConfig(homeDirectory), null)
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  },
)

test('hosted assistant only recognizes the OpenAI API key', () => {
  assert.equal(readHostedAssistantApiKeyEnvName({ VENICE_API_KEY: 'retired-key', MURPH_CUSTOM_INFERENCE_API_KEY: 'retired-key' }), null)
  assert.equal(readHostedAssistantApiKeyEnvName({ OPENAI_API_KEY: 'openai-test-key' }), 'OPENAI_API_KEY')
})
