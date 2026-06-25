import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.ts'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.ts'
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  applyAssistantVaultFileSendApprovalResult,
  buildAssistantVaultFileSendApprovalRequest,
  readVerifiedAssistantVaultFileBytes,
  requestAssistantVaultFileSend,
  resolveAssistantVaultFileResponseMedia,
} from '../src/assistant/vault-file-send.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })))
})

describe('assistant vault-file send', () => {
  it('creates one idempotent awaiting action bound to the exact file and destination', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-send-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'first version')

    const approvalPort = {
      request: vi.fn().mockResolvedValue({
        approvalId: `haa_${'a'.repeat(32)}`,
        approvalUrl: 'https://murph.test/approve/haa_test',
        expiresAt: '2026-06-24T12:15:00.000Z',
        status: 'pending' as const,
      }),
    }
    const request = {
      actionApprovalPort: approvalPort,
      bindingDelivery: {
        kind: 'thread' as const,
        target: 'chat_123',
      },
      channel: 'linq',
      deliveryIdempotencyKey: 'hosted-turn-delivery-123',
      identityId: 'member_123',
      ref: 'documents/report.pdf',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    }

    const first = await requestAssistantVaultFileSend(request)
    const second = await requestAssistantVaultFileSend(request)
    const intents = await listAssistantOutboxIntents(vaultRoot)

    expect(second.intentId).toBe(first.intentId)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      intentId: first.intentId,
      status: 'awaiting_approval',
      media: [
        expect.objectContaining({
          filename: 'report.pdf',
          kind: 'vault_file',
          ref: 'documents/report.pdf',
          sizeBytes: 13,
        }),
      ],
    })
    expect(approvalPort.request).toHaveBeenCalledTimes(2)
    expect(approvalPort.request.mock.calls[0]?.[0]).toEqual(
      approvalPort.request.mock.calls[1]?.[0],
    )
    expect(approvalPort.request.mock.calls[0]?.[0]).toMatchObject({
      actionId: first.intentId,
      actionKind: 'vault.file.send.v1',
      actionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
  })

  it('requires a new action when file bytes change and rejects post-approval mutation', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-change-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    const filePath = path.join(vaultRoot, 'documents', 'report.pdf')
    await writeFile(filePath, 'version one')

    const before = await resolveAssistantVaultFileResponseMedia({
      ref: 'documents/report.pdf',
      vaultRoot,
    })
    await writeFile(filePath, 'version two')
    const after = await resolveAssistantVaultFileResponseMedia({
      ref: 'documents/report.pdf',
      vaultRoot,
    })

    expect(after.sha256).not.toBe(before.sha256)
    await expect(readVerifiedAssistantVaultFileBytes({
      file: before,
      vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_VAULT_FILE_CHANGED_AFTER_APPROVAL',
    })
  })

  it('moves only the approved exact action into the normal pending outbox lifecycle', async () => {
    const now = new Date('2026-06-24T12:00:00.000Z')
    const intent = createVaultFileIntent()
    const request = buildAssistantVaultFileSendApprovalRequest(intent)
    const approved = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalId: `haa_${'b'.repeat(32)}`,
        status: 'approved',
      },
      intent,
      now,
    })

    expect(request).toMatchObject({
      actionId: intent.intentId,
      actionKind: 'vault.file.send.v1',
    })
    expect(approved).toMatchObject({
      nextAttemptAt: now.toISOString(),
      status: 'pending',
    })
  })

  it('keeps the approved action request stable when a pending file-send intent resolves its target', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-approved-target-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'approved content')

    const requests: ReturnType<typeof buildAssistantVaultFileSendApprovalRequest>[] = []
    const approvalPort = {
      request: vi.fn(async (request: ReturnType<typeof buildAssistantVaultFileSendApprovalRequest>) => {
        requests.push(request)
        if (requests.length === 1) {
          return {
            approvalId: `haa_${'d'.repeat(32)}`,
            approvalUrl: 'https://murph.test/approve/haa_test',
            expiresAt: '2026-06-24T12:15:00.000Z',
            status: 'pending' as const,
          }
        }
        if (requests[0] && request.actionFingerprint !== requests[0].actionFingerprint) {
          throw Object.assign(
            new Error('This action id is already bound to a different sensitive action.'),
            { code: 'ACTION_APPROVAL_IDENTITY_CONFLICT' },
          )
        }
        return {
          approvalId: `haa_${'d'.repeat(32)}`,
          status: 'approved' as const,
        }
      }),
    }
    const baseRequest = {
      actionApprovalPort: approvalPort,
      channel: 'linq',
      deliveryIdempotencyKey: 'hosted-turn-delivery-target-stable',
      identityId: 'member_123',
      ref: 'documents/report.pdf',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    }

    const first = await requestAssistantVaultFileSend(baseRequest)
    const [queuedIntent] = await listAssistantOutboxIntents(vaultRoot)
    expect(queuedIntent).toMatchObject({
      bindingDelivery: { kind: 'thread', target: 'chat_123' },
      intentId: first.intentId,
      status: 'awaiting_approval',
    })
    const approved = await requestAssistantVaultFileSend(baseRequest)
    await expect(requestAssistantVaultFileSend({
      ...baseRequest,
      bindingDelivery: { kind: 'thread' as const, target: 'chat_123' },
    })).resolves.toMatchObject({
      intentId: first.intentId,
      status: 'approved',
    })

    expect(approved).toMatchObject({
      intentId: first.intentId,
      status: 'approved',
    })
    expect(requests).toHaveLength(3)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[2]).toEqual(requests[0])
  })

  it('repairs approved legacy targetless intents without changing approval identity', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-approved-legacy-target-',
    )
    tempRoots.push(parentRoot)
    const now = new Date('2026-06-24T12:00:00.000Z')
    const legacy = {
      ...createVaultFileIntent(),
      bindingDelivery: null,
      explicitTarget: null,
      targetFingerprint: 'legacy-targetless-fingerprint',
    }
    const approvedRequest = buildAssistantVaultFileSendApprovalRequest(legacy)

    const approved = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalId: `haa_${'e'.repeat(32)}`,
        status: 'approved',
      },
      intent: legacy,
      now,
    })

    expect(approved).toMatchObject({
      bindingDelivery: { kind: 'thread', target: 'chat_123' },
      nextAttemptAt: now.toISOString(),
      status: 'pending',
      targetFingerprint: legacy.targetFingerprint,
    })
    expect(buildAssistantVaultFileSendApprovalRequest(approved)).toEqual(
      approvedRequest,
    )

    await saveAssistantOutboxIntent(vaultRoot, approved)
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created',
      providerThreadId: 'chat_123',
      target: 'chat_123',
      targetKind: 'thread',
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: approved.intentId,
      vault: vaultRoot,
    })

    expect(sendLinq).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: approved.deliveryIdempotencyKey,
      media: [expect.objectContaining({ kind: 'vault_file', ref: 'documents/report.pdf' })],
      target: 'chat_123',
      targetKind: 'thread',
    }))
    expect(dispatched.deliveryError).toBeNull()
    expect(dispatched.intent.status).toBe('sent')
  })

  it('never dispatches an awaiting-approval intent even when forced', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-blocked-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'content')

    const approvalPort = {
      request: vi.fn().mockResolvedValue({
        approvalId: `haa_${'c'.repeat(32)}`,
        approvalUrl: 'https://murph.test/approve/haa_test',
        expiresAt: '2026-06-24T12:15:00.000Z',
        status: 'pending' as const,
      }),
    }
    const queued = await requestAssistantVaultFileSend({
      actionApprovalPort: approvalPort,
      bindingDelivery: { kind: 'thread', target: 'chat_123' },
      channel: 'linq',
      deliveryIdempotencyKey: 'hosted-turn-delivery-blocked',
      ref: 'documents/report.pdf',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    })
    const sendLinq = vi.fn()

    const result = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: queued.intentId,
      vault: vaultRoot,
    })

    expect(result.intent.status).toBe('awaiting_approval')
    expect(sendLinq).not.toHaveBeenCalled()
  })

  it('hands the approval link back to the normal assistant reply path', async () => {
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      sendVaultFile: vi.fn(async () => ({
        approvalUrl: 'https://murph.test/approve/haa_test',
        filename: 'report.pdf',
        status: 'pending' as const,
      })),
      vaultFileSendAvailable: true,
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: {
        kind: 'send-vault-file',
        ref: 'documents/report.pdf',
      },
    })

    expect(result.finalActionPatch).toBeUndefined()
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify({
      approvalUrl: 'https://murph.test/approve/haa_test',
      filename: 'report.pdf',
      status: 'pending',
    }))
  })
})

function createVaultFileIntent() {
  return {
    actorId: null,
    attemptCount: 0,
    bindingDelivery: { kind: 'thread' as const, target: 'chat_123' },
    channel: 'linq',
    createdAt: '2026-06-24T11:00:00.000Z',
    dedupeKey: 'dedupe_123',
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: 'delivery_123',
    deliverySource: null,
    deliveryTransportIdempotent: true,
    explicitTarget: null,
    identityId: 'member_123',
    intentId: 'outbox_123',
    lastAttemptAt: null,
    lastError: null,
    media: [{
      contentType: 'application/pdf',
      filename: 'report.pdf',
      kind: 'vault_file' as const,
      ref: 'documents/report.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
    }],
    message: 'Attached: report.pdf',
    nextAttemptAt: '2026-06-24T11:15:00.000Z',
    operation: null,
    preparedDispatchToken: null,
    replyToMessageId: null,
    schema: 'murph.assistant-outbox-intent.v1' as const,
    sentAt: null,
    sessionId: 'session_123',
    status: 'awaiting_approval' as const,
    subject: null,
    targetFingerprint: 'target_123',
    threadId: 'chat_123',
    threadIsDirect: true,
    turnId: 'turn_123',
    updatedAt: '2026-06-24T11:00:00.000Z',
  }
}
