import { access, mkdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAssistantAcceptedTurnInputItems,
} from '../src/assistant/active-turn-input-journal.ts'
import {
  writeAssistantAutoReplyIntentProvenance,
} from '../src/assistant/automation/intent-provenance.ts'
import {
  AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY,
  AUTO_REPLY_RECEIPT_INPUT_ID_KEY,
  AUTO_REPLY_RECEIPT_INPUT_IDS_KEY,
} from '../src/assistant/automation/auto-reply-retry.ts'
import {
  writeAssistantAutoReplySuppressionEvidence,
} from '../src/assistant/automation/evidence.ts'
import {
  createAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { pruneAssistantRuntimeResidue } from '../src/assistant/runtime-residue.ts'
import {
  resolveAssistantInputEventPath,
  upsertAssistantInputEvent,
  type AssistantInputEventRecord,
} from '../src/assistant/input-store.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
  resolveAssistantTurnReceiptPath,
} from '../src/assistant/turns.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant runtime residue pruning', () => {
  it('retains pending input events and their terminal evidence', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-pending-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 1,
      vaultRoot,
    })
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [event.inputId],
      inputIds: [event.inputId],
      reason: 'already-handled',
      recordedAt: OLD_RECORD_AT,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [event.inputId],
      vault: vaultRoot,
    })

    expect(result.inputEventsPruned).toBe(0)
    expect(result.autoReplyEvidenceFilesPruned).toBe(0)
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathExists(resolveEvidencePath(paths, event.inputId))
  })

  it('deletes old settled input events before deleting complete evidence groups', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-settled-evidence-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 2,
      vaultRoot,
    })
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [event.inputId],
      inputIds: [event.inputId],
      reason: 'already-handled',
      recordedAt: OLD_RECORD_AT,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.inputEventsPruned).toBe(1)
    expect(result.autoReplyEvidenceGroupsPruned).toBe(1)
    expect(result.autoReplyEvidenceFilesPruned).toBe(1)
    await expectPathMissing(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathMissing(resolveEvidencePath(paths, event.inputId))
  })

  it('retains partial evidence groups and their associated input events', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-partial-evidence-',
    )
    const first = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 3,
      vaultRoot,
    })
    const second = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 4,
      vaultRoot,
    })
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [first.inputId, second.inputId],
      inputIds: [first.inputId, second.inputId],
      reason: 'already-handled',
      recordedAt: OLD_RECORD_AT,
      vault: vaultRoot,
    })
    await rm(resolveEvidencePath(paths, second.inputId), {
      force: true,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.inputEventsPruned).toBe(0)
    expect(result.autoReplyEvidenceFilesPruned).toBe(0)
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: first.inputId,
      paths,
    }))
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: second.inputId,
      paths,
    }))
    await expectPathExists(resolveEvidencePath(paths, first.inputId))
  })

  it('retains evidence with unqueued provider cleanup obligations', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-provider-cleanup-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 5,
      vaultRoot,
    })
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: [event.inputId],
      inputIds: [event.inputId],
      linqMessageIds: ['linq-cleanup-message'],
      reason: 'already-handled',
      recordedAt: OLD_RECORD_AT,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.inputEventsPruned).toBe(0)
    expect(result.autoReplyEvidenceFilesPruned).toBe(0)
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathExists(resolveEvidencePath(paths, event.inputId))
  })

  it('retains orphan input events referenced by active auto-reply receipt metadata', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-active-auto-reply-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 6,
      vaultRoot,
    })
    const sessionId = createSessionId('3')
    const turnId = createTurnId('6')
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      metadata: {
        [AUTO_REPLY_RECEIPT_INPUT_ID_KEY]: event.inputId,
        [AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]: event.inputId,
      },
      prompt: 'active auto-reply',
      provider: 'codex-cli',
      providerModel: null,
      sessionId,
      startedAt: OLD_RECORD_AT,
      turnId,
      vault: vaultRoot,
    })
    await createAssistantOutboxIntent({
      channel: 'telegram',
      createdAt: OLD_RECORD_AT,
      identityId: 'participant-active-auto-reply',
      message: 'active reply',
      replyToMessageId: 'message-active-auto-reply',
      sessionId,
      threadId: 'thread-active-auto-reply',
      threadIsDirect: true,
      turnId,
      turnTrigger: 'automation-auto-reply',
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.inputEventsPruned).toBe(0)
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
  })

  it('deletes settled journals and old terminal receipts but keeps journals without receipts', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-journals-',
    )
    const settledTurnId = createTurnId('1')
    const missingReceiptTurnId = createTurnId('2')
    const sessionId = createSessionId('1')

    await appendAssistantAcceptedTurnInputItems({
      inputs: [{
        id: 'manual-input',
        promptFallbackText: 'manual input',
        source: 'manual',
      }],
      now: new Date(OLD_RECORD_AT),
      sessionId,
      turnId: settledTurnId,
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: false,
      prompt: 'prompt',
      provider: 'codex-cli',
      providerModel: null,
      sessionId,
      startedAt: OLD_RECORD_AT,
      turnId: settledTurnId,
      vault: vaultRoot,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: OLD_RECORD_AT,
      response: 'done',
      status: 'completed',
      turnId: settledTurnId,
      vault: vaultRoot,
    })
    await appendAssistantAcceptedTurnInputItems({
      inputs: [{
        id: 'manual-input-without-receipt',
        promptFallbackText: 'manual input',
        source: 'manual',
      }],
      now: new Date(OLD_RECORD_AT),
      sessionId,
      turnId: missingReceiptTurnId,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.acceptedTurnInputJournalsPruned).toBe(1)
    expect(result.receiptsPruned).toBe(1)
    await expectPathMissing(resolveJournalPath(paths, settledTurnId))
    await expectPathMissing(resolveAssistantTurnReceiptPath(paths, settledTurnId))
    await expectPathExists(resolveJournalPath(paths, missingReceiptTurnId))
  })

  it('prunes old abandoned running receipts only when pending authority is available', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-running-receipts-',
    )
    const sessionId = createSessionId('2')
    const oldTurnId = createTurnId('3')
    const recentTurnId = createTurnId('4')

    await createAssistantTurnReceipt({
      deliveryRequested: false,
      prompt: 'old running',
      provider: 'codex-cli',
      providerModel: null,
      sessionId,
      startedAt: OLD_RECORD_AT,
      turnId: oldTurnId,
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: false,
      prompt: 'recent running',
      provider: 'codex-cli',
      providerModel: null,
      sessionId,
      startedAt: RECENT_RECORD_AT,
      turnId: recentTurnId,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.receiptsPruned).toBe(1)
    await expectPathMissing(resolveAssistantTurnReceiptPath(paths, oldTurnId))
    await expectPathExists(resolveAssistantTurnReceiptPath(paths, recentTurnId))
  })

  it('retains terminal receipts whose cross-session context intent is still in the outbox', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-cross-session-context-',
    )
    const sessionId = createSessionId('8')
    const consumingTurnId = createTurnId('8')

    const sourceIntent = await createAssistantOutboxIntent({
      channel: 'email',
      createdAt: OLD_RECORD_AT,
      identityId: 'identity-cross-session',
      message: 'cross-session reminder',
      replyToMessageId: 'message-cross-session',
      sessionId: createSessionId('9'),
      threadId: 'thread-cross-session',
      threadIsDirect: true,
      turnId: createTurnId('9'),
      turnTrigger: 'automation-auto-reply',
      vault: vaultRoot,
    })
    await createAssistantTurnReceipt({
      deliveryRequested: false,
      metadata: {
        [AUTO_REPLY_RECEIPT_CROSS_SESSION_CONTEXT_INTENT_ID_KEY]:
          sourceIntent.intentId,
      },
      prompt: 'consumes cross-session context',
      provider: 'codex-cli',
      providerModel: null,
      sessionId,
      startedAt: OLD_RECORD_AT,
      turnId: consumingTurnId,
      vault: vaultRoot,
    })
    await finalizeAssistantTurnReceipt({
      completedAt: OLD_RECORD_AT,
      response: 'done',
      status: 'completed',
      turnId: consumingTurnId,
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.receiptsPruned).toBe(0)
    await expectPathExists(resolveAssistantTurnReceiptPath(paths, consumingTurnId))
  })

  it('prunes intent provenance only after the outbox intent is gone', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-provenance-',
    )
    const intentId = 'intent_orphaned_auto_reply'
    await writeAssistantAutoReplyIntentProvenance({
      intentId,
      recordedAt: OLD_RECORD_AT,
      turnId: createTurnId('5'),
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.autoReplyIntentProvenancePruned).toBe(1)
    await expectPathMissing(resolveIntentProvenancePath(paths, intentId))
  })

  it('rejects nested symlink residue directories without deleting target vault files', async () => {
    const source = await createAssistantVault(
      'assistant-runtime-residue-symlink-source-',
    )
    const target = await createAssistantVault(
      'assistant-runtime-residue-symlink-target-',
    )
    const intentId = 'intent_symlink_target'
    await writeAssistantAutoReplyIntentProvenance({
      intentId,
      recordedAt: OLD_RECORD_AT,
      turnId: createTurnId('7'),
      vault: target.vaultRoot,
    })
    const sourceProvenanceDirectory = path.join(
      source.paths.assistantStateRoot,
      'auto-reply',
      'intent-provenance',
    )
    const targetProvenanceDirectory = path.join(
      target.paths.assistantStateRoot,
      'auto-reply',
      'intent-provenance',
    )
    await rm(sourceProvenanceDirectory, {
      force: true,
      recursive: true,
    })
    await mkdir(path.dirname(sourceProvenanceDirectory), {
      recursive: true,
    })
    await symlink(targetProvenanceDirectory, sourceProvenanceDirectory, 'dir')

    await expect(pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: source.vaultRoot,
    })).rejects.toThrow('Assistant state path must not contain symlinks')
    await expectPathExists(resolveIntentProvenancePath(target.paths, intentId))
  })
})

const OLD_RECORD_AT = '2026-01-01T00:00:00.000Z'
const RECENT_RECORD_AT = '2026-01-20T00:00:00.000Z'
const PRUNE_NOW = new Date('2026-02-01T00:00:00.000Z')

async function createAssistantVault(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  const paths = resolveAssistantStatePaths(context.vaultRoot)
  await ensureAssistantState(paths)
  return {
    paths,
    vaultRoot: context.vaultRoot,
  }
}

async function createHostedInputEvent(input: {
  now: string
  seq: number
  vaultRoot: string
}): Promise<AssistantInputEventRecord> {
  return await upsertAssistantInputEvent({
    now: new Date(input.now),
    vault: input.vaultRoot,
    event: {
      content: {
        text: `hosted input ${input.seq}`,
      },
      conversation: {
        accountId: null,
        actorId: `actor-${input.seq}`,
        actorIsSelf: false,
        source: 'email',
        threadId: `thread-${input.seq}`,
        threadIsDirect: true,
      },
      occurredAt: input.now,
      receivedAt: input.now,
      replyTarget: {
        channel: 'email',
        messageId: `message-${input.seq}`,
        threadId: `thread-${input.seq}`,
      },
      sourceRef: {
        dedupeKey: `dedupe-${input.seq}`,
        eventId: `event-${input.seq}`,
        itemId: `item-${input.seq}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: String(input.seq),
        payloadSchema: 'test-payload',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'test-wake',
      },
    },
  })
}

function resolveEvidencePath(
  paths: ReturnType<typeof resolveAssistantStatePaths>,
  inputId: string,
): string {
  return path.join(
    paths.assistantStateRoot,
    'auto-reply',
    'evidence',
    `${encodeURIComponent(inputId)}.json`,
  )
}

function resolveIntentProvenancePath(
  paths: ReturnType<typeof resolveAssistantStatePaths>,
  intentId: string,
): string {
  return path.join(
    paths.assistantStateRoot,
    'auto-reply',
    'intent-provenance',
    `${encodeURIComponent(intentId)}.json`,
  )
}

function resolveJournalPath(
  paths: ReturnType<typeof resolveAssistantStatePaths>,
  turnId: string,
): string {
  return path.join(paths.stateDirectory, 'accepted-turn-inputs', `${turnId}.json`)
}

function createSessionId(seed: string): string {
  return `asst_${seed.repeat(32).slice(0, 32)}`
}

function createTurnId(seed: string): string {
  return `turn_${seed.repeat(32).slice(0, 32)}`
}

async function expectPathExists(filePath: string): Promise<void> {
  expect(await pathExists(filePath)).toBe(true)
}

async function expectPathMissing(filePath: string): Promise<void> {
  expect(await pathExists(filePath)).toBe(false)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
