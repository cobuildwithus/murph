import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  exportHostedPendingAssistantRuntimeIssues,
} from '../src/hosted-runtime/issues.ts'
import {
  ASSISTANT_RUNTIME_ISSUE_SCHEMA,
  createAssistantRuntimeIssueFingerprint,
  createAssistantRuntimeIssueId,
  listPendingAssistantRuntimeIssueRecords,
  resolveAssistantStatePaths,
  resolvePendingAssistantRuntimeIssuePath,
  writePendingAssistantRuntimeIssueRecord,
} from '@murphai/runtime-state/node'

const TEST_FINGERPRINT = 'abcdef123456abcdef123456'
const TEST_ISSUE_ID = 'ari_0123456789abcdef_abcdef123456abcdef123456'

function createPendingIssueRecord(input: {
  component?: string
  issueKind?: 'dev_note_stripped' | 'retry_used'
  occurredAt: string
  severity?: 'warning' | 'error'
  surface?: string | null
}): {
  component: string
  details: Record<string, unknown>
  environment: 'local'
  errorCode: null
  fingerprint: string
  issueId: string
  issueKind: 'dev_note_stripped' | 'retry_used'
  occurredAt: string
  operation: null
  phase: 'final_response'
  schema: 'murph.assistant-runtime-issue.v1'
  severity: 'warning' | 'error'
  summary: string
  surface: string | null
} {
  const component = input.component ?? 'assistant.reply-finalizer'
  const issueKind = input.issueKind ?? 'dev_note_stripped'
  const severity = input.severity ?? 'warning'
  const summary =
    issueKind === 'retry_used'
      ? 'Assistant runtime issue: retry used during final_response.'
      : 'Assistant produced a visible developer note on a surface where developer notes are hidden.'
  const fingerprint = createAssistantRuntimeIssueFingerprint({
    component,
    errorCode: null,
    issueKind,
    operation: null,
    phase: 'final_response',
    summary,
  })
  return {
    component,
    details: {
      noteCharCount: 42,
    },
    environment: 'local',
    errorCode: null,
    fingerprint,
    issueId: createAssistantRuntimeIssueId({
      fingerprint,
      occurredAt: input.occurredAt,
    }),
    issueKind,
    occurredAt: input.occurredAt,
    operation: null,
    phase: 'final_response',
    schema: 'murph.assistant-runtime-issue.v1',
    severity,
    summary,
    surface: input.surface ?? 'telegram',
  }
}

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
          skipInvalidRecords: true,
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

  it('skips malformed or forward-versioned pending issue files and still exports valid records', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hosted-runtime-issues-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const record = createPendingIssueRecord({
        occurredAt: '2026-04-08T12:05:00.000Z',
      })
      await writePendingAssistantRuntimeIssueRecord({
        record,
        vault: vaultRoot,
      })

      const invalidIssueId = 'ari_5555555555555555_eeeeeeeeeeeeeeeeeeeeeeee'
      const invalidRecordPath = resolvePendingAssistantRuntimeIssuePath(
        resolveAssistantStatePaths(vaultRoot),
        invalidIssueId,
      )

      await writeFile(
        invalidRecordPath,
        `${JSON.stringify({
          schema: ASSISTANT_RUNTIME_ISSUE_SCHEMA,
          schemaVersion: 2,
          value: {
            ...record,
            issueId: invalidIssueId,
          },
        })}\n`,
        'utf8',
      )

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
        failed: 1,
        pending: 1,
      })
      await expect(
        listPendingAssistantRuntimeIssueRecords({
          skipInvalidRecords: true,
          vault: vaultRoot,
        }),
      ).resolves.toEqual([])
      expect((await stat(invalidRecordPath)).isFile()).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /Skipping malformed pending assistant runtime issue file .*; leaving it pending:/,
        ),
      )
    } finally {
      warnSpy.mockRestore()
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('keeps unacknowledged issue records pending and warns when the export only partially succeeds', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hosted-runtime-issues-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const firstRecord = createPendingIssueRecord({
        occurredAt: '2026-04-08T12:00:00.000Z',
      })
      const secondRecord = createPendingIssueRecord({
        component: 'assistant.retry-monitor',
        issueKind: 'retry_used',
        occurredAt: '2026-04-08T12:01:00.000Z',
        severity: 'error',
        surface: null,
      })

      for (const record of [firstRecord, secondRecord]) {
        await writePendingAssistantRuntimeIssueRecord({
          record,
          vault: vaultRoot,
        })
      }

      const issueExportPort = {
        recordIssues: vi.fn(async () => ({
          issueIds: [
            firstRecord.issueId,
            firstRecord.issueId,
            'ari_deadbeefdeadbeef_deadbeefdeadbeefdeadbeef',
          ],
          recorded: 2,
        })),
      }

      const result = await exportHostedPendingAssistantRuntimeIssues({
        issueExportPort,
        vaultRoot,
      })

      expect(result).toEqual({
        exported: 1,
        failed: 1,
        pending: 1,
      })
      expect(warnSpy).toHaveBeenCalledWith(
        'Hosted assistant runtime issue export acknowledged 1 of 2 records; leaving the remainder pending.',
      )
      await expect(
        listPendingAssistantRuntimeIssueRecords({
          vault: vaultRoot,
        }),
      ).resolves.toEqual([secondRecord])
    } finally {
      warnSpy.mockRestore()
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('retries a failed batch record-by-record and leaves any retry failures pending', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hosted-runtime-issues-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const firstRecord = createPendingIssueRecord({
        occurredAt: '2026-04-08T12:02:00.000Z',
      })
      const secondRecord = createPendingIssueRecord({
        component: 'assistant.retry-monitor',
        issueKind: 'retry_used',
        occurredAt: '2026-04-08T12:03:00.000Z',
      })

      for (const record of [firstRecord, secondRecord]) {
        await writePendingAssistantRuntimeIssueRecord({
          record,
          vault: vaultRoot,
        })
      }

      const issueExportPort = {
        recordIssues: vi
          .fn()
          .mockRejectedValueOnce(new Error('batch export unavailable'))
          .mockResolvedValueOnce({
            issueIds: [firstRecord.issueId],
            recorded: 1,
          })
          .mockRejectedValueOnce(new Error('single-record retry failed')),
      }

      const result = await exportHostedPendingAssistantRuntimeIssues({
        issueExportPort,
        vaultRoot,
      })

      expect(result).toEqual({
        exported: 1,
        failed: 1,
        pending: 1,
      })
      expect(issueExportPort.recordIssues).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          'Failed to export hosted assistant runtime issue batch of 2 records; retrying each record individually:',
        ),
      )
      expect(warnSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          'Failed to export hosted assistant runtime issue retry for 1 record:',
        ),
      )
      await expect(
        listPendingAssistantRuntimeIssueRecords({
          vault: vaultRoot,
        }),
      ).resolves.toEqual([secondRecord])
    } finally {
      warnSpy.mockRestore()
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('counts a single-record export error as failed without deleting the pending record', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-hosted-runtime-issues-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const record = createPendingIssueRecord({
        occurredAt: '2026-04-08T12:04:00.000Z',
      })
      await writePendingAssistantRuntimeIssueRecord({
        record,
        vault: vaultRoot,
      })

      const issueExportPort = {
        recordIssues: vi.fn(async () => {
          throw new Error('single export unavailable')
        }),
      }

      const result = await exportHostedPendingAssistantRuntimeIssues({
        issueExportPort,
        vaultRoot,
      })

      expect(result).toEqual({
        exported: 0,
        failed: 1,
        pending: 1,
      })
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to export hosted assistant runtime issue batch of 1 record:',
        ),
      )
      await expect(
        listPendingAssistantRuntimeIssueRecords({
          vault: vaultRoot,
        }),
      ).resolves.toEqual([record])
    } finally {
      warnSpy.mockRestore()
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})
