import {
  readAssistantCliLlmsManifest,
  type AssistantCliLlmsManifest,
} from '../assistant-cli-tools.js'
import {
  getAssistantStateDocument,
  putAssistantStateDocument,
} from './state.js'

const assistantCliSurfaceBootstrapSchemaVersion =
  'murph.assistant-cli-surface-bootstrap.v1'
const assistantCliSurfaceBootstrapForcedFamilies = [
  'assistant',
  'inbox',
  'knowledge',
  'device',
] as const
const assistantCliSurfaceBootstrapRootCommandLimit = 10
const assistantCliSurfaceBootstrapFamilyLimit = 8
const assistantCliSurfaceBootstrapFamilyEntryLimit = 6

let cachedAssistantCliSurfaceSummaryPromise: Promise<string | null> | null = null

export function buildAssistantCliSurfaceBootstrapDocId(sessionId: string): string {
  return `sessions/${sessionId}/cli-surface-bootstrap`
}

export async function resolveAssistantCliSurfaceBootstrapContext(input: {
  cliEnv?: NodeJS.ProcessEnv
  sessionId: string
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  const docId = buildAssistantCliSurfaceBootstrapDocId(input.sessionId)
  const existing = await getAssistantStateDocument({
    docId,
    vault: input.vault,
  })
  const persistedSummary = parsePersistedAssistantCliSurfaceSummary(existing.value)
  if (persistedSummary) {
    return persistedSummary
  }

  const summary = await loadAssistantCliSurfaceSummary({
    cliEnv: input.cliEnv,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  })
  if (!summary) {
    return null
  }

  await putAssistantStateDocument({
    docId,
    value: {
      generatedAt: new Date().toISOString(),
      schemaVersion: assistantCliSurfaceBootstrapSchemaVersion,
      summary,
    },
    vault: input.vault,
  })

  return summary
}

export function buildAssistantCliSurfaceSummary(
  manifest: AssistantCliLlmsManifest,
): string | null {
  const commandNames = normalizeAssistantCliManifestCommandNames(manifest)
  if (commandNames.length === 0) {
    return null
  }

  const rootCommands = commandNames
    .filter((name) => !name.includes(' '))
    .slice(0, assistantCliSurfaceBootstrapRootCommandLimit)
  const groupedFamilies = groupAssistantCliManifestFamilies(commandNames)
  const selectedFamilies = selectAssistantCliSurfaceFamilies(groupedFamilies)
  const familyLines = selectedFamilies
    .map(([family, names]) => summarizeAssistantCliSurfaceFamily(family, names))
    .filter((line): line is string => line !== null)

  return [
    'CLI surface summary:',
    'Generated from compact `vault-cli --llms --format json` output.',
    rootCommands.length > 0
      ? `Standalone root commands: ${rootCommands.join(', ')}.`
      : null,
    selectedFamilies.length > 0
      ? `Major command families: ${selectedFamilies.map(([family]) => family).join(', ')}.`
      : null,
    ...familyLines,
    'Many record families use list/show/scaffold/upsert or edit/delete variants. Confirm exact args with `--schema --format json`.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function parsePersistedAssistantCliSurfaceSummary(
  value: Record<string, unknown> | null,
): string | null {
  if (!value) {
    return null
  }

  const summary = value.summary
  return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : null
}

async function loadAssistantCliSurfaceSummary(input: {
  cliEnv?: NodeJS.ProcessEnv
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  if (cachedAssistantCliSurfaceSummaryPromise === null) {
    cachedAssistantCliSurfaceSummaryPromise = generateAssistantCliSurfaceSummary(input)
  }

  try {
    return await cachedAssistantCliSurfaceSummaryPromise
  } catch {
    cachedAssistantCliSurfaceSummaryPromise = null
    return null
  }
}

async function generateAssistantCliSurfaceSummary(input: {
  cliEnv?: NodeJS.ProcessEnv
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  const manifest = await readAssistantCliLlmsManifest({
    cliEnv: input.cliEnv,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  })
  return buildAssistantCliSurfaceSummary(manifest)
}

function normalizeAssistantCliManifestCommandNames(
  manifest: AssistantCliLlmsManifest,
): string[] {
  const names = manifest.commands
    .map((command) => command.name.trim())
    .filter((name) => name.length > 0)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

function groupAssistantCliManifestFamilies(
  commandNames: readonly string[],
): Map<string, string[]> {
  const families = new Map<string, string[]>()

  for (const commandName of commandNames) {
    const separatorIndex = commandName.indexOf(' ')
    if (separatorIndex === -1) {
      continue
    }

    const family = commandName.slice(0, separatorIndex)
    const entries = families.get(family) ?? []
    entries.push(commandName)
    families.set(family, entries)
  }

  return families
}

function selectAssistantCliSurfaceFamilies(
  families: ReadonlyMap<string, readonly string[]>,
): Array<[string, readonly string[]]> {
  const selected = new Set<string>()
  const ordered: Array<[string, readonly string[]]> = []

  for (const family of assistantCliSurfaceBootstrapForcedFamilies) {
    const entries = families.get(family)
    if (!entries) {
      continue
    }

    selected.add(family)
    ordered.push([family, entries])
  }

  const remaining = [...families.entries()]
    .filter(([family]) => !selected.has(family))
    .sort((left, right) => {
      const bySize = right[1].length - left[1].length
      return bySize !== 0 ? bySize : left[0].localeCompare(right[0])
    })

  for (const entry of remaining) {
    if (ordered.length >= assistantCliSurfaceBootstrapFamilyLimit) {
      break
    }

    ordered.push(entry)
  }

  return ordered
}

function summarizeAssistantCliSurfaceFamily(
  family: string,
  commandNames: readonly string[],
): string | null {
  const directCommands = new Set<string>()
  const nestedGroups = new Map<string, number>()

  for (const commandName of commandNames) {
    const parts = commandName.split(' ')
    if (parts.length === 2) {
      directCommands.add(parts[1]!)
      continue
    }

    if (parts.length > 2) {
      const subgroup = parts[1]!
      nestedGroups.set(subgroup, (nestedGroups.get(subgroup) ?? 0) + 1)
    }
  }

  const rankedEntries = [
    ...[...nestedGroups.entries()]
      .sort((left, right) => {
        const byCount = right[1] - left[1]
        return byCount !== 0 ? byCount : left[0].localeCompare(right[0])
      })
      .map(([entry]) => entry),
    ...[...directCommands].sort((left, right) => left.localeCompare(right)),
  ].slice(0, assistantCliSurfaceBootstrapFamilyEntryLimit)

  return rankedEntries.length > 0 ? `${family}: ${rankedEntries.join(', ')}.` : null
}
