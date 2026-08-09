import { describe, expect, it } from 'vitest'

import { challengeStandingsResponseCardV1Schema } from '../src/index.ts'

const CARD = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: null,
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
} as const

describe('challenge standings safe integers', () => {
  it('rejects negative and cross-platform unsafe scores and targets', () => {
    for (const points of [-1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(challengeStandingsResponseCardV1Schema.safeParse({
        ...CARD,
        entries: [{ ...CARD.entries[0], points }],
      }).success).toBe(false)
    }

    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...CARD,
      format: 'collective',
      objective: {
        kind: 'target',
        targetPoints: Number.MAX_SAFE_INTEGER + 1,
      },
      collectivePoints: 0,
      coverage: 'complete',
      coverageCounts: {
        completeParticipants: 1,
        partialParticipants: 0,
        totalParticipants: 1,
        unscoredParticipants: 0,
      },
      entries: undefined,
    }).success).toBe(false)

    expect(challengeStandingsResponseCardV1Schema.safeParse({
      ...CARD,
      format: 'collective',
      objective: { kind: 'target', targetPoints: 1 },
      collectivePoints: 0,
      coverage: 'complete',
      coverageCounts: {
        completeParticipants: Number.MAX_SAFE_INTEGER + 1,
        partialParticipants: 0,
        totalParticipants: 1,
        unscoredParticipants: 0,
      },
      entries: undefined,
    }).success).toBe(false)
  })
})
