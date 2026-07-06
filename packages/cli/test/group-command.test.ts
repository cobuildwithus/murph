import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildGroupSharedResult } from '../src/commands/group.ts'

const SHARE_ID = 'share-1'

function record(input: {
  data: Record<string, unknown>
  occurredAt: string
  recordKey: string
}) {
  return {
    receivedEventId: `evt-${input.recordKey}`,
    record: {
      data: input.data,
      occurredAt: input.occurredAt,
      recordKey: input.recordKey,
    },
    schema: 'murph.vault-share.delivery.v1',
    shareId: SHARE_ID,
  }
}

function grantor(input: {
  grantorMemberId: string
  projectionKind: string
  records: ReturnType<typeof record>[]
}) {
  return {
    grantorMemberId: input.grantorMemberId,
    projectionKind: input.projectionKind,
    records: input.records,
    shareId: SHARE_ID,
    updatedAt: '2026-07-06T00:00:00.000Z',
  }
}

function fixtureStore() {
  return {
    projections: {
      'profile-name.v0': {
        grantors: {
          'member-a': grantor({
            grantorMemberId: 'member-a',
            projectionKind: 'profile-name.v0',
            records: [
              record({
                data: { displayName: 'Alex' },
                occurredAt: '2026-07-01T00:00:00.000Z',
                recordKey: 'profile-name',
              }),
            ],
          }),
        },
      },
      'steps-days.v0': {
        grantors: {
          'member-a': grantor({
            grantorMemberId: 'member-a',
            projectionKind: 'steps-days.v0',
            records: [
              record({
                data: { date: '2026-07-05', metricKey: 'steps', unit: 'count', value: 8241 },
                occurredAt: '2026-07-05T00:00:00.000Z',
                recordKey: '2026-07-05',
              }),
            ],
          }),
        },
      },
      'sleep-times.v0': {
        grantors: {
          'member-b': grantor({
            grantorMemberId: 'member-b',
            projectionKind: 'sleep-times.v0',
            records: [
              record({
                data: {
                  date: '2026-07-05',
                  sleepEndAt: '2026-07-05T06:45:00.000Z',
                  sleepStartAt: '2026-07-04T23:10:00.000Z',
                },
                occurredAt: '2026-07-05T00:00:00.000Z',
                recordKey: '2026-07-05',
              }),
            ],
          }),
        },
      },
    },
    schema: 'murph.shared-vault-projections.v1',
    updatedAt: '2026-07-06T00:00:00.000Z',
  }
}

describe('buildGroupSharedResult', () => {
  let vault: string

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'group-shared-'))
  })

  afterEach(async () => {
    await rm(vault, { force: true, recursive: true })
  })

  async function writeStore(value: unknown) {
    const dir = join(vault, 'derived', 'vault-share')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'projections.json'), JSON.stringify(value), 'utf8')
  }

  it('returns a member-named view over the landed store', async () => {
    await writeStore(fixtureStore())
    const result = await buildGroupSharedResult({ kinds: null, vault })

    expect(result.status).toBe('ok')
    expect(result.memberCount).toBe(2)
    expect(result.sharingMemberCount).toBe(2)
    expect(result.members.map((member) => member.memberId)).toEqual(['member-a', 'member-b'])
    expect(result.members[0]?.displayName).toBe('Alex')
    expect(result.members[0]?.shares.map((share) => share.projectionKind)).toEqual([
      'steps-days.v0',
    ])
    expect(result.members[1]?.displayName).toBeNull()
  })

  it('filters to a single kind for a leaderboard and drops members without it', async () => {
    await writeStore(fixtureStore())
    const result = await buildGroupSharedResult({ kinds: ['steps-days.v0'], vault })

    expect(result.members.map((member) => member.memberId)).toEqual(['member-a'])
    expect(result.members[0]?.shares.map((share) => share.projectionKind)).toEqual([
      'steps-days.v0',
    ])
  })

  it('reports empty when no store file exists', async () => {
    const result = await buildGroupSharedResult({ kinds: null, vault })
    expect(result).toEqual({
      memberCount: 0,
      members: [],
      sharingMemberCount: 0,
      status: 'empty',
    })
  })

  it('reports unavailable for a corrupt store rather than throwing', async () => {
    await writeStore('not json' as unknown)
    const dir = join(vault, 'derived', 'vault-share')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'projections.json'), '{ not valid json', 'utf8')

    const result = await buildGroupSharedResult({ kinds: null, vault })
    expect(result.status).toBe('unavailable')
    expect(result.members).toEqual([])
  })

  it('reports unavailable when the schema tag is wrong', async () => {
    await writeStore({ ...fixtureStore(), schema: 'murph.shared-vault-projections.v0' })
    const result = await buildGroupSharedResult({ kinds: null, vault })
    expect(result.status).toBe('unavailable')
  })
})
