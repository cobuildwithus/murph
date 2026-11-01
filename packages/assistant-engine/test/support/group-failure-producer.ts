import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listPendingAssistantRuntimeIssueRecords } from '@murphai/runtime-state/node'
import { executeMurphDynamicToolRequest } from '../../src/assistant-codex/dynamic-tools.js'
import { flushPendingAssistantRuntimeIssueWrites, recordAssistantRuntimeIssueInputsBestEffort } from '../../src/assistant/issue-reporting.js'

// Substitute only the hosted request port. Keep the real dispatcher,
// classification enrichment, sanitizer and pending-file persistence.
const mode = process.argv[2]
assert(mode === '503' || mode === 'timeout')
const vault = await mkdtemp(path.join(tmpdir(), 'group-failure-producer-'))
try {
  for (const action of ['read_current', 'read_usage', 'read_current', 'read_usage'] as const) {
    const result = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 1, progressDelivery: null,
      request: { kind: 'group', request: { action } }, vaultRoot: null,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
        vaultFileSendAvailable: false,
        sendVaultFile: async () => { throw new Error('Unexpected file send') },
        groupTool: { request: async () => {
          throw Object.assign(new Error('synthetic private upstream response'), mode === '503'
            ? { statusCode: 503, retryable: true }
            : { hostedRuntimeFetchCauseKind: 'timeout' })
        } },
      },
    })
    assert.equal(result.rpcResult.success, false)
    assert.equal(result.runtimeIssueInputs?.length, 1)
    recordAssistantRuntimeIssueInputsBestEffort({
      issues: result.runtimeIssueInputs, vault,
      policy: { environment: 'hosted', surface: null, privateIssueCaptureEnabled: true },
    })
  }
  await flushPendingAssistantRuntimeIssueWrites()
  process.stdout.write(JSON.stringify(await listPendingAssistantRuntimeIssueRecords({ vault })))
} finally {
  await rm(vault, { recursive: true, force: true })
}
