import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.js'
import {
  findAssistantAutoReplyDeliveryIntentIds,
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued,
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  writeAssistantAutoReplySuppressionEvidence,
} from '../src/assistant/automation/evidence.js'
import { createAssistantTurnReceipt } from '../src/assistant/turns.js'

test('auto-reply terminal evidence readers ignore malformed evidence files', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistant-auto-reply-evidence-'))
  try {
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: ['cap_valid_cleanup'],
      linqMessageIds: ['linq_message_1'],
      reason: 'channel cannot reply',
      recordedAt: '2026-04-08T00:00:00.000Z',
      vault: vaultRoot,
    })
    const evidenceDirectory = path.join(
      resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      'auto-reply',
      'evidence',
    )
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      path.join(evidenceDirectory, 'cap_malformed_cleanup.json'),
      '{"schema":',
      'utf8',
    )

    assert.equal(
      await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
        vaultRoot,
        'cap_malformed_cleanup',
      ),
      null,
    )
    assert.deepEqual(
      await listPendingAssistantAutoReplyLinqCleanupEvidence({ vault: vaultRoot }),
      {
        captureIds: ['cap_valid_cleanup'],
        linqMessageIds: ['linq_message_1'],
      },
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('auto-reply terminal evidence reader accepts historical retry-exhausted evidence', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistant-auto-reply-evidence-'))
  try {
    const evidenceDirectory = path.join(
      resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
      'auto-reply',
      'evidence',
    )
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      path.join(evidenceDirectory, `${encodeURIComponent('cap_legacy_retry')}.json`),
      `${JSON.stringify({
        captureId: 'cap_legacy_retry',
        groupCaptureIds: ['cap_legacy_retry', 'cap_legacy_retry_2'],
        groupId: 'group_cap_legacy_retry',
        groupInputIds: ['ain_legacy_retry'],
        inputId: 'cap_legacy_retry',
        primaryCaptureId: 'cap_legacy_retry',
        primaryInputId: 'ain_legacy_retry',
        providerCleanup: {
          linqMessageIds: ['linq_message_legacy'],
          queuedAt: null,
        },
        recordedAt: '2026-04-08T00:00:00.000Z',
        schema: 'murph.assistant-auto-reply-terminal-evidence.v1',
        terminal: {
          failedAttempts: 3,
          kind: 'retry_exhausted',
          maxFailedAttempts: 3,
          reason: 'legacy retry limit reached',
        },
      })}\n`,
      'utf8',
    )

    assert.deepEqual(
      await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
        vaultRoot,
        'cap_legacy_retry',
      ),
      {
        captureId: 'cap_legacy_retry',
        groupCaptureIds: ['cap_legacy_retry', 'cap_legacy_retry_2'],
        groupId: 'group_cap_legacy_retry',
        groupInputIds: ['ain_legacy_retry'],
        inputId: 'cap_legacy_retry',
        primaryCaptureId: 'cap_legacy_retry',
        primaryInputId: 'ain_legacy_retry',
        providerCleanup: {
          linqMessageIds: ['linq_message_legacy'],
          queuedAt: null,
        },
        recordedAt: '2026-04-08T00:00:00.000Z',
        schema: 'murph.assistant-auto-reply-terminal-evidence.v1',
        terminal: {
          failedAttempts: 3,
          kind: 'retry_exhausted',
          maxFailedAttempts: 3,
          reason: 'legacy retry limit reached',
        },
      },
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('auto-reply Linq cleanup handles input-id keyed terminal evidence', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistant-auto-reply-evidence-'))
  try {
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: ['cap_input_cleanup'],
      inputIds: ['ain_input_cleanup'],
      linqMessageIds: ['linq_message_input', 'linq_message_input'],
      reason: 'channel cannot reply',
      recordedAt: '2026-04-08T00:00:00.000Z',
      vault: vaultRoot,
    })

    assert.deepEqual(
      await listPendingAssistantAutoReplyLinqCleanupEvidence({ vault: vaultRoot }),
      {
        captureIds: ['ain_input_cleanup'],
        linqMessageIds: ['linq_message_input'],
      },
    )

    await markAssistantAutoReplyLinqCleanupQueued({
      captureIds: ['ain_input_cleanup'],
      queuedAt: '2026-04-08T00:01:00.000Z',
      vault: vaultRoot,
    })

    assert.deepEqual(
      await listPendingAssistantAutoReplyLinqCleanupEvidence({ vault: vaultRoot }),
      {
        captureIds: [],
        linqMessageIds: [],
      },
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('auto-reply delivery intent lookup uses origin and bounded turn receipts', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistant-auto-reply-evidence-'))
  try {
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      metadata: {
        autoReplyInputId: 'ain_auto_reply',
      },
      prompt: 'auto reply',
      provider: 'codex-cli',
      providerModel: 'gpt-test',
      sessionId: 'session_auto_reply',
      startedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn_auto_reply',
      vault: vaultRoot,
    })

    assert.deepEqual(
      await findAssistantAutoReplyDeliveryIntentIds({
        intents: [
          {
            deliveryOrigin: null,
            intentId: 'intent_legacy_segment',
            turnId: 'turn_auto_reply',
          },
          {
            deliveryOrigin: null,
            intentId: 'intent_legacy_final',
            turnId: 'turn_auto_reply',
          },
          {
            deliveryOrigin: 'auto_reply',
            intentId: 'intent_origin_only',
            turnId: 'turn_no_receipt',
          },
          {
            deliveryOrigin: null,
            intentId: 'intent_other',
            turnId: 'turn_other',
          },
        ],
        vault: vaultRoot,
      }),
      new Set([
        'intent_legacy_segment',
        'intent_legacy_final',
        'intent_origin_only',
      ]),
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})
