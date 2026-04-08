import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

const daemonClientBarrelMocks = vi.hoisted(() => ({
  canUseAssistantDaemonForMessage: vi.fn(),
  maybeSendAssistantMessageViaDaemon: vi.fn(),
  resolveAssistantDaemonClientConfig: vi.fn(),
}))

const runtimeBarrelMocks = vi.hoisted(() => ({
  runAssistantChat: vi.fn(),
}))

vi.mock('../src/assistant-daemon-client.js', () => ({
  canUseAssistantDaemonForMessage:
    daemonClientBarrelMocks.canUseAssistantDaemonForMessage,
  maybeSendAssistantMessageViaDaemon:
    daemonClientBarrelMocks.maybeSendAssistantMessageViaDaemon,
  resolveAssistantDaemonClientConfig:
    daemonClientBarrelMocks.resolveAssistantDaemonClientConfig,
}))

vi.mock('../src/assistant-runtime.js', () => ({
  runAssistantChat: runtimeBarrelMocks.runAssistantChat,
}))

import * as daemonClientBarrel from '../src/assistant/daemon-client.ts'
import * as runtimeBarrel from '../src/assistant/runtime.ts'

test('assistant barrel modules re-export their package-level seams', () => {
  assert.equal(
    daemonClientBarrel.canUseAssistantDaemonForMessage,
    daemonClientBarrelMocks.canUseAssistantDaemonForMessage,
  )
  assert.equal(
    daemonClientBarrel.maybeSendAssistantMessageViaDaemon,
    daemonClientBarrelMocks.maybeSendAssistantMessageViaDaemon,
  )
  assert.equal(
    daemonClientBarrel.resolveAssistantDaemonClientConfig,
    daemonClientBarrelMocks.resolveAssistantDaemonClientConfig,
  )
  assert.equal(runtimeBarrel.runAssistantChat, runtimeBarrelMocks.runAssistantChat)
})
