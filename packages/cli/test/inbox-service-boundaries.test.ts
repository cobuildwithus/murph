import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  readPromotionsByCapture,
} from '@murphai/inbox-services/testing'
import {
  createVersionedJsonStateEnvelope,
  resolveRuntimePaths,
} from '@murphai/runtime-state/node'
import { test } from 'vitest'

test.sequential('readPromotionsByCapture groups promotion entries by capture id', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-promo-'))

  try {
    const paths = resolveRuntimePaths(vaultRoot)
    await mkdir(path.dirname(paths.inboxPromotionsPath), { recursive: true })
    await writeFile(
      paths.inboxPromotionsPath,
      `${JSON.stringify(
        createVersionedJsonStateEnvelope({
          schema: 'murph.inbox-promotion-store.v1',
          schemaVersion: 1,
          value: {
            entries: [
              {
                captureId: 'cap-1',
                target: 'meal',
                status: 'applied',
                promotedAt: '2026-03-18T12:00:00.000Z',
                lookupId: 'evt-1',
                relatedId: 'meal-1',
                note: 'Breakfast',
              },
              {
                captureId: 'cap-1',
                target: 'journal',
                status: 'applied',
                promotedAt: '2026-03-18T12:05:00.000Z',
                lookupId: 'journal:2026-03-18',
                relatedId: 'evt-1',
                note: 'Breakfast',
              },
              {
                captureId: 'cap-2',
                target: 'document',
                status: 'applied',
                promotedAt: '2026-03-18T13:00:00.000Z',
                lookupId: 'evt-2',
                relatedId: 'doc-2',
                note: null,
              },
            ],
          },
        }),
        null,
        2,
      )}\n`,
      'utf8',
    )

    const grouped = await readPromotionsByCapture(paths)

    assert.deepEqual(
      grouped.get('cap-1')?.map((entry) => entry.target),
      ['meal', 'journal'],
    )
    assert.deepEqual(
      grouped.get('cap-2')?.map((entry) => entry.relatedId),
      ['doc-2'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
