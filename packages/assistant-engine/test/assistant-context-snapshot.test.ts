import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { describe, expect, it } from 'vitest'

import {
  listAssistantContextSnapshotDirtyDomainsForPath,
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  refreshAssistantContextSnapshot,
  resolveAssistantContextSnapshotPath,
} from '../src/assistant/context-snapshot.js'

describe('assistant context snapshot', () => {
  it('classifies only prompt-snapshot source domains as dirty', () => {
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'audit/2026/2026-06.jsonl',
      ),
    ).toEqual([])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        '.runtime/operations/assistant/journals/runtime-events.jsonl',
      ),
    ).toEqual([])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'bank/experiments/sauna.md',
      ),
    ).toEqual(['experiments'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'bank/goals/sleep.md',
      ),
    ).toEqual(['health_context'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'ledger/events/2026-06.jsonl',
      ),
    ).toEqual(['blood_tests'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'ledger/metric-samples/2026-06.jsonl',
      ),
    ).toEqual([])
  })

  it('does not refresh missing snapshots without a dirty marker', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })).resolves.toEqual({
        pendingDirtyDomains: [],
        refreshed: false,
        skipped: true,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toBeNull()
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('refreshes a compact prompt snapshot and keeps dirty completed snapshots readable', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await writeTestSnapshotSources(vaultRoot)

      await markAssistantContextSnapshotDirty({
        domains: ['experiments', 'blood_tests', 'health_context'],
        vaultRoot,
      })
      const refreshed = await refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })

      expect(refreshed).toMatchObject({
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      })
      const prompt = await readAssistantContextSnapshotPrompt({
        vaultRoot,
      })
      expect(prompt).toContain('Assistant context snapshot for navigation only:')
      expect(prompt).not.toContain('Wearable coverage is present')
      expect(prompt).toContain('Blood test records are present.')
      expect(prompt).toContain('Saved health context includes 1 goal.')
      expect(prompt).toContain('Active experiment context for navigation only:')
      expect(prompt).toContain('Sleep consistency')
      await markAssistantContextSnapshotDirty({
        domains: ['experiments'],
        vaultRoot,
      })

      await expect(readAssistantContextSnapshotPrompt({
        vaultRoot,
      })).resolves.toContain('Sleep consistency')
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: ['experiments'],
        })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('preserves pending dirty domains when a background refresh yields', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await markAssistantContextSnapshotDirty({
        domains: ['experiments'],
        vaultRoot,
      })

      await expect(refreshAssistantContextSnapshotBestEffort({
        shouldYield: () => true,
        vaultRoot,
      })).resolves.toEqual({
        pendingDirtyDomains: ['experiments'],
        refreshed: false,
        skipped: false,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: ['experiments'],
        })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('self-heals corrupt snapshots while oversized prompt reads return null', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const snapshotPath = resolveAssistantContextSnapshotPath(vaultRoot)

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await mkdir(path.dirname(snapshotPath), { recursive: true })
      await writeFile(snapshotPath, '{not-json', 'utf8')

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })).resolves.toMatchObject({
        refreshed: true,
        skipped: false,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: [],
        })

      await writeFile(
        snapshotPath,
        JSON.stringify({
          schema: 'murph.assistant-context-snapshot',
          schemaVersion: 1,
          value: {
            dirtySequence: 0,
            lastCompleted: {
              generatedAt: '2026-06-01T00:06:00.000Z',
              includedDomains: ['experiments'],
              promptBlock: 'large sensitive snapshot '.repeat(4_000),
              sectionPresence: {
                activeExperiments: true,
                bloodTests: false,
                healthContext: false,
              },
              sourceDirtySequence: 0,
            },
            lastRefreshAttempt: null,
            pendingDirtyDomains: [],
          },
        }),
        'utf8',
      )
      await expect(readAssistantContextSnapshotPrompt({
        vaultRoot,
      })).resolves.toBeNull()
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})

async function writeTestSnapshotSources(vaultRoot: string): Promise<void> {
  await mkdir(path.join(vaultRoot, 'bank/experiments'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'bank/experiments/sleep-consistency.md'),
    [
      '---',
      'schemaVersion: murph.frontmatter.experiment.v1',
      'docType: experiment',
      'experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM',
      'slug: sleep-consistency',
      'status: active',
      'title: Sleep consistency',
      'startedOn: 2026-05-20',
      'runPlan:',
      '  baselineStart: 2026-05-20',
      '  baselineEnd: 2026-05-26',
      '  interventionStart: 2026-05-27',
      '  interventionEnd: 2026-06-10',
      '  modality: sleep',
      '---',
      '# Sleep consistency',
      '',
    ].join('\n'),
    'utf8',
  )

  await mkdir(path.join(vaultRoot, 'bank/goals'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'bank/goals/sleep.md'),
    [
      '---',
      'schemaVersion: murph.frontmatter.goal.v1',
      'docType: goal',
      'goalId: goal_01JNY0B2W4VG5C2A0G9S8M7R6Q',
      'slug: sleep',
      'title: Sleep',
      'status: active',
      'horizon: long_term',
      'priority: 4',
      'window:',
      '  startAt: 2026-05-01',
      '---',
      '# Sleep',
      '',
    ].join('\n'),
    'utf8',
  )

  await mkdir(path.join(vaultRoot, 'ledger/events'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'ledger/events/2026-06.jsonl'),
    [
      JSON.stringify({
        kind: 'test',
        specimenType: 'blood',
        testCategory: 'blood',
      }),
      JSON.stringify({
        dataOrigin: {
          sourceProviderSlug: 'garmin',
        },
        kind: 'observation',
      }),
      '',
    ].join('\n'),
    'utf8',
  )
}
