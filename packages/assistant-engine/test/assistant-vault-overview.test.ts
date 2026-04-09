import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'

import { afterEach, expect, it } from 'vitest'

import {
  addActivitySession,
  addBodyMeasurement,
  addMeal,
  appendJournal,
  createExperiment,
  importDocument,
  initializeVault,
  upsertAllergy,
  upsertAutomation,
  upsertCondition,
  upsertGoal,
  upsertProtocolItem,
} from '@murphai/core'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.ts'
import { buildAssistantVaultOverviewBlock } from '../src/assistant/vault-overview.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  )
})

it('builds a navigation-only overview from canonical, raw, and source-root coverage', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-vault-overview-',
  )
  cleanupRoots.push(parentRoot)

  await initializeVault({ vaultRoot })

  await addMeal({
    note: 'Eggs and toast',
    occurredAt: '2026-04-05T08:00:00.000Z',
    vaultRoot,
  })
  await addMeal({
    note: 'Chicken and rice',
    occurredAt: '2026-04-05T18:00:00.000Z',
    vaultRoot,
  })
  await addActivitySession({
    vaultRoot,
    draft: {
      activityType: 'walk',
      durationMinutes: 30,
      occurredAt: '2026-04-06T07:30:00.000Z',
      source: 'manual',
      title: 'Morning walk',
      workout: {
        exercises: [],
        routineName: 'Walk',
        sessionNote: 'Easy pace.',
      },
    },
  })
  await addBodyMeasurement({
    vaultRoot,
    draft: {
      measurements: [{
        type: 'weight',
        unit: 'lb',
        value: 180,
      }],
      occurredAt: '2026-04-06T08:00:00.000Z',
      source: 'manual',
      title: 'Weight check-in',
    },
  })
  await createExperiment({
    vaultRoot,
    slug: 'magnesium-trial',
    startedOn: '2026-04-04T09:00:00.000Z',
    title: 'Magnesium trial',
  })
  const goal = await upsertGoal({
    vaultRoot,
    title: 'Improve sleep consistency',
    window: {
      startAt: '2026-04-01',
    },
  })
  const condition = await upsertCondition({
    assertedOn: '2024-05-01',
    bodySites: ['head'],
    clinicalStatus: 'active',
    note: 'Likely worsened by sleep disruption.',
    relatedGoalIds: [goal.record.entity.goalId],
    title: 'Migraine',
    vaultRoot,
    verificationStatus: 'confirmed',
  })
  await upsertAllergy({
    criticality: 'high',
    note: 'Avoid until formally reviewed.',
    reaction: 'rash',
    recordedOn: '2018-04-10',
    relatedConditionIds: [condition.record.entity.conditionId],
    status: 'active',
    substance: 'penicillin',
    title: 'Penicillin allergy',
    vaultRoot,
  })
  await upsertProtocolItem({
    vaultRoot,
    title: 'Magnesium glycinate',
    kind: 'supplement',
    status: 'active',
    startedOn: '2026-04-01',
  })

  await mkdir(`${vaultRoot}/research/2026/04`, { recursive: true })
  await writeFile(
    `${vaultRoot}/research/2026/04/sleep-note.md`,
    '# Sleep note\n\nMagnesium may help.\n',
  )
  await mkdir(`${vaultRoot}/raw/inbox/imessage/self/2026/04/cap_01`, {
    recursive: true,
  })
  await writeFile(
    `${vaultRoot}/raw/inbox/imessage/self/2026/04/cap_01/envelope.json`,
    '{}\n',
  )
  await mkdir(`${vaultRoot}/derived/inbox/imessage/self/2026/04/cap_01`, {
    recursive: true,
  })
  await writeFile(
    `${vaultRoot}/derived/inbox/imessage/self/2026/04/cap_01/summary.md`,
    '# Parsed\n',
  )
  await appendFile(
    `${vaultRoot}/ledger/events/2026/2026-04.jsonl`,
    `${JSON.stringify({
      schemaVersion: 'murph.event.v1',
      id: 'evt_sleep_01',
      kind: 'sleep_session',
      occurredAt: '2026-04-05T21:30:00.000Z',
      recordedAt: '2026-04-06T05:45:00.000Z',
      dayKey: '2026-04-05',
      durationMinutes: 495,
      endAt: '2026-04-06T05:45:00.000Z',
      externalRef: {
        resourceId: 'sleep_01',
        resourceType: 'sleep_session',
        system: 'whoop',
      },
      source: 'device',
      startAt: '2026-04-05T21:30:00.000Z',
      title: 'Overnight sleep',
    })}\n`,
  )
  await appendJournal({
    date: '2026-04-06',
    text: 'Energy was steadier after breakfast.',
    vaultRoot,
  })
  const documentSourcePath = `${parentRoot}/document-source.md`
  await writeFile(
    documentSourcePath,
    '# Lab report\n\nFasted lipid panel.\n',
  )
  await importDocument({
    note: 'Imported lab report.',
    sourcePath: documentSourcePath,
    title: 'Lab report',
    vaultRoot,
  })
  await upsertAutomation({
    vaultRoot,
    now: new Date('2026-04-08T00:00:00.000Z'),
    title: 'Weekly check-in',
    summary: 'Send a weekly summary.',
    prompt: 'Send a weekly summary.',
    schedule: {
      kind: 'cron',
      expression: '0 9 * * 1',
      timeZone: 'Australia/Sydney',
    },
    route: {
      channel: 'telegram',
      deliverResponse: false,
      deliveryTarget: 'self',
      identityId: 'identity-01',
      participantId: 'participant-01',
      sourceThreadId: 'thread-01',
    },
  })

  const overview = await buildAssistantVaultOverviewBlock(vaultRoot)

  expect(overview).toContain(
    'Vault overview for navigation only:',
  )
  expect(overview).toContain(
    'Canonical coverage includes 2 meal events, 1 workout/activity session, 1 body measurement, and 1 experiment.',
  )
  expect(overview).toContain(
    'Wearable coverage is present via WHOOP.',
  )
  expect(overview).toContain(
    'Saved health context includes 1 goal, 1 condition, and 1 allergy.',
  )
  expect(overview).toContain(
    'Additional user records include 1 journal day and 1 document.',
  )
  expect(overview).toContain(
    'Scheduled assistant automations are present.',
  )
  expect(overview).toContain(
    'Raw meal import coverage includes 2 manifests under `raw/meals`.',
  )
  expect(overview).toContain(
    'Bank coverage includes 1 protocol record, including 1 supplement.',
  )
  expect(overview).toContain(
    'Other source roots present: 1 research note, raw inbox evidence, and derived inbox artifacts.',
  )
  expect(overview).toContain(
    'Treat `vault-cli memory show`, relevant wiki/knowledge reads, and the canonical preferences surface as the synthesized truth surfaces.',
  )
})

it('injects the overview block into the system prompt only when provided', () => {
  const prompt = buildAssistantSystemPrompt({
    allowSensitiveHealthContext: true,
    assistantCliContract: null,
    assistantCliExecutorAvailable: true,
    assistantCronToolsAvailable: true,
    assistantHostedDeviceConnectAvailable: true,
    assistantKnowledgeToolsAvailable: true,
    channel: null,
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-09',
    currentTimeZone: 'Australia/Sydney',
    firstTurnCheckIn: false,
    vaultOverview: 'Vault overview for navigation only:\n- Canonical coverage includes 2 meal events.',
  })

  expect(prompt).toContain('Vault overview for navigation only:')
  expect(prompt).toContain('Canonical coverage includes 2 meal events.')

  const promptWithoutOverview = buildAssistantSystemPrompt({
    allowSensitiveHealthContext: true,
    assistantCliContract: null,
    assistantCliExecutorAvailable: true,
    assistantCronToolsAvailable: true,
    assistantHostedDeviceConnectAvailable: true,
    assistantKnowledgeToolsAvailable: true,
    channel: null,
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-09',
    currentTimeZone: 'Australia/Sydney',
    firstTurnCheckIn: false,
    vaultOverview: null,
  })

  expect(promptWithoutOverview).not.toContain('Vault overview for navigation only:')
})

it('returns null when the vault has no meaningful overview signals yet', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-vault-overview-empty-',
  )
  cleanupRoots.push(parentRoot)

  await initializeVault({ vaultRoot })

  await expect(buildAssistantVaultOverviewBlock(vaultRoot)).resolves.toBeNull()
})
