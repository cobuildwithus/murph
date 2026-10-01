import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import type { FrontmatterObject } from '@murphai/contracts'
import {
  appendBloodTest,
  deterministicContractId,
  importDeviceBatch,
  initializeVault,
  stringifyFrontmatterDocument,
  visitEventLedgerShardRecordsInterruptible,
  VAULT_LAYOUT,
} from '@murphai/core'
import {
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  refreshAssistantContextSnapshot,
  type AssistantContextSnapshotDirtyDomain,
  type AssistantContextSnapshotRefreshResult,
} from '@murphai/assistant-engine'

// Run only in a disposable, network-disabled Docker container. Its writable
// layer owns this synthetic vault; no provider credentials or production data.
// Bundle with the repository esbuild/tsconfig convention. Use the shared resource
// probe when measuring cgroup peaks; lifetime RSS includes fixture preparation.
// Per-phase RSS values are endpoint snapshots, not sampled operation peaks.
// MURPH_CONTEXT_SCENARIO selects a fixture; MURPH_CONTEXT_REQUIRE_PREEMPTION=1
// additionally requires an arriving timer to stop an event-shard scan.
const variant = process.env.MURPH_CONTEXT_SCENARIO ?? 'small'
const variants = ['small', 'events8000', 'shards80', 'experiments64', 'large-shard', 'health-bodies']
assert.ok(variants.includes(variant))
const root = await mkdtemp(path.join(os.tmpdir(), 'murph-context-bench-'))
const fixedNow = () => '2026-09-01T12:00:00.000Z'
let timerShardPath: string | null = null
const allDomains: AssistantContextSnapshotDirtyDomain[] = ['experiments', 'blood_tests', 'health_context', 'habitat']
console.log(JSON.stringify({ stage: 'module-ready', variant, wallMs: performance.now() }))

async function writeDocument(
  directory: string,
  slug: string,
  attributes: FrontmatterObject,
  body = '',
) {
  const directoryPath = path.join(root, directory)
  await mkdir(directoryPath, { recursive: true })
  await writeFile(path.join(directoryPath, `${slug}.md`), stringifyFrontmatterDocument({ attributes, body }))
}

async function seed() {
  await initializeVault({ vaultRoot: root, createdAt: fixedNow() })
  await writeDocument(VAULT_LAYOUT.conditionsDirectory, 'synthetic-condition', {
    schemaVersion: 'murph.frontmatter.condition.v1', docType: 'condition',
    conditionId: deterministicContractId('cond', 'synthetic-condition'),
    slug: 'synthetic-condition', title: 'Synthetic condition', clinicalStatus: 'active',
    verificationStatus: 'confirmed', severity: 'mild', assertedOn: '2026-08-01',
  }, variant === 'health-bodies' ? 'Synthetic narrative body. '.repeat(640000) : '')
  await appendBloodTest({ vaultRoot: root, occurredAt: '2026-08-01T12:00:00.000Z', testName: 'synthetic-panel', title: 'Synthetic panel' })
  if (variant === 'events8000' || variant === 'large-shard') {
    const count = variant === 'large-shard' ? 16000 : 8000
    const padding = variant === 'large-shard' ? 'Synthetic benchmark payload. '.repeat(125) : ''
    const shardPaths = new Set<string>()
    for (let offset = 0; offset < count; offset += 8000) {
      const imported = await importDeviceBatch({
        vaultRoot: root, provider: 'synthetic', importedAt: fixedNow(),
        events: Array.from({ length: Math.min(8000, count - offset) }, (_, index) => ({
          kind: 'observation' as const, occurredAt: '2026-08-01T12:00:00.000Z',
          recordedAt: fixedNow(), timeZone: 'UTC', title: 'Synthetic observation', ...(padding ? { note: padding } : {}),
          externalRef: { system: 'synthetic', resourceType: 'metric', resourceId: `sample-${offset + index}`, version: 'v1' },
          fields: { metric: 'synthetic-metric', unit: 'count', value: offset + index },
        })),
      })
      assert.equal(imported.events.length, Math.min(8000, count - offset))
      imported.eventShardPaths.forEach(relativePath => shardPaths.add(relativePath))
    }
    timerShardPath = [...shardPaths][0] ?? null
    const shardBytes = await Promise.all([...shardPaths].map(async relativePath => (await stat(path.join(root, relativePath))).size))
    console.log(JSON.stringify({ stage: 'fixture', variant, eventCount: count, shardBytes }))
  }
  if (variant === 'shards80') {
    const directoryPath = path.join(root, VAULT_LAYOUT.eventLedgerDirectory)
    for (let index = 0; index < 80; index++) {
      await writeFile(path.join(directoryPath, `synthetic-${String(index).padStart(3, '0')}.jsonl`), '')
    }
  }
  if (variant === 'experiments64') {
    for (let index = 0; index < 64; index++) {
      const slug = `synthetic-experiment-${String(index).padStart(3, '0')}`
      await writeDocument(VAULT_LAYOUT.experimentsDirectory, slug, {
        schemaVersion: 'murph.frontmatter.experiment.v1', docType: 'experiment',
        experimentId: deterministicContractId('exp', slug), slug,
        title: `Synthetic experiment ${index}`, status: 'active', startedOn: '2026-08-01',
        runPlan: { baselineStart: '2026-08-01', baselineEnd: '2026-08-07', interventionStart: '2026-08-08', interventionEnd: '2026-08-28', modality: 'synthetic' },
      }, 'Synthetic body excluded by the bounded frontmatter reader. '.repeat(2048))
    }
  }
}

async function readVerifiedSnapshot(
  budget: number | null,
  domains: AssistantContextSnapshotDirtyDomain[] | null,
  result: AssistantContextSnapshotRefreshResult,
) {
  const state = await readAssistantContextSnapshotState(root)
  const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot: root })
  const degraded = prompt?.includes('currently unavailable in the snapshot') ?? false
  if (budget === null) {
    assert.ok(result.refreshed || result.skipped)
    assert.equal(state?.pendingDirtyDomains.length, 0)
    assert.ok(prompt?.includes('Active conditions:'))
    assert.ok(prompt?.includes('Blood test records are present (latest 2026-08-01)'))
    if (variant === 'experiments64') assert.ok(prompt?.includes('61 additional active experiments'))
    assert.equal(degraded, false)
  } else if (!result.refreshed && !result.skipped) {
    assert.ok(state?.pendingDirtyDomains.length)
    if (domains?.includes('blood_tests') || domains?.includes('health_context')) assert.equal(degraded, true)
  }
  return { state, prompt, degraded }
}

async function measureRefresh(
  stage: string,
  budget: number | null,
  domains: AssistantContextSnapshotDirtyDomain[] | null,
) {
  if (domains) await markAssistantContextSnapshotDirty({ domains, vaultRoot: root })
  globalThis.gc?.()
  await delay(10)
  const loop = monitorEventLoopDelay({ resolution: 5 })
  loop.enable()
  await delay(10)
  const beforeMemory = process.memoryUsage()
  const cpuStarted = process.cpuUsage()
  const started = performance.now()
  let continuationChecks = 0
  const refresh = budget === null ? refreshAssistantContextSnapshot : refreshAssistantContextSnapshotBestEffort
  const result = await refresh({
    vaultRoot: root, now: fixedNow,
    shouldYield: () => { continuationChecks++; return budget !== null && continuationChecks > budget },
  })
  const wallMs = performance.now() - started
  const used = process.cpuUsage(cpuStarted)
  const afterMemory = process.memoryUsage()
  await delay(10)
  loop.disable()
  const { state, prompt, degraded } = await readVerifiedSnapshot(budget, domains, result)
  const semanticSha256 = createHash('sha256').update(prompt ?? '').digest('hex')
  console.log(JSON.stringify({
    stage, variant, budget, continuationChecks, wallMs,
    cpuMs: (used.user + used.system) / 1000,
    rssBeforeBytes: beforeMemory.rss, rssAfterBytes: afterMemory.rss,
    heapDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
    externalDeltaBytes: afterMemory.external - beforeMemory.external,
    arrayBufferDeltaBytes: afterMemory.arrayBuffers - beforeMemory.arrayBuffers,
    lifetimeMaxRssKiB: process.resourceUsage().maxRSS,
    eventLoopMaxMs: loop.max / 1e6, result, degraded,
    lastCompletedSourceDirtySequence: state?.lastCompleted?.sourceDirtySequence ?? null,
    dirtySequence: state?.dirtySequence ?? null,
    refreshAttemptErrorCode: state?.lastRefreshAttempt?.errorCode ?? null,
    semanticSha256,
  }))
}

async function measureVisitorPreemption() {
  if (!timerShardPath) return
  const controller = new AbortController()
  const reason = new Error('Synthetic foreground wake')
  let visits = 0
  let scheduledAt = 0
  let firedAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let preempted = false
  const started = performance.now()
  try {
    await visitEventLedgerShardRecordsInterruptible({
      vaultRoot: root,
      relativePath: timerShardPath,
      signal: controller.signal,
      visit: () => {
        visits += 1
        if (visits === 1) {
          scheduledAt = performance.now()
          timer = setTimeout(() => {
            firedAt = performance.now()
            controller.abort(reason)
          }, 0)
        }
      },
    })
  } catch (error) {
    if (error !== reason) throw error
    preempted = true
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (process.env.MURPH_CONTEXT_REQUIRE_PREEMPTION === '1') assert.ok(preempted)
  const returnedAt = performance.now()
  console.log(JSON.stringify({
    stage: 'timer-preemption', variant, preempted, visitsBeforeReturn: visits,
    wallMs: returnedAt - started,
    beforeTimerArmedMs: scheduledAt === 0 ? null : scheduledAt - started,
    timerLagMs: firedAt === null ? null : firedAt - scheduledAt,
    abortToReturnMs: firedAt === null ? null : returnedAt - firedAt,
  }))
}

try {
  await seed()
  await measureRefresh('foreground-first-64', 64, allDomains)
  await measureRefresh('complete', null, allDomains)
  await measureRefresh('clean-skip', 64, null)
  await measureRefresh('foreground-dirty-64', 64, ['blood_tests'])
  await measureRefresh('foreground-repeat-64', 64, null)
  await measureRefresh('complete-again', null, null)
  await measureVisitorPreemption()
} finally {
  await rm(root, { recursive: true, force: true })
}
