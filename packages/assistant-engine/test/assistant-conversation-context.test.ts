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
  it('records only on the exact initiating direct session', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-conversation-context-origin-',
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
    const telegram = await resolveAssistantSession({
      actorId: 'telegram-actor',
      bindingDeliveryTarget: 'telegram-chat',
      channel: 'telegram',
      deliveryKind: 'thread',
      identityId: 'telegram-identity',
      target,
      threadId: null,
      threadIsDirect: true,
      vault: vaultRoot,
    })
    const linq = await resolveAssistantSession({
      actorId: 'linq-actor',
      bindingDeliveryTarget: 'linq-chat',
      channel: 'linq',
      deliveryKind: 'thread',
      identityId: 'linq-identity',
      target,
      threadId: 'linq-chat',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    const context = 'The pharmacy call completed.'

    const result = await recordAssistantConversationContextLocal({
      context,
      idempotencyKey: 'phone-call.resulted:call-origin',
      occurredAt: '2026-07-22T16:24:46.000Z',
      sessionId: telegram.session.sessionId,
      vault: vaultRoot,
    })

    expect(result.session.sessionId).toBe(telegram.session.sessionId)
    expect(await listAssistantTranscriptEntries(
      vaultRoot,
      telegram.session.sessionId,
    )).toHaveLength(1)
    expect(await listAssistantTranscriptEntries(
      vaultRoot,
      linq.session.sessionId,
    )).toHaveLength(0)
  })

  it('fails closed when the initiating session does not exist', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-conversation-context-route-',
    )
    cleanupPaths.push(parentRoot)
    const context = 'Internal phone-call result context.'

    await expect(recordAssistantConversationContextLocal({
      context,
      idempotencyKey: 'phone-call.resulted:call-route',
      occurredAt: '2026-07-22T16:24:46.000Z',
      sessionId: 'session_missing',
      vault: vaultRoot,
    })).rejects.toThrow(/not found/u)
  })

  it('fails closed when the initiating session is not direct', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-conversation-context-group-',
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
    const group = await resolveAssistantSession({
      actorId: 'group-actor',
      bindingDeliveryTarget: 'group-chat',
      channel: 'linq',
      deliveryKind: 'thread',
      identityId: 'group-identity',
      target,
      threadId: 'group-chat',
      threadIsDirect: false,
      vault: vaultRoot,
    })

    await expect(recordAssistantConversationContextLocal({
      context: 'Internal phone-call result context.',
      idempotencyKey: 'phone-call.resulted:group-call',
      occurredAt: '2026-07-22T16:24:46.000Z',
      sessionId: group.session.sessionId,
      vault: vaultRoot,
    })).rejects.toThrow(/existing direct session/u)
  })

  it('bounds provider replay context by UTF-8 bytes', () => {
    const transcriptText = buildAssistantConversationContextTranscriptText({
      context: '界'.repeat(2_000),
      idempotencyKey: 'phone-call.resulted:multibyte',
    })
    const context = readAssistantConversationContextTranscriptText(transcriptText)

    expect(context).not.toBeNull()
    expect(Buffer.byteLength(context ?? '', 'utf8')).toBeLessThanOrEqual(4_000)
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
