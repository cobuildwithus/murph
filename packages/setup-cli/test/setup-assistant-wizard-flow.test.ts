import assert from 'node:assert/strict'
import { afterAll, test, vi } from 'vitest'

const originalCi = vi.hoisted(() => {
  const previousCi = process.env.CI
  process.env.CI = 'false'
  return previousCi
})

afterAll(() => {
  if (originalCi === undefined) {
    delete process.env.CI
    return
  }

  process.env.CI = originalCi
})

import { runSetupAssistantWizard } from '../src/setup-assistant-wizard.js'
import { waitForRenderedText, withMockProcessTty } from './helpers.ts'

type SetupAssistantWizardInput = Parameters<typeof runSetupAssistantWizard>[0]
const WIZARD_TEST_TIMEOUT_MS = 90_000

async function expectAssistantWizardCancellation(
  input: SetupAssistantWizardInput,
  triggerCancel: (context: {
    flush: () => Promise<void>
    readOutput: () => string
    writeInput: (value: string) => Promise<void>
  }) => Promise<void>,
): Promise<void> {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupAssistantWizard(input)
    const rejection = assert.rejects(
      wizardResultPromise,
      /Murph model selection was cancelled/u,
    )

    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await triggerCancel({ flush, readOutput, writeInput })

    await rejection
  })
}

test.sequential(
  'assistant wizard walks the default OpenAI sign-in flow to a saved selection',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'codex',
      })

      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(flush, readOutput, /Review/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantApiKeyEnv: null,
        assistantBaseUrl: null,
        assistantOss: false,
        assistantPreset: 'codex',
        assistantProviderName: null,
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard can finish with a named compatible provider',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'openai-compatible',
        initialAssistantProviderPreset: 'openrouter',
      })

      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      const reviewOutput = await waitForRenderedText(
        flush,
        readOutput,
        /Review/u,
      )
      assert.match(reviewOutput, /OpenRouter/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantApiKeyEnv: 'OPENROUTER_API_KEY',
        assistantBaseUrl: 'https://openrouter.ai/api/v1',
        assistantOss: false,
        assistantPreset: 'openai-compatible',
        assistantProviderName: 'openrouter',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard surfaces the cancellation error when the user quits from the provider step',
  async () => {
    await expectAssistantWizardCancellation(
      {
        initialAssistantPreset: 'codex',
      },
      async ({ writeInput }) => {
        await writeInput('q')
      },
    )
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard also cancels when escape is pressed on the provider step',
  async () => {
    await expectAssistantWizardCancellation(
      {
        initialAssistantPreset: 'codex',
      },
      async ({ writeInput }) => {
        await writeInput('\u001B')
      },
    )
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard can go back from review to the method step before saving',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'codex',
      })

      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\u001B[B')
      await writeInput('\r')
      await waitForRenderedText(flush, readOutput, /Review/u)
      await writeInput('\u001B[D')
      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(flush, readOutput, /Review/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantApiKeyEnv: 'OPENAI_API_KEY',
        assistantBaseUrl: 'https://api.openai.com/v1',
        assistantOss: false,
        assistantPreset: 'openai-compatible',
        assistantProviderName: 'openai',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard lets the user back out of the method step and switch providers',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'codex',
      })

      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\u001B')
      await flush()
      await writeInput('\u001B[B')
      await flush()
      await writeInput('\r')
      const reviewOutput = await waitForRenderedText(
        flush,
        readOutput,
        /Review/u,
      )
      assert.match(reviewOutput, /Assistant: Vercel AI Gateway/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantApiKeyEnv: 'VERCEL_AI_API_KEY',
        assistantBaseUrl: 'https://ai-gateway.vercel.sh/v1',
        assistantOss: false,
        assistantPreset: 'openai-compatible',
        assistantProviderName: 'vercel-ai-gateway',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)
