import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const packageSurfaceMocks = vi.hoisted(() => ({
  formatForegroundLogLine: vi.fn(),
  registerAssistantCommands: vi.fn(),
  resolveAssistantDaemonClientConfig: vi.fn(),
  runAssistantChat: vi.fn(),
  runAssistantChatWithInk: vi.fn(),
}))

vi.mock('../src/assistant-runtime.js', () => ({
  runAssistantChat: packageSurfaceMocks.runAssistantChat,
}))

vi.mock('../src/assistant/ui/ink.js', () => ({
  runAssistantChatWithInk: packageSurfaceMocks.runAssistantChatWithInk,
}))

vi.mock('../src/assistant-daemon-client.js', () => ({
  resolveAssistantDaemonClientConfig:
    packageSurfaceMocks.resolveAssistantDaemonClientConfig,
}))

vi.mock('../src/run-terminal-logging.js', () => ({
  formatForegroundLogLine: packageSurfaceMocks.formatForegroundLogLine,
}))

vi.mock('../src/commands/assistant.js', () => ({
  registerAssistantCommands: packageSurfaceMocks.registerAssistantCommands,
}))

vi.mock('../src/assistant/automation.js', () => ({}))
vi.mock('../src/assistant/cron.js', () => ({}))
vi.mock('../src/assistant/doctor.js', () => ({}))
vi.mock('../src/assistant/doctor-security.js', () => ({}))
vi.mock('../src/assistant/outbox.js', () => ({}))
vi.mock('../src/assistant/service.js', () => ({}))
vi.mock('../src/assistant/status.js', () => ({}))
vi.mock('../src/assistant/stop.js', () => ({}))
vi.mock('../src/assistant/store.js', () => ({}))

beforeEach(() => {
  vi.resetModules()
})

test('package surface re-exports the owned top-level seams from the root barrel', async () => {
  const packageSurface = await import('../src/index.js')
  const assistantChatInkSurface = await import('../src/assistant-chat-ink.js')

  assert.equal(packageSurface.registerAssistantCommands, packageSurfaceMocks.registerAssistantCommands)
  assert.equal(packageSurface.runAssistantChat, packageSurfaceMocks.runAssistantChat)
  assert.equal(
    packageSurface.runAssistantChatWithInk,
    packageSurfaceMocks.runAssistantChatWithInk,
  )
  assert.equal(
    packageSurface.resolveAssistantDaemonClientConfig,
    packageSurfaceMocks.resolveAssistantDaemonClientConfig,
  )
  assert.equal(
    packageSurface.formatForegroundLogLine,
    packageSurfaceMocks.formatForegroundLogLine,
  )
  assert.equal(
    assistantChatInkSurface.runAssistantChatWithInk,
    packageSurfaceMocks.runAssistantChatWithInk,
  )
})
