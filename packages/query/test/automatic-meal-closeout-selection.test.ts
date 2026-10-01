import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault } from '@murphai/core'
import { expect, test } from 'vitest'

import type { CanonicalEntity } from '../src/canonical-entities.ts'
import { insertQueryEntities, listStoredCanonicalEntities } from '../src/projection/entity-store.ts'
import { currentQueryProjectionLocation, openQueryProjectionDatabase } from '../src/projection/schema.ts'
import { rebuildQueryProjection } from '../src/query-projection.ts'

function meal(id: string, occurredAt: string, attributes: Record<string, unknown> = {}): CanonicalEntity {
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family: 'event', recordClass: 'ledger',
    kind: 'meal', status: null, occurredAt, date: occurredAt.slice(0, 10),
    path: 'events/meals.jsonl', title: null, body: null, attributes, frontmatter: null,
    links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [],
  }
}

const automatic = { externalRef: { system: 'meal-photo-capture', resourceType: 'photo' } }
const retained = { ...automatic, attachments: [{ kind: 'photo', role: 'photo', path: 'raw/synthetic.jpg' }] }

test('closeout selection bounds materialized rows after filtering and preserves retries then oldest photos', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-closeout-selection-'))
  try {
    await initializeVault({ vaultRoot })
    await rebuildQueryProjection(vaultRoot)
    const location = currentQueryProjectionLocation(vaultRoot)
    const database = openQueryProjectionDatabase(location)
    try {
      database.exec('BEGIN')
      insertQueryEntities(database, [
        ...Array.from({ length: 10_000 }, (_, i) => meal(`meal_manual_${i}`, '2099-07-23T23:00:00.000Z')),
        meal('meal_newer', '2099-07-23T12:00:00.000Z', retained),
        meal('meal_oldest', '2098-01-01T12:00:00.000Z', retained),
        meal('meal_retry', '2099-07-22T12:00:00.000Z', { ...automatic, recordedAt: '2099-07-24T01:00:00.000Z', attachments: [] }),
        meal('meal_old_removal', '2097-01-01T12:00:00.000Z', { ...automatic, recordedAt: '2099-07-24T00:59:59.999Z', attachments: [] }),
        meal('meal_wrong_source', '2097-01-01T12:00:00.000Z', { ...retained, externalRef: { system: 'other', resourceType: 'photo' } }),
        meal('meal_wrong_photo_role', '2097-01-01T12:00:00.000Z', { ...automatic, attachments: [{ kind: 'photo', role: 'receipt' }] }),
        meal('meal_future', '2099-07-24T12:00:00.000Z', retained),
      ])
      database.exec('COMMIT')
    } finally {
      database.close()
    }
    const filters = { automaticMealPhotoCloseoutAt: '2099-07-23T21:00:00-04:00', to: '2099-07-23' }
    expect(listStoredCanonicalEntities(location, { ...filters, limit: 1 }).map(row => row.entityId)).toEqual(['meal_retry'])
    expect(listStoredCanonicalEntities(location, { ...filters, limit: 2 }).map(row => row.entityId)).toEqual(['meal_retry', 'meal_oldest'])
    expect(listStoredCanonicalEntities(location, { ...filters, limit: 10 }).map(row => row.entityId)).toEqual(['meal_retry', 'meal_oldest', 'meal_newer'])
    expect(() => listStoredCanonicalEntities(location, { automaticMealPhotoCloseoutAt: 'invalid' })).toThrow('valid occurrence timestamp')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
