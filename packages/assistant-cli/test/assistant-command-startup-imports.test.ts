import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

// Registering assistant commands must not load the interactive ink chat
// surface (ink/react/yoga-layout). That static import leaked into the eager
// startup graph of every full-path vault-cli invocation before 2026-06-11 and
// multiplied hosted per-invocation CLI latency. The chat surface is mocked to
// throw at load, so any re-introduced static import fails these tests.
const forbiddenStartupModules = [
  '../src/assistant-chat-ink.js',
  '../src/assistant/ui/ink.js',
] as const

afterEach(() => {
  vi.resetModules()
  for (const moduleId of forbiddenStartupModules) {
    vi.doUnmock(moduleId)
  }
})

function errorChainMentionsStartupHotPath(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.message.includes('must stay off the assistant command startup hot path')) {
      return true
    }
  }

  return false
}

function mockForbiddenStartupModules() {
  vi.resetModules()
  for (const moduleId of forbiddenStartupModules) {
    vi.doMock(moduleId, () => {
      throw new Error(
        `${moduleId} must stay off the assistant command startup hot path`,
      )
    })
  }
}

test('forbidden startup module mocks intercept their module ids', async () => {
  mockForbiddenStartupModules()

  // Guards the other test against passing vacuously: if a mock id stopped
  // resolving to the module the production code imports, this import would
  // succeed instead of rejecting.
  for (const moduleId of forbiddenStartupModules) {
    await assert.rejects(
      import(moduleId),
      (error: unknown) => errorChainMentionsStartupHotPath(error),
      `expected the throwing mock for ${moduleId} to intercept its import`,
    )
  }
})

test('assistant command registration does not import the ink chat surface at module load', async () => {
  mockForbiddenStartupModules()

  await import('../src/commands/assistant.js')
})
