import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_PENDING_VAULT_FILES_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  cancelPendingAssistantGeneratedVaultFileSends,
  listPendingAssistantGeneratedVaultFileSends,
} from '../src/assistant-codex/dynamic-tools/pending-vault-files.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import * as assistantOutbox from '../src/assistant/outbox.ts'
import {
  pruneAssistantGeneratedDeliveryResidue,
} from '../src/assistant/runtime-residue.ts'
import * as assistantTurns from '../src/assistant/turns.ts'
import {
  applyAssistantVaultFileSendApprovalResult,
  requestAssistantVaultFileSend,
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

describe('pending generated vault-file cancellation', () => {
  it('terminalizes a current-session delivery and leaves byte removal to runtime residue', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-cancel-current'
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'c'.repeat(32)}`,
      filename: 'workspace-export.zip',
      fileText: 'generated export bytes',
      sessionId,
      vaultRoot,
    })

    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'Always list first',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'does not delete bytes directly',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'oldest 20 entries plus totalCount',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'at most five batches',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'not_pending means only that the intent is no longer cancellable',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'old approval link cannot revive',
    )
    expect(resolveMurphDynamicTools({})).not.toContain(
      MURPH_PENDING_VAULT_FILES_TOOL,
    )
    expect(resolveMurphDynamicTools({ pendingVaultFilesAvailable: true }))
      .toContain(MURPH_PENDING_VAULT_FILES_TOOL)
    expect(resolveMurphDynamicTools({
      pendingVaultFilesAvailable: true,
      vaultFileSendAvailable: false,
    })).toContain(MURPH_PENDING_VAULT_FILES_TOOL)
    expect(resolveMurphDynamicTools({
      pendingVaultFilesAvailable: false,
      vaultFileSendAvailable: true,
    })).not.toContain(MURPH_PENDING_VAULT_FILES_TOOL)

    const listRequest = readPendingVaultFilesRequest({ action: 'list' })
    expect(listRequest).toEqual({ kind: 'pending-vault-files-list' })
    if (!listRequest) {
      throw new Error('Expected a pending vault-file list request.')
    }

    const listed = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(sessionId),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: listRequest,
      vaultRoot,
    })
    expect(listed.rpcResult.success).toBe(true)
    expect(readFirstToolJson(listed)).toMatchObject({
      pending: [{
        filename: pending.filename,
        intentId: pending.intentId,
        sizeBytes: 'generated export bytes'.length,
      }],
      totalCount: 1,
    })

    const cancelRequest = readPendingVaultFilesRequest({
      action: 'cancel',
      intentIds: [pending.intentId],
    })
    expect(cancelRequest).toEqual({
      intentIds: [pending.intentId],
      kind: 'pending-vault-files-cancel',
    })
    if (!cancelRequest) {
      throw new Error('Expected a pending vault-file cancel request.')
    }

    const cancelled = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(sessionId),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: cancelRequest,
      vaultRoot,
    })
    expect(cancelled.rpcResult.success).toBe(true)
    expect(readFirstToolJson(cancelled)).toMatchObject({
      results: [{
        filename: pending.filename,
        intentId: pending.intentId,
        status: 'cancelled',
      }],
    })
    expect(await readFile(pending.ownedPath, 'utf8'))
      .toBe('generated export bytes')

    const [abandoned] = await assistantOutbox.listAssistantOutboxIntents(vaultRoot)
    expect(abandoned).toMatchObject({
      lastError: {
        code: 'ASSISTANT_VAULT_FILE_SEND_CANCELLED',
      },
      nextAttemptAt: null,
      status: 'abandoned',
    })
    if (!abandoned) {
      throw new Error('Expected the generated delivery to remain terminal.')
    }
    expect(applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalGeneration: 'd'.repeat(64),
        approvalId: `haa_${'c'.repeat(32)}`,
        status: 'approved',
      },
      intent: abandoned,
      now: new Date('2026-08-06T18:05:00.000Z'),
    })).toBe(abandoned)

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        intentId: pending.intentId,
        status: 'already_cancelled',
      }],
    })

    const cleanup = await pruneAssistantGeneratedDeliveryResidue({
      vault: vaultRoot,
    })
    expect(cleanup.generatedDeliveryFilesPruned).toBe(1)
    await expect(stat(pending.ownedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('preserves the initiating turn receipt when cancellation commits', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-receipt-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-cancel-receipt'
    const approvalId = `haa_${'b'.repeat(32)}`
    const turnId = `turn_${approvalId.slice(4)}`
    await assistantTurns.createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'Prepare the generated report.',
      provider: 'codex-cli',
      providerModel: 'gpt-5.6-terra',
      sessionId,
      startedAt: '2026-08-06T18:00:00.000Z',
      turnId,
      vault: vaultRoot,
    })
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId,
      filename: 'receipt.zip',
      fileText: 'receipt bytes',
      sessionId,
      vaultRoot,
    })
    const originalReplyIntentId = `outbox_${'f'.repeat(32)}`
    await assistantTurns.updateAssistantTurnReceipt({
      mutate: (receipt) => ({
        ...receipt,
        completedAt: '2026-08-06T18:01:00.000Z',
        deliveryDisposition: 'sent',
        deliveryIntentId: originalReplyIntentId,
        status: 'completed',
        updatedAt: '2026-08-06T18:01:00.000Z',
      }),
      turnId,
      vault: vaultRoot,
    })
    const receiptWrite = vi.spyOn(assistantTurns, 'updateAssistantTurnReceipt')
      .mockRejectedValueOnce(new Error('injected receipt write failure'))

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      now: new Date('2026-08-06T18:05:00.000Z'),
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        intentId: pending.intentId,
        status: 'cancelled',
      }],
    })
    expect(receiptWrite).not.toHaveBeenCalled()
    await expect(assistantTurns.readAssistantTurnReceipt(vaultRoot, turnId))
      .resolves.toMatchObject({
        completedAt: '2026-08-06T18:01:00.000Z',
        deliveryDisposition: 'sent',
        deliveryIntentId: originalReplyIntentId,
        status: 'completed',
      })
    await expect(assistantOutbox.readAssistantOutboxIntent(
      vaultRoot,
      pending.intentId,
    )).resolves.toMatchObject({
      lastError: {
        code: 'ASSISTANT_VAULT_FILE_SEND_CANCELLED',
      },
      status: 'abandoned',
    })

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        intentId: pending.intentId,
        status: 'already_cancelled',
      }],
    })
  })

  it('filters listing and cancellation to the trusted origin session', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-session-',
    )
    tempRoots.push(parentRoot)
    const current = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'1'.repeat(32)}`,
      filename: 'current.zip',
      fileText: 'current bytes',
      sessionId: 'session-current',
      vaultRoot,
    })
    const foreign = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'2'.repeat(32)}`,
      filename: 'foreign.zip',
      fileText: 'foreign bytes',
      sessionId: 'session-foreign',
      vaultRoot,
    })

    await expect(listPendingAssistantGeneratedVaultFileSends({
      originSessionId: 'session-current',
      vault: vaultRoot,
    })).resolves.toMatchObject({
      pending: [{ intentId: current.intentId }],
      totalCount: 1,
    })
    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [foreign.intentId],
      originSessionId: 'session-current',
      vault: vaultRoot,
    })).resolves.toEqual({
      results: [{ intentId: foreign.intentId, status: 'not_found' }],
    })

    const intents = await assistantOutbox.listAssistantOutboxIntents(vaultRoot)
    expect(intents.find((intent) => intent.intentId === foreign.intentId)?.status)
      .toBe('awaiting_approval')
    expect(await readFile(foreign.ownedPath, 'utf8')).toBe('foreign bytes')
  })

  it('requires the current direct user-action scope', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-scope-',
    )
    tempRoots.push(parentRoot)
    const request = readPendingVaultFilesRequest({ action: 'list' })
    if (!request) {
      throw new Error('Expected a pending vault-file list request.')
    }

    for (const hostedToolContext of [
      createHostedToolContext(null),
      createHostedToolContext('session-group', 'group'),
    ]) {
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        publicFetchImpl: fetch,
        request,
        vaultRoot,
      })
      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'requires current user input in a direct conversation',
      )
    }
  })

  it('reports each cancellation independently after a later persistence failure', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-partial-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-partial'
    const first = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'3'.repeat(32)}`,
      filename: 'first.zip',
      fileText: 'first bytes',
      sessionId,
      vaultRoot,
    })
    const second = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'4'.repeat(32)}`,
      filename: 'second.zip',
      fileText: 'second bytes',
      sessionId,
      vaultRoot,
    })
    const saveIfUnchanged = assistantOutbox.saveAssistantOutboxIntentIfUnchanged
    let saveCount = 0
    vi.spyOn(assistantOutbox, 'saveAssistantOutboxIntentIfUnchanged')
      .mockImplementation(async (input) => {
        saveCount += 1
        if (saveCount === 2) {
          throw new Error('injected persistence failure')
        }
        return await saveIfUnchanged(input)
      })

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [first.intentId, second.intentId],
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toEqual({
      results: [
        expect.objectContaining({
          intentId: first.intentId,
          status: 'cancelled',
        }),
        { intentId: second.intentId, status: 'failed' },
      ],
    })

    const intents = await assistantOutbox.listAssistantOutboxIntents(vaultRoot)
    expect(intents.find((intent) => intent.intentId === first.intentId)?.status)
      .toBe('abandoned')
    expect(intents.find((intent) => intent.intentId === second.intentId)?.status)
      .toBe('awaiting_approval')
  })

  it('reports exactly one winner when two cancellations race at the same time', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-concurrent-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-concurrent'
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'5'.repeat(32)}`,
      filename: 'concurrent.zip',
      fileText: 'concurrent bytes',
      sessionId,
      vaultRoot,
    })
    const now = new Date('2026-08-06T18:10:00.000Z')

    const outcomes = await Promise.all([
      cancelPendingAssistantGeneratedVaultFileSends({
        intentIds: [pending.intentId],
        now,
        originSessionId: sessionId,
        vault: vaultRoot,
      }),
      cancelPendingAssistantGeneratedVaultFileSends({
        intentIds: [pending.intentId],
        now,
        originSessionId: sessionId,
        vault: vaultRoot,
      }),
    ])

    expect(outcomes.map((outcome) => outcome.results[0]?.status).sort())
      .toEqual(['already_cancelled', 'cancelled'])
  })

  it('retries once when an approval refresh wins the first compare-and-set', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-refresh-race-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-refresh-race'
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'6'.repeat(32)}`,
      filename: 'refresh-race.zip',
      fileText: 'refresh race bytes',
      sessionId,
      vaultRoot,
    })
    const saveIfUnchanged = assistantOutbox.saveAssistantOutboxIntentIfUnchanged
    vi.spyOn(assistantOutbox, 'saveAssistantOutboxIntentIfUnchanged')
      .mockImplementationOnce(async (input) => {
        const current = (await assistantOutbox.listAssistantOutboxIntents(
          input.vault,
        )).find((intent) => intent.intentId === input.intent.intentId)
        if (!current) {
          throw new Error('Expected the pending intent before refresh.')
        }
        const refreshed = {
          ...current,
          updatedAt: '2026-08-06T18:06:00.000Z',
        }
        const refreshResult = await saveIfUnchanged({
          expectedDedupeKey: current.dedupeKey,
          expectedStatus: current.status,
          expectedUpdatedAt: current.updatedAt,
          intent: refreshed,
          vault: input.vault,
        })
        expect(refreshResult.applied).toBe(true)
        return {
          applied: false,
          intent: refreshed,
        }
      })
      .mockImplementation(saveIfUnchanged)

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      now: new Date('2026-08-06T18:10:00.000Z'),
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        intentId: pending.intentId,
        status: 'cancelled',
      }],
    })
    expect(assistantOutbox.saveAssistantOutboxIntentIfUnchanged)
      .toHaveBeenCalledTimes(2)
  })

  it('reports not_pending only after another owner advances the intent', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-advanced-race-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-advanced-race'
    const approvalId = `haa_${'8'.repeat(32)}`
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId,
      filename: 'advanced-race.zip',
      fileText: 'advanced race bytes',
      sessionId,
      vaultRoot,
    })
    const intent = (await assistantOutbox.listAssistantOutboxIntents(vaultRoot))
      .find((candidate) => candidate.intentId === pending.intentId)
    if (!intent) {
      throw new Error('Expected the pending intent before approval.')
    }
    const advanced = applyAssistantVaultFileSendApprovalResult({
      approval: {
        approvalGeneration: '9'.repeat(64),
        approvalId,
        status: 'approved',
      },
      intent,
      now: new Date('2026-08-06T18:07:00.000Z'),
    })
    await assistantOutbox.saveAssistantOutboxIntent(vaultRoot, advanced)

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      now: new Date('2026-08-06T18:10:00.000Z'),
      originSessionId: sessionId,
      vault: vaultRoot,
    })).resolves.toEqual({
      results: [{ intentId: pending.intentId, status: 'not_pending' }],
    })
    expect((await assistantOutbox.listAssistantOutboxIntents(vaultRoot))
      .find((candidate) => candidate.intentId === pending.intentId)?.status)
      .toBe('pending')
  })

  it('returns the oldest page and a total count when more than 20 remain', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-paging-',
    )
    tempRoots.push(parentRoot)
    const sessionId = 'session-paging'
    vi.useFakeTimers()
    for (let index = 0; index < 21; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 6, 18, 0, index)))
      await createPendingGeneratedVaultFileSend({
        approvalId: `haa_${index.toString(16).padStart(32, '0')}`,
        filename: `page-${index.toString().padStart(2, '0')}.zip`,
        fileText: `page bytes ${index}`,
        sessionId,
        vaultRoot,
      })
    }

    const listed = await listPendingAssistantGeneratedVaultFileSends({
      originSessionId: sessionId,
      vault: vaultRoot,
    })
    expect(listed).toMatchObject({
      totalCount: 21,
    })
    expect(listed.pending).toHaveLength(20)
    expect(listed.pending[0]?.filename).toBe('page-00.zip')
    expect(listed.pending.some((file) => file.filename === 'page-20.zip'))
      .toBe(false)
  })

  it('rejects ambiguous inputs with the standard safe validation digest', () => {
    const intentId = `outbox_${'a'.repeat(32)}`
    const request = readPendingVaultFilesRequest({
      action: 'cancel',
      intentIds: [intentId, intentId],
      privateNote: 'do not retain this value',
    })
    expect(request).toMatchObject({
      kind: 'invalid-pending-vault-files-arguments',
      validationDigest: {
        detailsSchema: 'murph.tool-call-validation-digest.v1',
        toolName: 'murph.pending_vault_files',
      },
    })
    expect(JSON.stringify(request)).not.toContain('do not retain this value')
  })
})

function readPendingVaultFilesRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'pending_vault_files',
    },
  })
}

function createHostedToolContext(
  originSessionId: string | null,
  conversationScope: 'direct' | 'group' = 'direct',
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => originSessionId
      ? {
          acceptedInputIds: [`ain_${'a'.repeat(32)}`],
          conversationId: 'conversation-current',
          conversationScope,
          inboundMailboxItemIds: [],
          originSessionId,
          recipientKey: 'recipient-current',
        }
      : null,
    sendVaultFile: vi.fn(async () => ({
      filename: 'unused.zip',
      status: 'denied' as const,
    })),
    pendingVaultFilesAvailable: true,
    vaultFileSendAvailable: false,
  }
}

function createPendingApprovalPort(approvalId: string) {
  return {
    read: vi.fn(),
    request: vi.fn(async () => ({
      approvalId,
      approvalUrl: `https://murph.test/approve/${approvalId}`,
      expiresAt: '2026-08-06T18:15:00.000Z',
      status: 'pending' as const,
    })),
  }
}

async function createPendingGeneratedVaultFileSend(input: {
  approvalId: string
  filename: string
  fileText: string
  sessionId: string
  vaultRoot: string
}): Promise<{
  filename: string
  intentId: string
  ownedPath: string
}> {
  const stagingRef =
    `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${input.filename}`
  const stagingPath = path.join(input.vaultRoot, ...stagingRef.split('/'))
  await mkdir(path.dirname(stagingPath), { recursive: true })
  await writeFile(stagingPath, input.fileText)

  await requestAssistantVaultFileSend({
    actionApprovalPort: createPendingApprovalPort(input.approvalId),
    bindingDelivery: {
      kind: 'thread',
      target: `chat-${input.filename}`,
    },
    channel: 'linq',
    identityId: `identity-${input.filename}`,
    ref: stagingRef,
    sessionId: input.sessionId,
    threadId: `thread-${input.filename}`,
    threadIsDirect: true,
    toolCallId: `call-${input.filename}`,
    turnId: `turn_${input.approvalId.slice(4)}`,
    vault: input.vaultRoot,
  })

  const intent = (await assistantOutbox.listAssistantOutboxIntents(input.vaultRoot))
    .find((candidate) =>
      candidate.sessionId === input.sessionId
      && candidate.media.some(
        (media) =>
          media.kind === 'vault_file'
          && media.filename === input.filename,
      )
    )
  const media = intent?.media.find(
    (candidate) => candidate.kind === 'vault_file',
  )
  if (!intent || !media || media.kind !== 'vault_file') {
    throw new Error('Expected one parked generated vault-file delivery.')
  }

  return {
    filename: media.filename,
    intentId: intent.intentId,
    ownedPath: path.join(input.vaultRoot, ...media.ref.split('/')),
  }
}

function readFirstToolJson(result: Awaited<
  ReturnType<typeof executeMurphDynamicToolRequest>
>): unknown {
  return JSON.parse(result.rpcResult.contentItems[0]?.text ?? '{}')
}
