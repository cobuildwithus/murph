import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as daemonClientBarrel from '../src/assistant/daemon-client.ts'
import * as daemonClientSurface from '../src/assistant-daemon-client.js'
import * as runtimeBarrel from '../src/assistant/runtime.ts'
import * as runtimeSurface from '../src/assistant-runtime.js'

test('assistant barrel modules re-export their package-level seams', () => {
  assert.equal(
    daemonClientBarrel.canUseAssistantDaemonForMessage,
    daemonClientSurface.canUseAssistantDaemonForMessage,
  )
  assert.equal(
    daemonClientBarrel.maybeSendAssistantMessageViaDaemon,
    daemonClientSurface.maybeSendAssistantMessageViaDaemon,
  )
  assert.equal(
    daemonClientBarrel.resolveAssistantDaemonClientConfig,
    daemonClientSurface.resolveAssistantDaemonClientConfig,
  )
  assert.equal(runtimeBarrel.runAssistantChat, runtimeSurface.runAssistantChat)
})
