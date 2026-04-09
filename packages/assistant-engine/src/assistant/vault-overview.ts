import { readdir } from 'node:fs/promises'

import { resolveVaultPath, VAULT_LAYOUT, walkVaultFiles } from '@murphai/core'
import {
  listAutomations,
  listBloodTests,
  listWearableSourceHealth,
  readVault,
  type VaultReadModel,
} from '@murphai/query'

const RESEARCH_ROOT = 'research'
const DERIVED_INBOX_ROOT = 'derived/inbox'

export async function buildAssistantVaultOverviewBlock(
  vaultRoot: string,
): Promise<string | null> {
  const [
    vault,
    automations,
    bloodTests,
    rawMealManifestPaths,
    researchNotePaths,
    rawInboxPresent,
    derivedInboxPresent,
  ] =
    await Promise.all([
      readVault(vaultRoot),
      listAutomations(vaultRoot, { limit: 1 }),
      listBloodTests(vaultRoot, { limit: 1 }),
      listRawMealManifestPaths(vaultRoot),
      walkVaultFiles(vaultRoot, RESEARCH_ROOT, { extension: '.md' }),
      directoryHasEntries(vaultRoot, VAULT_LAYOUT.rawInboxDirectory),
      directoryHasEntries(vaultRoot, DERIVED_INBOX_ROOT),
    ])

  const eventKindCounts = countEventKinds(vault)
  const canonicalCoverage = summarizeCanonicalCoverage(vault, eventKindCounts)
  const wearableCoverage = summarizeWearableCoverage(vault)
  const healthContextCoverage = summarizeHealthContextCoverage(vault)
  const bloodTestCoverage = summarizeBloodTestCoverage(bloodTests.length)
  const journalAndDocumentCoverage = summarizeJournalAndDocumentCoverage(
    vault,
    eventKindCounts,
  )
  const automationCoverage = summarizeAutomationCoverage(automations.length)
  const rawCoverage = summarizeRawCoverage(rawMealManifestPaths.length)
  const bankCoverage = summarizeBankCoverage(vault)
  const otherSources = summarizeOtherSources({
    derivedInboxPresent,
    rawInboxPresent,
    researchNoteCount: researchNotePaths.length,
  })

  const lines = [
    'Vault overview for navigation only:',
    '- This is a compact orientation snapshot, not canonical evidence.',
    canonicalCoverage,
    wearableCoverage,
    healthContextCoverage,
    bloodTestCoverage,
    journalAndDocumentCoverage,
    automationCoverage,
    rawCoverage,
    bankCoverage,
    otherSources,
    '- Treat `vault-cli memory show`, relevant wiki/knowledge reads, and the canonical preferences surface as the synthesized truth surfaces.',
    '- Query the vault before making factual claims, especially about current state, dates, or counts.',
  ].filter((value): value is string => Boolean(value))

  return lines.length > 4 ? lines.join('\n') : null
}

function summarizeCanonicalCoverage(
  vault: VaultReadModel,
  eventKindCounts: ReadonlyMap<string, number>,
): string | null {
  const parts = [
    summarizePositiveCount(eventKindCounts.get('meal') ?? 0, 'meal event'),
    summarizePositiveCount(
      eventKindCounts.get('activity_session') ?? 0,
      'workout/activity session',
    ),
    summarizePositiveCount(
      eventKindCounts.get('body_measurement') ?? 0,
      'body measurement',
    ),
    summarizePositiveCount(vault.experiments.length, 'experiment'),
  ].filter((value): value is string => Boolean(value))

  if (parts.length === 0) {
    return null
  }

  return `- Canonical coverage includes ${joinWithAnd(parts)}.`
}

function summarizeWearableCoverage(vault: VaultReadModel): string | null {
  const sourceHealth = listWearableSourceHealth(vault)
  if (sourceHealth.length === 0) {
    return null
  }

  const providerNames = sourceHealth
    .map((entry) => entry.providerDisplayName)
    .filter((value, index, values) => values.indexOf(value) === index)

  return `- Wearable coverage is present via ${joinWithAnd(providerNames)}.`
}

function summarizeHealthContextCoverage(vault: VaultReadModel): string | null {
  const parts = [
    summarizePositiveCount(vault.goals.length, 'goal'),
    summarizePositiveCount(vault.conditions.length, 'condition'),
    summarizePositiveCount(vault.allergies.length, 'allergy'),
  ].filter((value): value is string => Boolean(value))

  if (parts.length === 0) {
    return null
  }

  return `- Saved health context includes ${joinWithAnd(parts)}.`
}

function summarizeBloodTestCoverage(bloodTestCount: number): string | null {
  return bloodTestCount > 0 ? '- Blood test records are present.' : null
}

function summarizeJournalAndDocumentCoverage(
  vault: VaultReadModel,
  eventKindCounts: ReadonlyMap<string, number>,
): string | null {
  const parts = [
    summarizePositiveCount(vault.journalEntries.length, 'journal day'),
    summarizePositiveCount(eventKindCounts.get('document') ?? 0, 'document'),
  ].filter((value): value is string => Boolean(value))

  if (parts.length === 0) {
    return null
  }

  return `- Additional user records include ${joinWithAnd(parts)}.`
}

function summarizeAutomationCoverage(automationCount: number): string | null {
  return automationCount > 0
    ? '- Scheduled assistant automations are present.'
    : null
}

function summarizeRawCoverage(rawMealManifestCount: number): string | null {
  if (rawMealManifestCount === 0) {
    return null
  }

  return `- Raw meal import coverage includes ${summarizeCount(rawMealManifestCount, 'manifest')} under \`raw/meals\`.`
}

function summarizeBankCoverage(vault: VaultReadModel): string | null {
  const protocolCount = vault.protocols.length
  const supplementCount = countSupplementProtocols(vault)

  if (protocolCount === 0) {
    return null
  }

  if (supplementCount === 0) {
    return `- Bank coverage includes ${summarizeCount(protocolCount, 'protocol record')}.`
  }

  return `- Bank coverage includes ${summarizeCount(protocolCount, 'protocol record')}, including ${summarizeCount(supplementCount, 'supplement')}.`
}

function summarizeOtherSources(input: {
  derivedInboxPresent: boolean
  rawInboxPresent: boolean
  researchNoteCount: number
}): string | null {
  const parts = [
    input.researchNoteCount > 0
      ? summarizeCount(input.researchNoteCount, 'research note')
      : null,
    input.rawInboxPresent ? 'raw inbox evidence' : null,
    input.derivedInboxPresent ? 'derived inbox artifacts' : null,
  ].filter((value): value is string => Boolean(value))

  if (parts.length === 0) {
    return null
  }

  return `- Other source roots present: ${joinWithAnd(parts)}.`
}

function countEventKinds(vault: VaultReadModel): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const event of vault.events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
  }

  return counts
}

function countSupplementProtocols(vault: VaultReadModel): number {
  return vault.protocols.filter((record) => {
    const kind = record.attributes.kind
    return typeof kind === 'string' && kind.trim().toLowerCase() === 'supplement'
  }).length
}

function summarizeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function summarizePositiveCount(count: number, noun: string): string | null {
  return count > 0 ? summarizeCount(count, noun) : null
}

function joinWithAnd(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? ''
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`
  }

  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

async function listRawMealManifestPaths(vaultRoot: string): Promise<string[]> {
  const rawMealPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawMealsDirectory, {
    extension: '.json',
  })

  return rawMealPaths.filter((relativePath) => relativePath.endsWith('/manifest.json'))
}

async function directoryHasEntries(
  vaultRoot: string,
  relativeDirectory: string,
): Promise<boolean> {
  try {
    const resolved = resolveVaultPath(vaultRoot, relativeDirectory)
    const entries = await readdir(resolved.absolutePath)
    return entries.length > 0
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }

    throw error
  }
}
