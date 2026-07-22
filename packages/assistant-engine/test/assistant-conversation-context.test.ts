import { rm } from 'node:fs/promises'

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildAssistantConversationContextTranscriptText,
  readAssistantConversationContextTranscriptText,
  recordAssistantConversationContextLocal,
} from '../src/assistant/conversation-context.js'
import {
  appendAssistantConversationContextEntry,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.js'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((filePath) =>
    rm(filePath, { force: true, recursive: true })
  ))
})

describe('assistant conversation context', () => {
  it('resolves the exact direct session and records no outbound turn', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-conversation-context-route-',
    )
    cleanupPaths.push(parentRoot)
    const target = createAssistantModelTarget({
      approvalPolicy: 'never',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    })
    if (!target) {
      throw new Error('Expected assistant target.')
    }
    const context = 'Internal phone-call result context.'

    const result = await recordAssistantConversationContextLocal({
      actorId: 'actor-blind',
      bindingDeliveryTarget: 'chat-target',
      channel: 'linq',
      context,
      deliveryKind: 'thread',
      executionContext: {
        hosted: {
          defaultTarget: target,
          memberId: 'member-blind',
          userEnvKeys: [],
        },
      },
      idempotencyKey: 'phone-call.resulted:call-route',
      identityId: 'identity-blind',
      occurredAt: '2026-07-22T16:24:46.000Z',
      threadId: 'thread-blind',
      threadIsDirect: true,
      vault: vaultRoot,
    })

    expect(result.appended).toBe(true)
    expect(result.session.binding).toMatchObject({
      actorId: 'actor-blind',
      channel: 'linq',
      delivery: {
        kind: 'thread',
        target: 'chat-target',
      },
      identityId: 'identity-blind',
      threadId: 'thread-blind',
      threadIsDirect: true,
    })
    const entries = await listAssistantTranscriptEntries(
      vaultRoot,
      result.session.sessionId,
    )
    expect(entries).toHaveLength(1)
    expect(readAssistantConversationContextTranscriptText(
      entries[0]?.text ?? '',
    )).toBe(context)
  })

  it('appends once and invalidates provider-native resume without creating a turn', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-conversation-context-',
    )
    cleanupPaths.push(parentRoot)
    const target = createAssistantModelTarget({
      approvalPolicy: 'never',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    })
    if (!target) {
      throw new Error('Expected assistant target.')
    }
    const resolved = await resolveAssistantSession({
      actorId: 'actor-blind',
      bindingDeliveryTarget: 'chat-target',
      channel: 'linq',
      deliveryKind: 'thread',
      identityId: 'identity-blind',
      target,
      threadId: 'thread-blind',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    const resumeState = {
      routeFingerprint: 'route-fingerprint',
      threadId: 'provider-thread',
    }
    await saveAssistantSession(vaultRoot, {
      ...resolved.session,
      codexResume: resumeState,
      resumeState,
    })
    const context = [
      'Internal conversation context for the next attended user turn.',
      '<untrusted_phone_call_result>not booked</untrusted_phone_call_result>',
    ].join('\n')
    const transcriptText = buildAssistantConversationContextTranscriptText({
      context,
      idempotencyKey: 'phone-call.resulted:call-1',
    })

    const first = await appendAssistantConversationContextEntry({
      createdAt: '2026-07-22T16:24:46.000Z',
      sessionId: resolved.session.sessionId,
      text: transcriptText,
      vault: vaultRoot,
    })
    await saveAssistantSession(vaultRoot, {
      ...first.session,
      codexResume: resumeState,
      resumeState,
    })
    const second = await appendAssistantConversationContextEntry({
      createdAt: '2026-07-22T16:24:46.000Z',
      sessionId: resolved.session.sessionId,
      text: transcriptText,
      vault: vaultRoot,
    })

    expect(first.appended).toBe(true)
    expect(first.session.codexResume).toBeNull()
    expect(first.session.resumeState).toBeNull()
    expect(second.appended).toBe(false)
    expect(second.session.codexResume).toBeNull()
    expect(second.session.resumeState).toBeNull()
    await expect(listAssistantTranscriptEntries(
      vaultRoot,
      resolved.session.sessionId,
    )).resolves.toEqual([{
      createdAt: '2026-07-22T16:24:46.000Z',
      kind: 'status',
      schema: 'murph.assistant-transcript-entry.v1',
      text: transcriptText,
    }])
    expect(readAssistantConversationContextTranscriptText(transcriptText)).toBe(context)
  })
})
