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
      boundaryDefaultTarget: sessionTarget,
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

  it('keeps automation target overrides out of durable session targets', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-turn-scoped-',
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

    const resolved = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: sessionTarget,
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(false)
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.session.target).toEqual(sessionTarget)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      created.session.sessionId,
    ])
    expect(sessions[0]?.target).toEqual(sessionTarget)
  })

  it('creates automation target override sessions with the durable base target', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-turn-scoped-create-',
    )
    cleanupPaths.push(parentRoot)

    const durableTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
    })

    const resolved = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: durableTarget,
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(true)
    expect(resolved.session.target).toEqual(durableTarget)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      resolved.session.sessionId,
    ])
    expect(sessions[0]?.target).toEqual(durableTarget)
  })

  it('rebinds a group conversation-key session when the active speaker and direct/group flag drift as members are added and removed', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-group-rebind-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'linq-member-a',
      channel: 'linq',
      identityId: 'linq-line',
      target: createCodexTarget(),
      threadId: 'group-thread',
      threadIsDirect: false,
      vault: vaultRoot,
    })
    expect(created.session.binding.actorId).toBe('linq-member-a')
    expect(created.session.binding.threadIsDirect).toBe(false)

    // A later message on the SAME group thread arrives from a different member,
    // and the direct/group flag flips because the roster changed (the assistant
    // was removed and re-added). The conversation key (channel|identity|thread)
    // is unchanged, so this must rebind the existing session rather than throw a
    // routing conflict and strand the inbound message.
    const resolved = await resolveAssistantSession({
      actorId: 'linq-member-b',
      channel: 'linq',
      createIfMissing: false,
      identityId: 'linq-line',
      threadId: 'group-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })

    expect(resolved.created).toBe(false)
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.resolutionDiagnostics).toMatchObject({
      conversationLookupMatchedScope: 'thread',
      sessionResolutionLookupSource: 'conversation-key',
    })
    expect(resolved.session.binding.actorId).toBe('linq-member-b')
    expect(resolved.session.binding.threadIsDirect).toBe(true)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      created.session.sessionId,
    ])
  })

  it('still rejects a session-id resume that retargets a bound audience unless rebind is explicitly allowed', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-session-id-guard-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'linq-member-a',
      channel: 'linq',
      identityId: 'linq-line',
      target: createCodexTarget(),
      threadId: 'group-thread',
      threadIsDirect: false,
      vault: vaultRoot,
    })

    // Resolving BY session id is an explicit resume, not a routing-boundary
    // match, so retargeting to a different audience must still fail closed
    // without allowBindingRebind.
    await expect(
      resolveAssistantSession({
        actorId: 'linq-member-b',
        channel: 'linq',
        createIfMissing: false,
        identityId: 'different-line',
        sessionId: created.session.sessionId,
        threadId: 'other-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_ROUTING_CONFLICT',
    })
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
