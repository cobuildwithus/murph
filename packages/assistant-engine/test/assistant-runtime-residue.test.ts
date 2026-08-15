import { existsSync } from 'node:fs'
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  AssistantOutboxIntent,
  AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

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
  recordHostedMailboxAssistantInputItem,
} from '../src/assistant/hosted-mailbox-input-items.ts'
import {
  createAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import { pruneAssistantRuntimeResidue } from '../src/assistant/runtime-residue.ts'
import {
  resolveAssistantVaultFileResponseMedia,
} from '../src/assistant/vault-file-send.ts'
import {
  resolveAssistantInputEventPath,
  resolveAssistantInputEventsDirectory,
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
  it('prunes terminal and orphan flat runtime deliveries while retaining active media and ordinary exports', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-deliveries-',
    )
    const active = await writeGeneratedDeliveryFile({
      contents: 'active delivery',
      refSuffix: 'active.zip',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: active.media,
      seed: 'a',
      status: 'pending',
      vaultRoot,
    })
    const terminal = await writeGeneratedDeliveryFile({
      contents: 'terminal delivery',
      refSuffix: 'terminal.zip',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: terminal.media,
      seed: 'b',
      status: 'sent',
      vaultRoot,
    })
    const orphan = await writeGeneratedDeliveryFile({
      contents: 'orphan delivery',
      refSuffix: 'orphan.pdf',
      vaultRoot,
    })
    const genericFilePath = path.join(
      vaultRoot,
      'exports',
      'user-files',
      'keep.pdf',
    )
    const legacyPrefixPath = path.join(
      vaultRoot,
      'exports',
      'assistant-deliveries',
      'keep.zip',
    )
    const prefixSiblingPath = path.join(
      vaultRoot,
      'exports',
      'assistant-deliveries-backup',
      'keep.zip',
    )
    await mkdir(path.dirname(genericFilePath), { recursive: true })
    await mkdir(path.dirname(legacyPrefixPath), { recursive: true })
    await mkdir(path.dirname(prefixSiblingPath), { recursive: true })
    await writeFile(genericFilePath, 'generic user file', 'utf8')
    await writeFile(legacyPrefixPath, 'ordinary legacy-path file', 'utf8')
    await writeFile(prefixSiblingPath, 'prefix sibling', 'utf8')

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(2)
    expect(result.generatedDeliveryBytesPruned).toBe(
      Buffer.byteLength('terminal delivery') +
      Buffer.byteLength('orphan delivery'),
    )
    await expectPathExists(active.filePath)
    await expectPathMissing(terminal.filePath)
    await expectPathMissing(orphan.filePath)
    await expectPathExists(genericFilePath)
    await expectPathExists(legacyPrefixPath)
    await expectPathExists(prefixSiblingPath)
  })

  it('retains exact generated delivery media for every active lifecycle state', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-active-',
    )
    const cases: Array<{
      deliveryConfirmationPending?: boolean
      seed: string
      status: AssistantOutboxIntent['status']
    }> = [
      { seed: 'c', status: 'awaiting_approval' },
      { seed: 'd', status: 'pending' },
      { seed: 'e', status: 'sending' },
      { seed: 'f', status: 'retryable' },
      {
        deliveryConfirmationPending: true,
        seed: 'g',
        status: 'failed',
      },
    ]
    const filePaths: string[] = []
    for (const entry of cases) {
      const file = await writeGeneratedDeliveryFile({
        contents: `active ${entry.status}`,
        refSuffix: `${entry.status}-${entry.seed}.zip`,
        vaultRoot,
      })
      filePaths.push(file.filePath)
      await createGeneratedDeliveryIntent({
        deliveryConfirmationPending:
          entry.deliveryConfirmationPending ?? false,
        media: file.media,
        seed: entry.seed,
        status: entry.status,
        vaultRoot,
      })
    }

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(0)
    expect(result.generatedDeliveryBytesPruned).toBe(0)
    for (const filePath of filePaths) {
      await expectPathExists(filePath)
    }
  })

  it('fails closed when an active generated delivery gains another hard link', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-active-hardlink-',
    )
    const active = await writeGeneratedDeliveryFile({
      contents: 'active linked delivery',
      refSuffix: 'active-linked.pdf',
      vaultRoot,
    })
    await chmod(active.filePath, 0o600)
    await createGeneratedDeliveryIntent({
      media: active.media,
      seed: 'r',
      status: 'pending',
      vaultRoot,
    })
    const linkedPath = path.join(vaultRoot, 'documents', 'linked-report.pdf')
    await mkdir(path.dirname(linkedPath), { recursive: true })
    await link(active.filePath, linkedPath)
    const orphan = await writeGeneratedDeliveryFile({
      contents: 'must remain',
      refSuffix: 'hardlink-orphan.pdf',
      vaultRoot,
    })

    await expect(pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })).rejects.toThrow(
      'An active assistant generated delivery must have exactly one hard link.',
    )

    await expectPathExists(active.filePath)
    await expectPathExists(linkedPath)
    await expectPathExists(orphan.filePath)
    expect((await lstat(active.filePath)).nlink).toBe(2)
  })

  it('reclaims an active ref whose bytes no longer match its persisted delivery snapshot', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-overwrite-',
    )
    const file = await writeGeneratedDeliveryFile({
      contents: 'payload-a',
      refSuffix: 'overwritten.zip',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: file.media,
      seed: 'h',
      status: 'pending',
      vaultRoot,
    })
    await writeFile(file.filePath, 'payload-b', 'utf8')
    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(1)
    expect(result.generatedDeliveryBytesPruned).toBe(
      Buffer.byteLength('payload-b'),
    )
    await expectPathMissing(file.filePath)
  })

  it('fails closed when active descriptors claim one ref with conflicting fingerprints', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-conflict-',
    )
    const file = await writeGeneratedDeliveryFile({
      contents: 'conflicted payload',
      refSuffix: 'conflicted.zip',
      vaultRoot,
    })
    const orphan = await writeGeneratedDeliveryFile({
      contents: 'orphan payload',
      refSuffix: 'conflict-orphan.zip',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: file.media,
      seed: 'p',
      status: 'pending',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: {
        ...file.media,
        sha256: 'f'.repeat(64),
        sizeBytes: file.media.sizeBytes + 1,
      },
      seed: 'q',
      status: 'awaiting_approval',
      vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryCleanupSkippedUntrustedOutbox).toBe(true)
    expect(result.generatedDeliveryFilesPruned).toBe(0)
    expect(result.generatedDeliveryBytesPruned).toBe(0)
    await expectPathExists(file.filePath)
    await expectPathExists(orphan.filePath)
  })

  it('fails closed when an active generated delivery is missing', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-missing-active-',
    )
    const active = await writeGeneratedDeliveryFile({
      contents: 'active delivery',
      refSuffix: 'missing.pdf',
      vaultRoot,
    })
    await createGeneratedDeliveryIntent({
      media: active.media,
      seed: 'i',
      status: 'pending',
      vaultRoot,
    })
    await rm(active.filePath)
    const orphan = await writeGeneratedDeliveryFile({
      contents: 'must remain',
      refSuffix: 'orphan.pdf',
      vaultRoot,
    })

    await expect(pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })).rejects.toThrow(
      'An active assistant generated delivery is missing from runtime staging.',
    )
    await expectPathExists(orphan.filePath)
  })

  it('retains the entire generated-delivery prefix when outbox inventory is untrusted', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-untrusted-',
    )
    const file = await writeGeneratedDeliveryFile({
      contents: 'retain on uncertainty',
      refSuffix: 'orphan.zip',
      vaultRoot,
    })
    await writeFile(
      path.join(paths.outboxDirectory, 'malformed.json'),
      '{ malformed',
      'utf8',
    )

    const firstResult = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(firstResult.generatedDeliveryFilesPruned).toBe(0)
    expect(
      firstResult.generatedDeliveryCleanupSkippedUntrustedOutbox,
    ).toBe(true)
    await expectPathExists(file.filePath)

    const secondResult = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })
    expect(secondResult.generatedDeliveryFilesPruned).toBe(1)
    expect(
      secondResult.generatedDeliveryCleanupSkippedUntrustedOutbox,
    ).toBe(false)
    await expectPathMissing(file.filePath)
  })

  it('treats unexpected outbox entries as untrusted before generated cleanup', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-unexpected-outbox-',
    )
    const file = await writeGeneratedDeliveryFile({
      contents: 'retain on incomplete inventory',
      refSuffix: 'orphan.pdf',
      vaultRoot,
    })
    const unexpectedPath = path.join(paths.outboxDirectory, 'unexpected.txt')
    await writeFile(unexpectedPath, 'unexpected outbox entry', 'utf8')

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(0)
    expect(result.generatedDeliveryCleanupSkippedUntrustedOutbox).toBe(true)
    await expectPathExists(file.filePath)
    await expectPathExists(unexpectedPath)
  })

  it('does not reconcile generated deliveries without an explicit quiescent boundary', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-not-quiescent-',
    )
    const file = await writeGeneratedDeliveryFile({
      contents: 'in-flight creation',
      refSuffix: 'in-flight.zip',
      vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(0)
    await expectPathExists(file.filePath)
  })

  it('prunes an orphan staging hardlink without changing its ordinary vault file', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-hardlink-',
    )
    const ordinaryPath = path.join(vaultRoot, 'documents', 'report.pdf')
    const stagingPath = path.join(
      vaultRoot,
      ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
      'report.pdf',
    )
    const contents = 'ordinary vault report'
    await mkdir(path.dirname(ordinaryPath), { recursive: true })
    await mkdir(path.dirname(stagingPath), { recursive: true })
    await writeFile(ordinaryPath, contents, { mode: 0o666 })
    await chmod(ordinaryPath, 0o666)
    await link(ordinaryPath, stagingPath)

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.generatedDeliveryFilesPruned).toBe(1)
    expect(result.generatedDeliveryBytesPruned).toBe(Buffer.byteLength(contents))
    await expectPathMissing(stagingPath)
    expect(await readFile(ordinaryPath, 'utf8')).toBe(contents)
    expect((await lstat(ordinaryPath)).nlink).toBe(1)
    expect((await lstat(ordinaryPath)).mode & 0o777).toBe(0o666)
  })

  it('rejects generated-delivery symlinks before deleting regular files', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-symlink-',
    )
    const targetPath = path.join(vaultRoot, 'outside-target.zip')
    await writeFile(targetPath, 'outside target', 'utf8')
    const regular = await writeGeneratedDeliveryFile({
      contents: 'must remain',
      refSuffix: 'regular.zip',
      vaultRoot,
    })
    const symlinkPath = path.join(
      vaultRoot,
      ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
      'linked.zip',
    )
    await symlink(targetPath, symlinkPath)

    await expect(pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })).rejects.toThrow(
      /generated-delivery paths must not contain symlinks|resolves outside the vault root/u,
    )
    await expectPathExists(regular.filePath)
    await expectPathExists(symlinkPath)
    await expectPathExists(targetPath)
  })

  it('rejects nested generated-delivery entries before deleting regular files', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-nested-',
    )
    const regular = await writeGeneratedDeliveryFile({
      contents: 'must remain',
      refSuffix: 'regular.pdf',
      vaultRoot,
    })
    const nestedPath = path.join(
      vaultRoot,
      ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
      'nested',
      'report.pdf',
    )
    await mkdir(path.dirname(nestedPath), { recursive: true })
    await writeFile(nestedPath, 'invalid nested delivery', 'utf8')

    await expect(pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })).rejects.toThrow(
      'Assistant generated-delivery staging must remain flat.',
    )
    await expectPathExists(regular.filePath)
    await expectPathExists(nestedPath)
  })

  it('rejects unsafe generated-delivery filenames before deleting regular files', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-generated-unsafe-',
    )
    const regular = await writeGeneratedDeliveryFile({
      contents: 'must remain',
      refSuffix: 'regular.pdf',
      vaultRoot,
    })
    const unsafePath = path.join(
      vaultRoot,
      ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
      '.hidden.pdf',
    )
    await writeFile(unsafePath, 'unsafe hidden delivery', 'utf8')

    await expect(pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })).rejects.toThrow(
      'Assistant generated-delivery staging contains an unsafe filename.',
    )
    await expectPathExists(regular.filePath)
    await expectPathExists(unsafePath)
  })

  it('retains pending input events and their terminal evidence', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-pending-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 1,
      vaultRoot,
    })
    await recordHostedMailboxAssistantInputItem({
      inputId: event.inputId,
      mailboxItemId: 'mailbox-item-pending',
      vault: vaultRoot,
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
    expect(result.hostedMailboxInputItemMappingsPruned).toBe(0)
    expect(result.autoReplyEvidenceFilesPruned).toBe(0)
    await expectPathExists(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathExists(resolveEvidencePath(paths, event.inputId))
    await expectPathExists(
      resolveHostedMailboxInputItemPath(paths, event.inputId),
    )
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
    await recordHostedMailboxAssistantInputItem({
      inputId: event.inputId,
      mailboxItemId: 'mailbox-item-settled',
      vault: vaultRoot,
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
    expect(result.hostedMailboxInputItemMappingsPruned).toBe(1)
    expect(result.autoReplyEvidenceGroupsPruned).toBe(1)
    expect(result.autoReplyEvidenceFilesPruned).toBe(1)
    await expectPathMissing(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathMissing(resolveEvidencePath(paths, event.inputId))
    await expectPathMissing(
      resolveHostedMailboxInputItemPath(paths, event.inputId),
    )
  })

  it('deletes hosted mailbox mappings whose input event is already absent', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-orphaned-mailbox-mapping-',
    )
    const inputId = createInputId('a')
    await recordHostedMailboxAssistantInputItem({
      inputId,
      mailboxItemId: 'mailbox-item-orphaned',
      vault: vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.hostedMailboxInputItemMappingsPruned).toBe(1)
    await expectPathMissing(resolveHostedMailboxInputItemPath(paths, inputId))
  })

  it('stops residue deletion immediately and preserves the exact abort reason', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-aborted-deletion-',
    )
    const event = await createHostedInputEvent({
      now: OLD_RECORD_AT,
      seq: 10,
      vaultRoot,
    })
    await recordHostedMailboxAssistantInputItem({
      inputId: event.inputId,
      mailboxItemId: 'mailbox-item-aborted-deletion',
      vault: vaultRoot,
    })
    const firstDeletionPath = resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    })
    const laterDeletionPath = resolveHostedMailboxInputItemPath(
      paths,
      event.inputId,
    )
    const controller = new AbortController()
    const reason = new Error('stop residue deletion')
    const signal = controller.signal
    const throwIfAborted = signal.throwIfAborted.bind(signal)
    signal.throwIfAborted = () => {
      if (
        !signal.aborted &&
        !existsSync(firstDeletionPath) &&
        existsSync(laterDeletionPath)
      ) {
        controller.abort(reason)
      }
      throwIfAborted()
    }

    await expect(pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      signal,
      vault: vaultRoot,
    })).rejects.toBe(reason)
    await expectPathMissing(firstDeletionPath)
    await expectPathExists(laterDeletionPath)
  })

  it('does not start residue pruning with an already-aborted signal', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-already-aborted-',
    )
    const inputId = createInputId('1')
    await recordHostedMailboxAssistantInputItem({
      inputId,
      mailboxItemId: 'mailbox-item-already-aborted',
      vault: vaultRoot,
    })
    const controller = new AbortController()
    const reason = new Error('stop residue pruning')
    controller.abort(reason)

    await expect(pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      signal: controller.signal,
      vault: vaultRoot,
    })).rejects.toBe(reason)
    await expectPathExists(resolveHostedMailboxInputItemPath(paths, inputId))
  })

  it('retains orphaned mailbox mappings when any mapping file is malformed', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-malformed-mailbox-mapping-',
    )
    const validInputId = createInputId('b')
    const malformedInputId = createInputId('c')
    await recordHostedMailboxAssistantInputItem({
      inputId: validInputId,
      mailboxItemId: 'mailbox-item-valid',
      vault: vaultRoot,
    })
    await recordHostedMailboxAssistantInputItem({
      inputId: malformedInputId,
      mailboxItemId: 'mailbox-item-malformed',
      vault: vaultRoot,
    })
    await writeFile(
      resolveHostedMailboxInputItemPath(paths, malformedInputId),
      '{',
      'utf8',
    )

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.hostedMailboxInputItemMappingsPruned).toBe(0)
    await expectPathExists(
      resolveHostedMailboxInputItemPath(paths, validInputId),
    )
    await expectPathExists(
      resolveHostedMailboxInputItemPath(paths, malformedInputId),
    )
  })

  it('retains orphaned mailbox mappings when the input event inventory is malformed', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-malformed-input-event-',
    )
    const inputId = createInputId('f')
    await recordHostedMailboxAssistantInputItem({
      inputId,
      mailboxItemId: 'mailbox-item-untrusted-input-inventory',
      vault: vaultRoot,
    })
    await mkdir(resolveAssistantInputEventsDirectory(paths), { recursive: true })
    await writeFile(
      path.join(
        resolveAssistantInputEventsDirectory(paths),
        `${createInputId('g')}.json`,
      ),
      '{',
      'utf8',
    )

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.hostedMailboxInputItemMappingsPruned).toBe(0)
    await expectPathExists(resolveHostedMailboxInputItemPath(paths, inputId))
  })

  it('retains orphaned mailbox mappings when the mapping inventory contains a symlink', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-symlinked-mailbox-mapping-',
    )
    const validInputId = createInputId('d')
    const symlinkInputId = createInputId('e')
    await recordHostedMailboxAssistantInputItem({
      inputId: validInputId,
      mailboxItemId: 'mailbox-item-valid',
      vault: vaultRoot,
    })
    await symlink(
      path.basename(resolveHostedMailboxInputItemPath(paths, validInputId)),
      resolveHostedMailboxInputItemPath(paths, symlinkInputId),
    )

    const result = await pruneAssistantRuntimeResidue({
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: vaultRoot,
    })

    expect(result.hostedMailboxInputItemMappingsPruned).toBe(0)
    await expectPathExists(
      resolveHostedMailboxInputItemPath(paths, validInputId),
    )
    await expectPathExists(
      resolveHostedMailboxInputItemPath(paths, symlinkInputId),
    )
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

  it('retains pending-cleanup evidence during the migration window', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-runtime-residue-migration-window-',
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
      protectPendingProviderCleanupEvidence: true,
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

  it('prunes evidence with Linq cleanup ids on normal retention; cleanup state owns deletion', async () => {
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

    expect(result.inputEventsPruned).toBe(1)
    expect(result.autoReplyEvidenceFilesPruned).toBe(1)
    await expectPathMissing(resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    }))
    await expectPathMissing(resolveEvidencePath(paths, event.inputId))
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
        acceptedAt: OLD_RECORD_AT,
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
        acceptedAt: OLD_RECORD_AT,
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

async function writeGeneratedDeliveryFile(input: {
  contents: string
  refSuffix: string
  vaultRoot: string
}): Promise<{
  filePath: string
  media: AssistantVaultFileResponseMedia
}> {
  const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/${input.refSuffix}`
  const filePath = path.join(input.vaultRoot, ...ref.split('/'))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, input.contents, 'utf8')
  return {
    filePath,
    media: await resolveAssistantVaultFileResponseMedia({
      ref,
      vaultRoot: input.vaultRoot,
    }),
  }
}

async function createGeneratedDeliveryIntent(input: {
  deliveryConfirmationPending?: boolean
  media: AssistantVaultFileResponseMedia
  seed: string
  status: AssistantOutboxIntent['status']
  vaultRoot: string
}): Promise<AssistantOutboxIntent> {
  const intent = await createAssistantOutboxIntent({
    channel: 'linq',
    createdAt: OLD_RECORD_AT,
    identityId: `participant-generated-${input.seed}`,
    initialState: input.status === 'awaiting_approval'
      ? {
          nextAttemptAt: RECENT_RECORD_AT,
          status: 'awaiting_approval',
        }
      : { status: 'pending' },
    media: [input.media],
    message: 'generated delivery',
    replyToMessageId: `message-generated-${input.seed}`,
    sessionId: createSessionId(input.seed),
    threadId: `thread-generated-${input.seed}`,
    threadIsDirect: true,
    turnId: createTurnId(input.seed),
    vault: input.vaultRoot,
  })
  if (
    input.status === intent.status &&
    (input.deliveryConfirmationPending ?? false) ===
      intent.deliveryConfirmationPending
  ) {
    return intent
  }
  return await saveAssistantOutboxIntent(input.vaultRoot, {
    ...intent,
    deliveryConfirmationPending:
      input.deliveryConfirmationPending ?? false,
    sentAt: input.status === 'sent' ? OLD_RECORD_AT : null,
    status: input.status,
    updatedAt: RECENT_RECORD_AT,
  })
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

function resolveHostedMailboxInputItemPath(
  paths: ReturnType<typeof resolveAssistantStatePaths>,
  inputId: string,
): string {
  return path.join(
    paths.assistantStateRoot,
    'hosted-mailbox-input-items',
    `${inputId}.json`,
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

function createInputId(seed: string): string {
  return `ain_${seed.repeat(32).slice(0, 32)}`
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
