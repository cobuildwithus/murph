import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_PENDING_VAULT_FILES_TOOL,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import {
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store.ts'
import {
  cancelPendingAssistantGeneratedVaultFileSends,
  listPendingAssistantGeneratedVaultFileSends,
} from '../src/assistant/pending-vault-file-cancellation.ts'
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
  it('abandons the delivery before deleting bytes and ignores delayed approval', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-',
    )
    tempRoots.push(parentRoot)
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'c'.repeat(32)}`,
      filename: 'workspace-export.zip',
      fileText: 'generated export bytes',
      vaultRoot,
    })

    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'Always list first',
    )
    expect(MURPH_PENDING_VAULT_FILES_TOOL.description).toContain(
      'Canonical or user-owned vault files',
    )

    const listRequest = readPendingVaultFilesRequest({ action: 'list' })
    expect(listRequest).toEqual({ kind: 'pending-vault-files-list' })
    if (!listRequest) {
      throw new Error('Expected a pending vault-file list request.')
    }

    const hostedToolContext = createHostedToolContext(
      `ain_${'a'.repeat(32)}`,
    )
    const listed = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
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

    const withoutUserInput = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext(null),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: cancelRequest,
      vaultRoot,
    })
    expect(withoutUserInput.rpcResult.success).toBe(false)
    expect((await listAssistantOutboxIntents(vaultRoot))[0]?.status)
      .toBe('awaiting_approval')

    const cancelled = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      publicFetchImpl: fetch,
      request: cancelRequest,
      vaultRoot,
    })
    expect(cancelled.rpcResult.success).toBe(true)
    expect(readFirstToolJson(cancelled)).toMatchObject({
      results: [{
        fileStatus: 'deleted',
        filename: pending.filename,
        intentId: pending.intentId,
        status: 'cancelled',
      }],
      skippedIntentIds: [],
    })
    await expect(stat(pending.ownedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const [abandoned] = await listAssistantOutboxIntents(vaultRoot)
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
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        fileStatus: 'missing',
        intentId: pending.intentId,
        status: 'already_cancelled',
      }],
      skippedIntentIds: [],
    })
    await expect(listPendingAssistantGeneratedVaultFileSends({
      vault: vaultRoot,
    })).resolves.toEqual({
      pending: [],
      totalCount: 0,
    })
  })

  it('never deletes canonical files or bytes still claimed by another active intent', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-ownership-',
    )
    tempRoots.push(parentRoot)
    const canonicalPath = path.join(vaultRoot, 'documents', 'record.zip')
    await mkdir(path.dirname(canonicalPath), { recursive: true })
    await writeFile(canonicalPath, 'canonical bytes')

    await requestAssistantVaultFileSend({
      actionApprovalPort: createPendingApprovalPort(
        `haa_${'e'.repeat(32)}`,
      ),
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-cancel-ownership',
      },
      channel: 'linq',
      identityId: 'identity-cancel-ownership',
      ref: 'documents/record.zip',
      sessionId: 'session-cancel-ownership',
      threadId: 'thread-cancel-ownership',
      threadIsDirect: true,
      turnId: 'turn-canonical',
      vault: vaultRoot,
    })
    const generated = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'f'.repeat(32)}`,
      filename: 'generated.zip',
      fileText: 'generated bytes',
      vaultRoot,
    })

    const intents = await listAssistantOutboxIntents(vaultRoot)
    const canonicalIntent = intents.find((intent) =>
      intent.media.some(
        (item) =>
          item.kind === 'vault_file'
          && item.ref === 'documents/record.zip',
      )
    )
    const generatedIntent = intents.find(
      (intent) => intent.intentId === generated.intentId,
    )
    if (!canonicalIntent || !generatedIntent) {
      throw new Error('Expected canonical and generated parked deliveries.')
    }

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [canonicalIntent.intentId],
      vault: vaultRoot,
    })).resolves.toEqual({
      results: [],
      skippedIntentIds: [canonicalIntent.intentId],
    })
    expect(await readFile(canonicalPath, 'utf8')).toBe('canonical bytes')
    expect((await listAssistantOutboxIntents(vaultRoot)).find(
      (intent) => intent.intentId === canonicalIntent.intentId,
    )?.status).toBe('awaiting_approval')

    const sharedIntent = {
      ...generatedIntent,
      dedupeKey: 'shared-generated-dedupe',
      deliveryIdempotencyKey: 'shared-generated-delivery',
      intentId: `outbox_${'b'.repeat(32)}`,
      turnId: 'turn-generated-shared',
      updatedAt: '2026-08-06T18:01:00.000Z',
    }
    await saveAssistantOutboxIntent(vaultRoot, sharedIntent)

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [generatedIntent.intentId],
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        fileStatus: 'retained',
        intentId: generatedIntent.intentId,
        status: 'cancelled',
      }],
      skippedIntentIds: [],
    })
    expect(await readFile(generated.ownedPath, 'utf8'))
      .toBe('generated bytes')

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [sharedIntent.intentId],
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        fileStatus: 'deleted',
        intentId: sharedIntent.intentId,
        status: 'cancelled',
      }],
      skippedIntentIds: [],
    })
    await expect(stat(generated.ownedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readFile(canonicalPath, 'utf8')).toBe('canonical bytes')
  })

  it('retains bytes when the outbox inventory is not fully trusted', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-vault-file-cancel-untrusted-',
    )
    tempRoots.push(parentRoot)
    const pending = await createPendingGeneratedVaultFileSend({
      approvalId: `haa_${'9'.repeat(32)}`,
      filename: 'untrusted.zip',
      fileText: 'untrusted inventory bytes',
      vaultRoot,
    })
    const unexpectedPath = path.join(
      resolveAssistantStatePaths(vaultRoot).outboxDirectory,
      'unexpected-entry',
    )
    await writeFile(unexpectedPath, 'not an outbox intent')

    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        fileStatus: 'retained',
        intentId: pending.intentId,
        status: 'cancelled',
      }],
    })
    expect(await readFile(pending.ownedPath, 'utf8'))
      .toBe('untrusted inventory bytes')

    await rm(unexpectedPath)
    await expect(cancelPendingAssistantGeneratedVaultFileSends({
      intentIds: [pending.intentId],
      vault: vaultRoot,
    })).resolves.toMatchObject({
      results: [{
        fileStatus: 'deleted',
        intentId: pending.intentId,
        status: 'already_cancelled',
      }],
    })
    await expect(stat(pending.ownedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects ambiguous cancellation inputs before touching the outbox', () => {
    const intentId = `outbox_${'a'.repeat(32)}`
    expect(readPendingVaultFilesRequest({
      action: 'cancel',
      intentIds: [intentId, intentId],
    })).toMatchObject({
      kind: 'invalid-pending-vault-files-arguments',
    })
    expect(readPendingVaultFilesRequest({
      action: 'cancel',
      intentIds: ['workspace-export.zip'],
    })).toMatchObject({
      kind: 'invalid-pending-vault-files-arguments',
    })
  })
})

function readPendingVaultFilesRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
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
  assistantInputId: string | null,
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentAssistantInputId: () => assistantInputId,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => ({
      filename: 'unused.zip',
      status: 'denied' as const,
    })),
    vaultFileSendAvailable: true,
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
    sessionId: `session-${input.filename}`,
    threadId: `thread-${input.filename}`,
    threadIsDirect: true,
    toolCallId: `call-${input.filename}`,
    turnId: `turn-${input.filename}`,
    vault: input.vaultRoot,
  })

  const [intent] = (await listAssistantOutboxIntents(input.vaultRoot))
    .filter((candidate) =>
      candidate.media.some(
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
