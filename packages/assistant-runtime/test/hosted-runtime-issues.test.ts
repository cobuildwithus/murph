import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  exportHostedPendingAssistantRuntimeIssues,
} from '../src/hosted-runtime/issues.ts'
import {
  listPendingAssistantRuntimeIssueRecords,
  writePendingAssistantRuntimeIssueRecord,
} from '@murphai/runtime-state/node'

const TEST_FINGERPRINT = 'abcdef123456abcdef123456'
const TEST_ISSUE_ID = 'ari_0123456789abcdef_abcdef123456abcdef123456'

describe('exportHostedPendingAssistantRuntimeIssues', () => {
  it('exports sanitized pending issue records and clears the acknowledged files', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hosted-runtime-issues-'))

    try {
      const record = {
        component: 'assistant.reply-finalizer',
        details: {
          noteCharCount: 42,
        },
        environment: 'local' as const,
        errorCode: null,
        fingerprint: TEST_FINGERPRINT,
        issueId: TEST_ISSUE_ID,
        issueKind: 'dev_note_stripped' as const,
        occurredAt: '2026-04-08T12:00:00.000Z',
        operation: null,
        phase: 'final_response' as const,
        schema: 'murph.assistant-runtime-issue.v1' as const,
        severity: 'warning' as const,
        summary: 'Assistant produced a visible developer note on a surface where developer notes are hidden.',
        surface: 'telegram',
      }

      await writePendingAssistantRuntimeIssueRecord({
        record,
        vault: vaultRoot,
      })

      const issueExportPort = {
        recordIssues: vi.fn(async (issues: readonly object[]) => ({
          issueIds: issues.map((issue) =>
            (issue as { issueId: string }).issueId,
          ),
          recorded: issues.length,
        })),
      }

      const result = await exportHostedPendingAssistantRuntimeIssues({
        issueExportPort,
        vaultRoot,
      })

      expect(result).toEqual({
        exported: 1,
        failed: 0,
        pending: 0,
      })
      expect(issueExportPort.recordIssues).toHaveBeenCalledTimes(1)
      expect(issueExportPort.recordIssues).toHaveBeenCalledWith([
        expect.objectContaining({
          component: 'assistant.reply-finalizer',
          details: {
            noteCharCount: 42,
          },
          environment: 'local',
          issueId: TEST_ISSUE_ID,
          issueKind: 'dev_note_stripped',
          phase: 'final_response',
          severity: 'warning',
          summary:
            'Assistant produced a visible developer note on a surface where developer notes are hidden.',
        }),
      ])
      await expect(
        listPendingAssistantRuntimeIssueRecords({
          vault: vaultRoot,
        }),
      ).resolves.toEqual([])
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})
