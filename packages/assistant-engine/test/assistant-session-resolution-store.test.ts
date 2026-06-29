import { rm } from 'node:fs/promises'

import {
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  listAssistantSessions,
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import {
  resolveAssistantSessionForMessage,
} from '../src/assistant/session-resolution.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant session resolution store integration', () => {
  it('preserves conversation-key sessions before applying partial message target overrides', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-store-',
    )
    cleanupPaths.push(parentRoot)

    const sessionTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
    })
    const created = await resolveAssistantSession({
      actorId: 'linq-participant',
      channel: 'linq',
      identityId: 'linq-identity',
      target: sessionTarget,
      threadId: 'linq-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    await saveAssistantSession(vaultRoot, {
      ...created.session,
      resumeState: {
        routeFingerprint: created.session.providerOptions.continuityFingerprint,
        threadId: 'thread_low',
      },
    })

    const resolved = await resolveAssistantSessionForMessage({
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        reasoningEffort: 'high',
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(false)
    expect(resolved.resolutionDiagnostics).toMatchObject({
      conversationLookupMatchedScope: 'thread',
      sessionResolutionLookupSource: 'conversation-key',
    })
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.session.target).toEqual(createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'high',
    }))
    expect(resolved.session.resumeState).toBeNull()

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      created.session.sessionId,
    ])
  })
})

function createCodexTarget(
  overrides: Partial<{
    modelProvider: string
    model: string
    profile: string
    reasoningEffort: 'high' | 'low' | 'medium'
  }> = {},
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    provider: 'codex-cli',
    model: 'gpt-5-codex',
    ...overrides,
  })
  if (!target) {
    throw new Error('Expected assistant model target.')
  }

  return target
}
