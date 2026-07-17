import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.ts'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import {
  createAssistantOutboxIntent,
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  applyAssistantVaultFileSendApprovalResult,
  buildAssistantVaultFileDeliveryIdempotencyKey,
  buildAssistantVaultFileSendApprovalRequest,
  buildAssistantVaultFileSendApprovalRequestForTarget,
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
  it('parks one durable file delivery before returning a pending approval', async () => {
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
      deliveryTransportIdempotent: true,
      identityId: 'member_123',
      ref: 'documents/report.pdf',
      replyToMessageId: 'original_message_123',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    }

    const first = await requestAssistantVaultFileSend(request)
    const second = await requestAssistantVaultFileSend({
      ...request,
      actorId: 'actor_after_session_restore',
      identityId: 'identity_after_session_restore',
      replyToMessageId: 'original_message_456',
      threadId: 'thread_metadata_after_session_restore',
      turnId: 'turn_456',
    })
    const intents = await listAssistantOutboxIntents(vaultRoot)
    expect(second.file).toEqual(first.file)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      deliveryIdempotencyKey:
        `assistant-vault-file:haa_${'a'.repeat(32)}:2026-06-24T12:15:00.000Z`,
      media: [first.file],
      message: 'Here it is: report.pdf',
      nextAttemptAt: '2026-06-24T12:05:00.000Z',
      status: 'awaiting_approval',
    })
    expect(first).toMatchObject({
      approvalUrl: 'https://murph.test/approve/haa_test',
      filename: 'report.pdf',
      status: 'pending',
    })
    expect(approvalPort.request).toHaveBeenCalledTimes(2)
    expect(approvalPort.request.mock.calls[0]?.[0]).toEqual(
      approvalPort.request.mock.calls[1]?.[0],
    )
    expect(approvalPort.request.mock.calls[0]?.[0]).toMatchObject({
      actionId: expect.stringMatching(/^vault-file-send:[0-9a-f]{64}$/u),
      actionKind: 'vault.file.send.v1',
      actionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(buildAssistantVaultFileSendApprovalRequest(intents[0]!)).toEqual(
      approvalPort.request.mock.calls[0]?.[0],
    )
  })

  it('uses a distinct parked owner for a refreshed approval cycle', () => {
    const approvalId = `haa_${'a'.repeat(32)}`

    expect(buildAssistantVaultFileDeliveryIdempotencyKey({
      approvalId,
      expiresAt: '2026-06-24T12:15:00.000Z',
    })).not.toBe(buildAssistantVaultFileDeliveryIdempotencyKey({
      approvalId,
      expiresAt: '2026-06-24T12:30:00.000Z',
    }))
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

  it('leaves ordinary vault-file permissions unchanged', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-ordinary-permissions-',
    )
    tempRoots.push(parentRoot)
    const filePath = path.join(vaultRoot, 'documents', 'ordinary.pdf')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, 'ordinary vault file')
    await chmod(filePath, 0o666)

    const media = await resolveAssistantVaultFileResponseMedia({
      ref: 'documents/ordinary.pdf',
      vaultRoot,
    })
    await expect(readVerifiedAssistantVaultFileBytes({
      file: media,
      vaultRoot,
    })).resolves.toEqual(Buffer.from('ordinary vault file'))
    expect((await stat(filePath)).mode & 0o777).toBe(0o666)
  })

  it('adopts the exact assistant-owned runtime delivery for initial prep and persisted retries', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-runtime-delivery-',
    )
    tempRoots.push(parentRoot)
    const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`
    const filePath = path.join(vaultRoot, ...ref.split('/'))
    const contents = Buffer.from('generated report')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, contents)
    await chmod(filePath, 0o666)

    const approvalRequest = vi.fn().mockResolvedValue({
      approvalId: `haa_${'c'.repeat(32)}`,
      approvalUrl: 'https://murph.test/approve/runtime-delivery',
      expiresAt: '2026-06-24T12:15:00.000Z',
      status: 'pending' as const,
    })
    const prepared = await requestAssistantVaultFileSend({
      actionApprovalPort: { request: approvalRequest },
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-runtime-delivery',
      },
      channel: 'linq',
      identityId: 'identity-runtime-delivery',
      ref,
      sessionId: 'session-runtime-delivery',
      threadId: 'thread-runtime-delivery',
      threadIsDirect: true,
      turnId: 'turn-runtime-delivery',
      vault: vaultRoot,
    })
    expect(prepared).toMatchObject({
      filename: 'report.pdf',
      status: 'pending',
    })
    expect(approvalRequest).toHaveBeenCalledTimes(1)

    const [persistedIntent] = await listAssistantOutboxIntents(vaultRoot)
    const [persistedMedia] = persistedIntent?.media ?? []
    if (!persistedMedia || persistedMedia.kind !== 'vault_file') {
      throw new Error('Expected one persisted vault-file descriptor.')
    }

    expect(persistedMedia.filename).toBe('report.pdf')
    expect(persistedMedia.ref).not.toBe(ref)
    expect(persistedMedia.ref.startsWith(
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report-`,
    )).toBe(true)
    expect(persistedMedia.ref.endsWith('.pdf')).toBe(true)
    const ownedPath = path.join(vaultRoot, ...persistedMedia.ref.split('/'))
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(ownedPath)).mode & 0o777).toBe(0o600)

    await expect(resolveAssistantVaultFileResponseMedia({
      displayFilename: persistedMedia.filename,
      ref: persistedMedia.ref,
      vaultRoot,
    })).resolves.toEqual(persistedMedia)

    await chmod(ownedPath, 0o666)
    await expect(readVerifiedAssistantVaultFileBytes({
      file: persistedMedia,
      vaultRoot,
    })).resolves.toEqual(contents)
    expect((await stat(ownedPath)).mode & 0o777).toBe(0o600)

    for (const rejectedRef of [
      '.runtime/operations/assistant/outbox/intent.json',
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/nested/report.pdf`,
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/.hidden/report.pdf`,
      '.hidden/report.pdf',
    ]) {
      await expect(readVerifiedAssistantVaultFileBytes({
        file: {
          ...persistedMedia,
          ref: rejectedRef,
        },
        vaultRoot,
      })).rejects.toMatchObject({
        code: 'ASSISTANT_VAULT_FILE_REF_INVALID',
      })
    }
  })

  it('keeps distinct sends separate when they reuse the same staging name', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-staging-collision-',
    )
    tempRoots.push(parentRoot)
    const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`
    const stagingPath = path.join(vaultRoot, ...ref.split('/'))
    await mkdir(path.dirname(stagingPath), { recursive: true })

    const contentsA = Buffer.from('generated report A')
    const contentsB = Buffer.from('generated report B bytes')
    const sendWithPendingApproval = async (input: {
      approvalSlug: string
      toolCallId: string
    }) => {
      const approvalRequest = vi.fn().mockResolvedValue({
        approvalId: `haa_${input.approvalSlug.repeat(32).slice(0, 32)}`,
        approvalUrl: `https://murph.test/approve/${input.approvalSlug}`,
        expiresAt: '2026-06-24T12:15:00.000Z',
        status: 'pending' as const,
      })
      return await requestAssistantVaultFileSend({
        actionApprovalPort: { request: approvalRequest },
        bindingDelivery: {
          kind: 'thread',
          target: 'chat-staging-collision',
        },
        channel: 'linq',
        identityId: 'identity-staging-collision',
        ref,
        sessionId: 'session-staging-collision',
        threadId: 'thread-staging-collision',
        threadIsDirect: true,
        toolCallId: input.toolCallId,
        turnId: 'turn-staging-collision',
        vault: vaultRoot,
      })
    }

    await writeFile(stagingPath, contentsA)
    await sendWithPendingApproval({
      approvalSlug: 'a',
      toolCallId: 'call-staging-collision-a',
    })
    await writeFile(stagingPath, contentsB)
    await sendWithPendingApproval({
      approvalSlug: 'b',
      toolCallId: 'call-staging-collision-b',
    })

    const intents = await listAssistantOutboxIntents(vaultRoot)
    const media = intents
      .flatMap((intent) => intent.media)
      .filter((item) => item.kind === 'vault_file')
    expect(media).toHaveLength(2)
    const [first, second] = media
    if (!first || first.kind !== 'vault_file'
      || !second || second.kind !== 'vault_file') {
      throw new Error('Expected two persisted vault-file descriptors.')
    }
    expect(first.filename).toBe('report.pdf')
    expect(second.filename).toBe('report.pdf')
    expect(first.ref).not.toBe(second.ref)

    const byteLengths = new Set([first.sizeBytes, second.sizeBytes])
    expect(byteLengths).toEqual(
      new Set([contentsA.byteLength, contentsB.byteLength]),
    )
    for (const descriptor of [first, second]) {
      const expected = descriptor.sizeBytes === contentsA.byteLength
        ? contentsA
        : contentsB
      await expect(readVerifiedAssistantVaultFileBytes({
        file: descriptor,
        vaultRoot,
      })).resolves.toEqual(expected)
    }
  })

  it('reuses one owned file and approval identity after outbox persistence is interrupted', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-staging-retry-',
    )
    tempRoots.push(parentRoot)
    const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`
    const stagingPath = path.join(vaultRoot, ...ref.split('/'))
    const generatedDeliveryDirectory = path.dirname(stagingPath)
    const outboxPath = path.join(
      vaultRoot,
      '.runtime',
      'operations',
      'assistant',
      'outbox',
    )
    const contents = Buffer.from('generated report retry bytes')
    await mkdir(generatedDeliveryDirectory, { recursive: true })
    await writeFile(stagingPath, contents)
    await writeFile(outboxPath, 'block outbox directory creation')

    const pendingApproval = {
      approvalId: `haa_${'r'.repeat(32)}`,
      approvalUrl: 'https://murph.test/approve/retry',
      expiresAt: '2026-06-24T12:15:00.000Z',
      status: 'pending' as const,
    }
    const approvalRequest = vi.fn().mockResolvedValue(pendingApproval)
    const request = {
      actionApprovalPort: { request: approvalRequest },
      bindingDelivery: {
        kind: 'thread' as const,
        target: 'chat-staging-retry',
      },
      channel: 'linq',
      identityId: 'identity-staging-retry',
      ref,
      sessionId: 'session-staging-retry',
      threadId: 'thread-staging-retry',
      threadIsDirect: true,
      toolCallId: 'call-staging-retry',
      turnId: 'turn-staging-retry',
      vault: vaultRoot,
    }

    await expect(requestAssistantVaultFileSend(request)).rejects.toBeDefined()
    expect(approvalRequest).toHaveBeenCalledOnce()
    await expect(stat(stagingPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const entriesAfterInterruption = await readdir(generatedDeliveryDirectory)
    expect(entriesAfterInterruption).toHaveLength(1)
    expect(entriesAfterInterruption[0]).not.toBe('report.pdf')

    await rm(outboxPath)
    expect(await listAssistantOutboxIntents(vaultRoot)).toEqual([])

    const retried = await requestAssistantVaultFileSend(request)
    expect(retried).toMatchObject({
      approvalId: pendingApproval.approvalId,
      filename: 'report.pdf',
      status: 'pending',
    })
    expect(approvalRequest).toHaveBeenCalledTimes(2)
    expect(approvalRequest.mock.calls[1]?.[0]).toEqual(
      approvalRequest.mock.calls[0]?.[0],
    )

    const entriesAfterRetry = await readdir(generatedDeliveryDirectory)
    expect(entriesAfterRetry).toEqual(entriesAfterInterruption)
    const intents = await listAssistantOutboxIntents(vaultRoot)
    expect(intents).toHaveLength(1)
    const [persistedIntent] = intents
    const [persistedMedia] = persistedIntent?.media ?? []
    if (!persistedMedia || persistedMedia.kind !== 'vault_file') {
      throw new Error('Expected one persisted vault-file descriptor.')
    }
    expect(persistedMedia.ref).toBe(
      `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${entriesAfterRetry[0]}`,
    )
    await expect(readVerifiedAssistantVaultFileBytes({
      file: persistedMedia,
      vaultRoot,
    })).resolves.toEqual(contents)
  })

  it('does not auto-return from approvals for iMessage group threads', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-group-return-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'content')
    const file = await resolveAssistantVaultFileResponseMedia({
      ref: 'documents/report.pdf',
      vaultRoot,
    })

    const directRequest = buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: 'linq',
      file,
      targetFingerprint: 'target_123',
      threadIsDirect: true,
    })
    const groupRequest = buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: 'linq',
      file,
      targetFingerprint: 'target_123',
      threadIsDirect: false,
    })

    expect(directRequest.returnContactKind).toBe('text')
    expect(groupRequest.returnContactKind).toBeNull()
    expect(groupRequest.actionId).not.toBe(directRequest.actionId)
    expect(groupRequest.actionFingerprint).not.toBe(directRequest.actionFingerprint)
  })

  it('requires a new approval action when the delivery destination changes', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-destination-change-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'content')
    const file = await resolveAssistantVaultFileResponseMedia({
      ref: 'documents/report.pdf',
      vaultRoot,
    })

    const oldTarget = buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: 'linq',
      file,
      targetFingerprint: 'chat_old',
      threadIsDirect: true,
    })
    const newTarget = buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: 'linq',
      file,
      targetFingerprint: 'chat_new',
      threadIsDirect: true,
    })

    expect(newTarget.actionId).not.toBe(oldTarget.actionId)
    expect(newTarget.actionFingerprint).not.toBe(oldTarget.actionFingerprint)
  })

  it('refuses to create a vault-file approval without a concrete destination', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-targetless-',
    )
    tempRoots.push(parentRoot)

    const approvalPort = {
      request: vi.fn(),
    }

    await expect(requestAssistantVaultFileSend({
      actionApprovalPort: approvalPort,
      channel: 'linq',
      identityId: 'member_123',
      ref: 'documents/missing.pdf',
      sessionId: 'session_123',
      turnId: 'turn_123',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
    })
    expect(approvalPort.request).not.toHaveBeenCalled()
  })

  it('moves only an approved legacy awaiting intent into the normal pending outbox lifecycle', async () => {
    const now = new Date('2026-06-24T12:00:00.000Z')
    const intent = createVaultFileIntent()
    const request = buildAssistantVaultFileSendApprovalRequest(intent)
    const approved = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalGeneration: 'b'.repeat(64),
        approvalId: `haa_${'b'.repeat(32)}`,
        status: 'approved',
      },
      intent,
      now,
    })

    expect(request).toMatchObject({
      actionId: expect.stringMatching(/^vault-file-send:[0-9a-f]{64}$/u),
      actionKind: 'vault.file.send.v1',
    })
    expect(approved).toMatchObject({
      media: [
        expect.objectContaining({
          approvalGeneration: 'b'.repeat(64),
          approvalId: `haa_${'b'.repeat(32)}`,
        }),
      ],
      nextAttemptAt: now.toISOString(),
      status: 'pending',
    })
  })

  it('restores the approval-expiry wake when the pre-expiry fallback still observes pending', () => {
    const intent = {
      ...createVaultFileIntent(),
      nextAttemptAt: '2026-06-24T12:05:00.000Z',
    }
    const pending = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalId: `haa_${'b'.repeat(32)}`,
        approvalUrl: 'https://murph.test/approve/haa_test',
        expiresAt: '2026-06-24T12:15:00.000Z',
        status: 'pending',
      },
      intent,
      now: new Date('2026-06-24T12:05:00.000Z'),
    })

    expect(pending).toMatchObject({
      nextAttemptAt: '2026-06-24T12:15:00.000Z',
      status: 'awaiting_approval',
    })
  })

  it('keeps the approval request stable between pre-approval and the normal reply intent', async () => {
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
          approvalGeneration: 'd'.repeat(64),
          approvalId: `haa_${'d'.repeat(32)}`,
          status: 'approved' as const,
        }
      }),
    }
    const baseRequest = {
      actionApprovalPort: approvalPort,
      channel: 'linq',
      deliveryTransportIdempotent: true,
      identityId: 'member_123',
      ref: 'documents/report.pdf',
      replyToMessageId: 'original_message_target_stable',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    }

    const first = await requestAssistantVaultFileSend(baseRequest)
    const approved = await requestAssistantVaultFileSend(baseRequest)
    const replyIntent = await createAssistantOutboxIntent({
      bindingDelivery: { kind: 'thread', target: 'chat_123' },
      channel: 'linq',
      deliveryIdempotencyKey: 'hosted-turn-delivery-target-stable',
      deliveryTransportIdempotent: true,
      identityId: 'member_123',
      media: [approved.file],
      message: 'Here is the file.',
      replyToMessageId: 'approved_message_target_stable',
      sessionId: 'session_123',
      threadId: 'chat_123',
      threadIsDirect: true,
      turnId: 'turn_123',
      vault: vaultRoot,
    })

    expect(await listAssistantOutboxIntents(vaultRoot)).toHaveLength(2)
    expect(first.status).toBe('pending')
    expect(approved.status).toBe('approved')
    if (approved.status !== 'approved') {
      throw new Error('Expected approved vault-file send result.')
    }
    expect(approved.file).toMatchObject({
      approvalGeneration: 'd'.repeat(64),
      approvalId: `haa_${'d'.repeat(32)}`,
    })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(buildAssistantVaultFileSendApprovalRequest(replyIntent)).toEqual(
      requests[0],
    )
  })

  it('abandons approved targetless intents instead of reconstructing a destination', () => {
    const now = new Date('2026-06-24T12:00:00.000Z')
    const legacy = {
      ...createVaultFileIntent(),
      bindingDelivery: null,
      explicitTarget: null,
      targetFingerprint: 'legacy-targetless-fingerprint',
    }

    const approved = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalGeneration: 'e'.repeat(64),
        approvalId: `haa_${'e'.repeat(32)}`,
        status: 'approved',
      },
      intent: legacy,
      now,
    })

    expect(approved).toMatchObject({
      lastError: {
        code: 'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
      },
      nextAttemptAt: null,
      status: 'abandoned',
    })
  })

  it('never dispatches an awaiting-approval intent even when forced', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-blocked-',
    )
    tempRoots.push(parentRoot)
    await mkdir(path.join(vaultRoot, 'documents'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'documents', 'report.pdf'), 'content')

    const queued = await saveAssistantOutboxIntent(vaultRoot, createVaultFileIntent())
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
    expect(result.requiredVaultFileApprovalUrl).toBe(
      'https://murph.test/approve/haa_test',
    )
    expect(result.responseMediaPatch).toBeUndefined()
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify({
      filename: 'report.pdf',
      status: 'pending',
    }))
    expect(result.rpcResult.contentItems[0]?.text).not.toContain('haa_test')
  })

  it('attaches an approved vault file to the normal assistant reply path', async () => {
    const file = createApprovedVaultFileResponseMedia()
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      sendVaultFile: vi.fn(async () => ({
        file,
        filename: 'report.pdf',
        status: 'approved' as const,
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
    expect(result.responseMediaPatch).toEqual({
      media: [file],
      op: 'append',
    })
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(result.rpcResult.contentItems[0]?.text).toBe(JSON.stringify({
      deliveryStatus: 'queued_with_reply',
      filename: 'report.pdf',
      note:
        'Approval succeeded. Attach this file through your normal reply path. Do not quote this note or claim final iMessage delivery unless later delivery evidence confirms it.',
      status: 'approved',
    }))
  })

  it('does not allow later response media to replace an approved vault file', async () => {
    const result = await executeMurphDynamicToolRequest({
      currentResponseMedia: [createApprovedVaultFileResponseMedia()],
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: {
        kind: 'attach-response-media',
        media: [{
          alt: 'Generated bottle image',
          kind: 'image' as const,
          source: 'test',
          url: 'https://imagedelivery.net/account/image/public',
        }],
      },
    })

    expect(result.responseMediaPatch).toBeUndefined()
    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [{
        text: 'response media cannot be changed after an approved vault file is attached',
        type: 'inputText',
      }],
    })
  })

  it('does not allow generated images to append after an approved vault file', async () => {
    const nextUsageOrdinal = vi.fn(() => 1)

    const result = await executeMurphDynamicToolRequest({
      currentResponseMedia: [createApprovedVaultFileResponseMedia()],
      env: {
        OPENAI_API_KEY: 'openai-test-key',
      },
      fetchImpl: fetch,
      nextUsageOrdinal,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: {
        kind: 'generate-image',
        args: {
          alt: 'Generated bottle image',
          outputFormat: 'webp',
          prompt: 'Render a clean supplement bottle.',
          quality: 'medium',
          size: '1024x1024',
        },
      },
    })

    expect(nextUsageOrdinal).not.toHaveBeenCalled()
    expect(result.responseMediaPatch).toBeUndefined()
    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [{
        text: 'image generation cannot be combined with an approved vault file',
        type: 'inputText',
      }],
    })
  })
})

function createApprovedVaultFileResponseMedia() {
  return {
    approvalGeneration: 'f'.repeat(64),
    approvalId: `haa_${'f'.repeat(32)}`,
    contentType: 'application/pdf',
    filename: 'report.pdf',
    kind: 'vault_file' as const,
    ref: 'documents/report.pdf',
    sha256: 'a'.repeat(64),
    sizeBytes: 42,
  }
}

function createVaultFileIntent() {
  return {
    actorId: null,
    answeredMailboxItemIds: [],
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
      approvalGeneration: null,
      approvalId: null,
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
