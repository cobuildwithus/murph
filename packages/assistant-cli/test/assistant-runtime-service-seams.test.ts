import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
  session: vi.fn(),
  readAutomation: vi.fn(),
  saveAutomation: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@murphai/assistant-engine/assistant-service', () => ({
  openAssistantConversationLocal: mocks.open,
  sendAssistantMessageLocal: mocks.send,
  updateAssistantSessionOptionsLocal: mocks.update,
}))
vi.mock('@murphai/assistant-engine/assistant-store', () => ({
  getAssistantSessionLocal: mocks.session,
  readAssistantAutomationState: mocks.readAutomation,
  saveAssistantAutomationState: mocks.saveAutomation,
}))
vi.mock('@murphai/assistant-engine/assistant-automation', () => ({
  runAssistantAutomation: mocks.run,
}))

import {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
} from '../src/assistant/service.ts'
import { runAssistantAutomation } from '../src/assistant/automation/run-loop.ts'

const vault = '/tmp/assistant-direct-fixture'

beforeEach(() => {
  vi.resetAllMocks()
})

test('direct local commands preserve inputs and assign explicit operator authority', async () => {
  const opened = { source: 'local-open' }
  const sent = { source: 'local-send' }
  mocks.open.mockResolvedValue(opened)
  mocks.send.mockResolvedValue(sent)
  const openInput = { alias: 'local-fixture', vault }
  const messageInput = { prompt: 'Review the saved note', vault }
  assert.equal(await openAssistantConversation(openInput), opened)
  assert.equal(await sendAssistantMessage(messageInput), sent)
  assert.deepEqual(mocks.open.mock.calls, [[openInput]])
  assert.deepEqual(mocks.send.mock.calls, [[{
    ...messageInput,
    operatorAuthority: 'direct-operator',
  }]])
  const updateInput = {
    providerOptions: { provider: 'codex-cli' as const, model: 'fixture-model' },
    sessionId: 'session_fixture',
    vault,
  }
  await updateAssistantSessionOptions(updateInput)
  assert.deepEqual(mocks.update.mock.calls, [[updateInput]])
})

test('explicit and saved local Linq routes fail before delivery', async () => {
  mocks.session.mockResolvedValue({ binding: { channel: 'iMessage' } })
  await assert.rejects(
    openAssistantConversation({ channel: 'linq', vault }),
    /Linq\/iMessage routes are no longer supported/u,
  )
  await assert.rejects(
    sendAssistantMessage({ prompt: 'hello', sessionId: 'session_fixture', vault }),
    /Linq\/iMessage routes are no longer supported/u,
  )
  await assert.rejects(
    sendAssistantMessage({ prompt: 'hello', conversation: { channel: 'i-message' }, vault }),
    /Linq\/iMessage routes are no longer supported/u,
  )
  assert.equal(mocks.open.mock.calls.length, 0)
  assert.equal(mocks.send.mock.calls.length, 0)
})

test('local session read failures cannot bypass delivery preflight', async () => {
  const failure = new Error('fixture read failed')
  mocks.session.mockRejectedValue(failure)
  await assert.rejects(
    sendAssistantMessage({ prompt: 'hello', sessionId: 'session_fixture', vault }),
    (error) => error === failure,
  )
  assert.equal(mocks.send.mock.calls.length, 0)
})

test('direct automation removes legacy local Linq state before running and preserves runtime inputs', async () => {
  const telegram = { channel: 'telegram', enabledAt: '2026-04-23T00:00:00.000Z', eligibleAfter: null }
  mocks.readAutomation.mockResolvedValue({
    autoReply: [{ ...telegram, channel: 'linq' }, telegram],
    updatedAt: '2026-04-23T00:00:00.000Z',
  })
  mocks.saveAutomation.mockImplementation(async (_vault, next) => {
    assert.equal(mocks.run.mock.calls.length, 0)
    return next
  })
  const result = { source: 'local-run' }
  mocks.run.mockResolvedValue(result)
  const signal = new AbortController().signal
  const input = { once: true, onEvent: () => undefined, signal, vault }
  assert.equal(await runAssistantAutomation(input), result)
  assert.deepEqual(mocks.saveAutomation.mock.calls[0]?.[1].autoReply, [telegram])
  assert.deepEqual(mocks.run.mock.calls, [[input]])
})

test('automation with no legacy local route does not rewrite state', async () => {
  mocks.readAutomation.mockResolvedValue({ autoReply: [] })
  await runAssistantAutomation({ once: true, vault })
  assert.equal(mocks.saveAutomation.mock.calls.length, 0)
  assert.equal(mocks.run.mock.calls.length, 1)
})
