import assert from 'node:assert/strict'
import { test } from 'vitest'

import { runSetupAssistantWizard } from '../src/setup-assistant-wizard.js'
import { stripAnsi, withMockProcessTty } from './helpers.ts'

type SetupAssistantWizardInput = Parameters<typeof runSetupAssistantWizard>[0]

async function waitForAssistantWizardText(
  flush: () => Promise<void>,
  readOutput: () => string,
  pattern: RegExp,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const output = stripAnsi(readOutput())
    if (pattern.test(output)) {
      return output
    }

    await flush()
  }

  return stripAnsi(readOutput())
}

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

    await waitForAssistantWizardText(flush, readOutput, /How should Murph answer\?/u)
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

      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\r')
      await waitForAssistantWizardText(flush, readOutput, /Review/u)
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
)

test.sequential(
  'assistant wizard can switch to a named compatible provider and finish the flow',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantApiKeyEnv: '  CUSTOM_KEY  ',
        initialAssistantBaseUrl: ' https://example.test/v1 ',
        initialAssistantPreset: 'openai-compatible',
        initialAssistantProviderName: ' custom-provider ',
      })

      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\u001B[B')
      await writeInput('\u001B[B')
      await writeInput('\r')
      const reviewOutput = await waitForAssistantWizardText(
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
)

test.sequential(
  'assistant wizard can go back from review to the method step before saving',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'codex',
      })

      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\u001B[B')
      await writeInput('\r')
      await waitForAssistantWizardText(flush, readOutput, /Review/u)
      await writeInput('\u001B[D')
      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\r')
      await waitForAssistantWizardText(flush, readOutput, /Review/u)
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
)

test.sequential(
  'assistant wizard lets the user back out of the method step and switch providers',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantPreset: 'codex',
      })

      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph connect to OpenAI\?/u,
      )
      await writeInput('\u001B')
      await waitForAssistantWizardText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\u001B[B')
      await writeInput('\r')
      const reviewOutput = await waitForAssistantWizardText(
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
)
