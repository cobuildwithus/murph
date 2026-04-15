import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as assistantChatInkSurface from '../src/assistant-chat-ink.js'
import * as assistantCommandsSurface from '../src/commands/assistant.js'
import * as assistantDaemonClientSurface from '../src/assistant-daemon-client.js'
import * as assistantRuntimeSurface from '../src/assistant-runtime.js'
import * as packageSurface from '../src/index.js'
import * as terminalLoggingSurface from '../src/run-terminal-logging.js'

test('package surface re-exports the owned top-level seams from the root barrel', () => {
  assert.equal(packageSurface.registerAssistantCommands, assistantCommandsSurface.registerAssistantCommands)
  assert.equal(packageSurface.runAssistantChat, assistantRuntimeSurface.runAssistantChat)
  assert.equal(
    packageSurface.runAssistantChatWithInk,
    assistantChatInkSurface.runAssistantChatWithInk,
  )
  assert.equal(
    packageSurface.resolveAssistantDaemonClientConfig,
    assistantDaemonClientSurface.resolveAssistantDaemonClientConfig,
  )
  assert.equal(
    packageSurface.formatForegroundLogLine,
    terminalLoggingSurface.formatForegroundLogLine,
  )
})
