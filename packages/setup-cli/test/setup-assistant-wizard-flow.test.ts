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
  'assistant wizard saves the default Codex cloud selection',
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
      const reviewOutput = await waitForRenderedText(
        flush,
        readOutput,
        /Review/u,
      )
      assert.match(reviewOutput, /ChatGPT \/ Codex sign-in/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantModelProvider: null,
        assistantOss: false,
        assistantPreset: 'codex',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard can finish with the Codex local model selection',
  async () => {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupAssistantWizard({
        initialAssistantOss: true,
        initialAssistantPreset: 'codex',
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
      assert.match(reviewOutput, /Codex local model/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantModelProvider: null,
        assistantOss: true,
        assistantPreset: 'codex',
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
  'assistant wizard can go back from review before saving',
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
      await writeInput('\u001B[B')
      await writeInput('\r')
      await waitForRenderedText(flush, readOutput, /Review/u)
      await writeInput('\u001B[D')
      await waitForRenderedText(
        flush,
        readOutput,
        /How should Murph answer\?/u,
      )
      await writeInput('\r')
      await waitForRenderedText(flush, readOutput, /Review/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantModelProvider: null,
        assistantOss: true,
        assistantPreset: 'codex',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)

test.sequential(
  'assistant wizard can finish with Venice as the model provider',
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
      await writeInput('\u001B[B')
      await writeInput('\u001B[B')
      await writeInput('\r')
      const reviewOutput = await waitForRenderedText(
        flush,
        readOutput,
        /Review/u,
      )
      assert.match(reviewOutput, /Venice\.ai/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantModelProvider: 'venice',
        assistantOss: false,
        assistantPreset: 'codex',
      })
    })
  },
  WIZARD_TEST_TIMEOUT_MS,
)
