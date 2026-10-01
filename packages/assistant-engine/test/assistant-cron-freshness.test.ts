import { describe, expect, it } from 'vitest'

import {
  isCanonicalAssistantCronNotificationOccurrenceDeliverable,
  type CanonicalAutomationAssistantCronJobRecord,
} from '../src/assistant/cron/canonical-jobs.js'
import { MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID } from '../src/assistant/managed-automations.js'

const occurrenceAt = '2026-04-08T13:00:00.000Z'
const source: CanonicalAutomationAssistantCronJobRecord = {
  kind: 'automation',
  activeUntil: null,
  automationId: MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID,
  relativePath: 'automations/patterns.md',
  continuityPolicy: 'fresh',
  createdAt: '2026-04-01T00:00:00.000Z',
  instructions: 'Review current patterns.',
  route: {
    channel: 'telegram', deliveryTarget: 'synthetic-thread', identityId: null,
    participantId: null, threadId: 'synthetic-thread',
  },
  assistantTargetOverride: null,
  schedule: { kind: 'dailyLocal', localTime: '13:00' },
  slug: 'personal-patterns-update',
  status: 'active',
  summary: null,
  supportKind: null,
  plannedOccurrenceOffsetMs: null,
  contextReferences: [],
  tags: [],
  timeZone: 'UTC',
  title: 'Personal Patterns',
  updatedAt: '2026-04-01T00:00:00.000Z',
}

function deliverable(ageMs: number, overrides: Partial<CanonicalAutomationAssistantCronJobRecord> = {}) {
  return isCanonicalAssistantCronNotificationOccurrenceDeliverable({
    now: new Date(Date.parse(occurrenceAt) + ageMs),
    occurrenceAt,
    source: { ...source, ...overrides },
  })
}

describe('canonical notification freshness', () => {
  it('keeps daily Personal Patterns recoverable through four hours, then expires', () => {
    expect(deliverable(150 * 60_000)).toBe(true)
    expect(deliverable(240 * 60_000)).toBe(true)
    expect(deliverable(240 * 60_000 + 1)).toBe(false)
    expect(deliverable(24 * 60 * 60_000)).toBe(false)
  })

  it('uses immutable identity rather than the editable slug', () => {
    expect(deliverable(150 * 60_000, { slug: 'renamed-patterns' })).toBe(true)
    const ordinary = { automationId: 'automation_synthetic_reminder' }
    expect(deliverable(60 * 60_000, ordinary)).toBe(true)
    expect(deliverable(60 * 60_000 + 1, ordinary)).toBe(false)
  })

  it('preserves one-shot and custom cron schedule freshness', () => {
    expect(deliverable(60 * 60_000 + 1, {
      schedule: { kind: 'at', at: occurrenceAt },
    })).toBe(false)
    expect(deliverable(60 * 60_000 + 1, {
      schedule: { kind: 'cron', expression: '0 13 * * *' },
    })).toBe(false)
  })
})
