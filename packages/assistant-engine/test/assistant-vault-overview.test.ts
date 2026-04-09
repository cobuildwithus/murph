import { mkdir, rm, writeFile } from 'node:fs/promises'

import { afterEach, expect, it } from 'vitest'

import {
  addActivitySession,
  addMeal,
  initializeVault,
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

  const overview = await buildAssistantVaultOverviewBlock(vaultRoot)

  expect(overview).toContain(
    'Vault overview for navigation only:',
  )
  expect(overview).toContain(
    'Canonical coverage includes 2 meal events and 1 activity session.',
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
    'Treat `vault-cli profile show current` and relevant wiki/knowledge reads as the synthesized truth surfaces.',
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
