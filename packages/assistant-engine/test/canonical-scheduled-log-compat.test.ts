import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault, upsertScheduledLog } from '@murphai/core'
import { expect, test } from 'vitest'

import { listAssistantCronJobs } from '../src/assistant-cron.ts'

test('canonical cron loading retains scheduled logs at the historical slug boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-scheduled-log-boundary-'))
  const slug = 's'.repeat(160)

  try {
    await initializeVault({ vaultRoot })
    const saved = await upsertScheduledLog({
      action: {
        kind: 'measurement.add',
        measurements: [{ metric: 'body-weight', unit: 'lb', value: 181.4 }],
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '07:00',
      },
      body: 'Record the historical boundary measurement.',
      slug,
      status: 'active',
      title: 'Historical boundary schedule',
      vaultRoot,
    })

    await expect(listAssistantCronJobs(vaultRoot)).resolves.toContainEqual(
      expect.objectContaining({
        jobId: saved.record.scheduledLogId,
        name: saved.record.title,
        scheduledLog: {
          actionKind: 'measurement.add',
          scheduledLogId: saved.record.scheduledLogId,
        },
      }),
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})
