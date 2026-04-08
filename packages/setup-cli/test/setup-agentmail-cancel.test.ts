import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'

import { createSetupAgentmailPrompter } from '../src/setup-agentmail.ts'

const readlineMockState = vi.hoisted(() => ({
  sigintHandler: null as null | (() => void),
}))

vi.mock('node:readline', () => ({
  createInterface: () => ({
    once(event: string, handler: () => void) {
      if (event === 'SIGINT') {
        readlineMockState.sigintHandler = handler
      }
    },
    removeListener() {},
    question(_prompt: string, _callback: (answer: string) => void) {
      readlineMockState.sigintHandler?.()
    },
    close() {},
  }),
}))

afterEach(() => {
  readlineMockState.sigintHandler = null
})

test('setup agentmail prompter rejects with setup_cancelled on SIGINT', async () => {
  const prompter = createSetupAgentmailPrompter({
    input: new PassThrough(),
    output: new PassThrough(),
  })

  await assert.rejects(
    prompter.promptManualInboxId(),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'setup_cancelled',
  )
})
