import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.js'
import {
  listPendingAssistantAutoReplyLinqCleanupEvidence,
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  writeAssistantAutoReplySuppressionEvidence,
} from '../src/assistant/automation/evidence.js'

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
