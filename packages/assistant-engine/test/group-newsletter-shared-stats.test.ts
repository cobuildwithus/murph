import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
} from '@murphai/hosted-execution/vault-share'
import { describe, expect, it } from 'vitest'

import {
  buildGroupNewsletterSharedWeeklyStats,
  GroupNewsletterSharedProjectionUnavailableError,
  readGroupNewsletterSharedMemberDailyRecords,
} from '../src/assistant-codex/group-newsletter-shared-stats.js'

describe('group newsletter shared stats', () => {
  it('reads member daily records and feeds weekly overview stats', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'group-newsletter-shared-stats-'))
    try {
      await mkdir(join(vaultRoot, 'derived', 'vault-share'), { recursive: true })
      await writeFile(
        join(vaultRoot, 'derived', 'vault-share', 'projections.json'),
        JSON.stringify({
          projections: {
            'profile-name.v0': projection('profile-name.v0', {
              member_a: [
                deliveryEntry({
                  data: { displayName: 'Alex' },
                  occurredAt: '2026-07-01T00:00:00.000Z',
                  recordKey: 'profile-name',
                }),
              ],
            }),
            'sleep-times.v0': projection('sleep-times.v0', {
              member_a: [
                deliveryEntry({
                  data: {
                    date: '2026-07-06',
                    sleepEndAt: '2026-07-07T06:00:00.000Z',
                    sleepStartAt: '2026-07-06T22:00:00.000Z',
                  },
                  occurredAt: '2026-07-06T00:00:00.000Z',
                  recordKey: '2026-07-06',
                }),
              ],
            }),
            'steps-days.v0': projection('steps-days.v0', {
              member_a: [
                deliveryEntry({
                  data: {
                    date: '2026-06-29',
                    metricKey: 'steps',
                    unit: 'count',
                    value: 8_000,
                  },
                  occurredAt: '2026-06-29T00:00:00.000Z',
                  recordKey: '2026-06-29',
                }),
                deliveryEntry({
                  data: {
                    date: '2026-07-06',
                    metricKey: 'steps',
                    unit: 'count',
                    value: 12_000,
                  },
                  occurredAt: '2026-07-06T00:00:00.000Z',
                  recordKey: '2026-07-06',
                }),
              ],
            }),
          },
          schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
          updatedAt: '2026-07-07T12:00:00.000Z',
        }),
        'utf8',
      )

      const members = await readGroupNewsletterSharedMemberDailyRecords({ vaultRoot })
      expect(members).toHaveLength(1)
      expect(members[0]).toMatchObject({
        displayName: 'Alex',
        memberId: 'member_a',
      })
      expect(members[0]?.dailySampleSummaries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          date: '2026-07-06',
          stream: 'sleep-duration-minutes',
          sumValue: 480,
          unit: 'minutes',
        }),
        expect.objectContaining({
          date: '2026-07-06',
          stream: 'steps',
          sumValue: 12_000,
          unit: 'count',
        }),
      ]))

      const stats = buildGroupNewsletterSharedWeeklyStats({
        dailySampleSummaries: members[0]?.dailySampleSummaries ?? [],
        referenceDate: '2026-07-06T12:00:00.000Z',
        timeZone: 'UTC',
      })
      expect(stats).toEqual(expect.arrayContaining([
        {
          currentWeekAvg: 12_000,
          deltaPercent: 50,
          previousWeekAvg: 8_000,
          stream: 'steps',
          unit: 'count',
        },
      ]))
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })

  it('treats a missing projection file as empty shared stats', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'group-newsletter-shared-stats-missing-'))
    try {
      await expect(readGroupNewsletterSharedMemberDailyRecords({ vaultRoot }))
        .resolves.toEqual([])
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })

  it('fails closed when the projection file exists but is corrupt', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'group-newsletter-shared-stats-corrupt-'))
    try {
      await mkdir(join(vaultRoot, 'derived', 'vault-share'), { recursive: true })
      await writeFile(
        join(vaultRoot, 'derived', 'vault-share', 'projections.json'),
        '{ not valid json',
        'utf8',
      )

      await expect(readGroupNewsletterSharedMemberDailyRecords({ vaultRoot }))
        .rejects.toBeInstanceOf(GroupNewsletterSharedProjectionUnavailableError)
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })
})

function projection(
  projectionKind: string,
  memberRecords: Record<string, ReturnType<typeof deliveryEntry>[]>,
) {
  return {
    grantors: Object.fromEntries(
      Object.entries(memberRecords).map(([grantorMemberId, records]) => [
        grantorMemberId,
        {
          grantorMemberId,
          projectionKind,
          records,
          shareId: 'share_1',
          updatedAt: '2026-07-07T12:00:00.000Z',
        },
      ]),
    ),
  }
}

function deliveryEntry(record: {
  data: unknown
  occurredAt: string
  recordKey: string
}) {
  return {
    receivedEventId: `event_${record.recordKey}`,
    record,
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: 'share_1',
  }
}
