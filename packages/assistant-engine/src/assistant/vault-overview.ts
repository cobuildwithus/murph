import { readdir } from 'node:fs/promises'

import { resolveVaultPath, VAULT_LAYOUT, walkVaultFiles } from '@murphai/core'
import {
  listWearableSourceHealth,
  readVault,
  type VaultReadModel,
} from '@murphai/query'

const RESEARCH_ROOT = 'research'
const DERIVED_INBOX_ROOT = 'derived/inbox'

export async function buildAssistantVaultOverviewBlock(
  vaultRoot: string,
): Promise<string | null> {
  const [vault, rawMealManifestPaths, researchNotePaths, rawInboxPresent, derivedInboxPresent] =
    await Promise.all([
      readVault(vaultRoot),
      listRawMealManifestPaths(vaultRoot),
      walkVaultFiles(vaultRoot, RESEARCH_ROOT, { extension: '.md' }),
      directoryHasEntries(vaultRoot, VAULT_LAYOUT.rawInboxDirectory),
      directoryHasEntries(vaultRoot, DERIVED_INBOX_ROOT),
    ])

  const canonicalCoverage = summarizeCanonicalCoverage(vault)
  const wearableCoverage = summarizeWearableCoverage(vault)
  const healthContextCoverage = summarizeHealthContextCoverage(vault)
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
    rawCoverage,
    bankCoverage,
    otherSources,
    '- Treat `vault-cli memory show`, relevant wiki/knowledge reads, and the canonical preferences surface as the synthesized truth surfaces.',
    '- Query the vault before making factual claims, especially about current state, dates, or counts.',
  ].filter((value): value is string => Boolean(value))

  return lines.length > 4 ? lines.join('\n') : null
}

function summarizeCanonicalCoverage(vault: VaultReadModel): string | null {
  const parts = [
    summarizePositiveCount(countEventsOfKind(vault, 'meal'), 'meal event'),
    summarizePositiveCount(
      countEventsOfKind(vault, 'activity_session'),
      'workout/activity session',
    ),
    summarizePositiveCount(
      countEventsOfKind(vault, 'body_measurement'),
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

function countEventsOfKind(vault: VaultReadModel, kind: string): number {
  return vault.events.filter((event) => event.kind === kind).length
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
