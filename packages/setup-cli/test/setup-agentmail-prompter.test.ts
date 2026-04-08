import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { afterEach, test, vi } from 'vitest'

const readlineMockState = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as string[],
  sigintHandler: null as null | (() => void),
}))

vi.mock('node:readline', () => ({
  createInterface: () => ({
    once(event: string, handler: () => void) {
      if (event === 'SIGINT') {
        readlineMockState.sigintHandler = handler
      }
    },
    removeListener(event: string, handler: () => void) {
      if (event === 'SIGINT' && readlineMockState.sigintHandler === handler) {
        readlineMockState.sigintHandler = null
      }
    },
    question(prompt: string, callback: (answer: string) => void) {
      readlineMockState.prompts.push(prompt)
      const answer = readlineMockState.answers.shift() ?? ''
      callback(answer)
    },
    close() {},
  }),
}))

afterEach(() => {
  readlineMockState.answers = []
  readlineMockState.prompts = []
  readlineMockState.sigintHandler = null
  vi.resetModules()
})

test('setup agentmail prompter loops on invalid inbox choices before selecting a valid inbox', async () => {
  readlineMockState.answers = ['9', '2']
  const { createSetupAgentmailPrompter } = await import('../src/setup-agentmail.ts')
  const output = new PassThrough()
  let rendered = ''
  output.on('data', (chunk) => {
    rendered += chunk.toString()
  })

  const prompter = createSetupAgentmailPrompter({
    input: new PassThrough(),
    output,
  })

  const selected = await prompter.chooseInbox({
    inboxes: [
      {
        inbox_id: 'inbox-1',
        email: 'one@example.com',
        display_name: 'One',
      },
      {
        inbox_id: 'inbox-2',
        email: 'two@example.com',
        display_name: 'Team Inbox',
      },
    ],
  })

  assert.equal(selected?.inbox_id, 'inbox-2')
  assert.equal(readlineMockState.prompts.length, 2)
  assert.match(rendered, /multiple AgentMail inboxes/u)
  assert.match(rendered, /Enter a number between 1 and 2/u)
})

test('setup agentmail prompter trims manual inbox ids and allows empty inbox selections', async () => {
  readlineMockState.answers = ['', '  inbox@example.com  ']
  const { createSetupAgentmailPrompter } = await import('../src/setup-agentmail.ts')
  const prompter = createSetupAgentmailPrompter({
    input: new PassThrough(),
    output: new PassThrough(),
  })

  assert.equal(
    await prompter.chooseInbox({
      inboxes: [
        {
          inbox_id: 'inbox-1',
          email: 'one@example.com',
          display_name: 'One',
        },
      ],
    }),
    null,
  )
  assert.equal(await prompter.promptManualInboxId(), 'inbox@example.com')
})
