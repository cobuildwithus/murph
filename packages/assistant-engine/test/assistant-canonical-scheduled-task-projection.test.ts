import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeVault, upsertAutomation } from '@murphai/core'
import { listCanonicalAssistantCronRecords } from '../src/assistant/cron/canonical-jobs.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('canonical scheduled-task projection', () => {
  it('retains the immutable group-challenge task identity on the cron source', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-scheduled-task-projection-'))
    tempRoots.push(vaultRoot)
    await initializeVault({
      createdAt: '2026-07-18T00:00:00.000Z',
      vaultRoot,
    })
    await upsertAutomation({
      activeUntil: '2026-07-20T23:00:00.000-04:00',
      continuityPolicy: 'preserve',
      instructions: 'Send the prepared group challenge dispatch.',
      route: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: 'group_chat',
        identityId: 'linq_identity',
        participantId: null,
        threadId: 'group_chat',
        threadIsDirect: false,
      },
      schedule: { kind: 'dailyLocal', localTime: '08:30' },
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: 'morning-mobility',
        projectionScopeKey: 'steps-days.v0',
      },
      slug: 'morning-mobility-dispatch',
      status: 'active',
      title: 'Morning mobility dispatch',
      vaultRoot,
    })

    await expect(listCanonicalAssistantCronRecords(vaultRoot)).resolves.toEqual([
      expect.objectContaining({
        activeUntil: '2026-07-20T23:00:00.000-04:00',
        kind: 'automation',
        scheduledTask: {
          kind: 'group_challenge',
          knowledgeSlug: 'morning-mobility',
          projectionScopeKey: 'steps-days.v0',
        },
      }),
    ])
  })
})
