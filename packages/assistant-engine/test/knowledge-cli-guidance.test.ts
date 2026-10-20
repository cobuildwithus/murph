import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { initializeVault } from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'
import { MURPH_MANAGED_AUTOMATIONS } from '../src/assistant/managed-automations.js'
import { MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS } from '../src/assistant/onboarding-first-personal-read-automation.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

const cliEntrypoint = fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url))
const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('knowledge CLI guidance matches the shipped CLI', () => {
  it('composes the real upsert shape only on the CLI route', () => {
    const cliRoute = buildKnowledgePrompt({ assistantKnowledgeToolsAvailable: false })
    expect(parseUpsertShape(cliRoute)).toEqual({
      command: ['knowledge', 'upsert', '--slug', '<slug>', '--body', '<markdown>'],
      libraryFlag: '--library-slug',
      sourceFlag: '--source-path',
    })
    expect(cliRoute).not.toContain('dedicated knowledge write surface')
    expect(cliRoute).not.toContain('attach `librarySlugs`')

    const dedicatedRoute = buildKnowledgePrompt({ assistantKnowledgeToolsAvailable: true })
    expect(dedicatedRoute).toContain('Persist pages through the dedicated knowledge write surface for this route')
    expect(dedicatedRoute).not.toContain('vault-cli knowledge upsert')

    expect(buildKnowledgePrompt({ conversationScope: 'group' })).not.toContain('knowledge upsert')
  })

  it('writes once with the composed upsert shape and rejects unsupported plural flags without writing', async () => {
    const vault = await createVault()
    await writeVaultFile(vault, 'bank/library/synthetic-route-reference.md', [
      '---', 'title: Synthetic route reference', 'slug: synthetic-route-reference', 'entityType: biomarker', '---', '',
      '# Synthetic route reference', '', 'Reference page.', '',
    ].join('\n'))
    await writeVaultFile(vault, 'research/synthetic-route-note.md', '# Synthetic route note\n')
    const shape = parseUpsertShape(buildKnowledgePrompt({ assistantKnowledgeToolsAvailable: false }))
    const argv = [
      ...shape.command.map((token) => token === '<slug>'
        ? 'synthetic-route-choice'
        : token === '<markdown>' ? '# Synthetic route choice\n\nThe flat path avoids the steep hill.' : token),
      shape.libraryFlag, 'synthetic-route-reference',
      shape.sourceFlag, 'research/synthetic-route-note.md',
    ]

    for (const [singular, plural] of [[shape.libraryFlag, '--library-slugs'], [shape.sourceFlag, '--source-paths']]) {
      const rejected = await runCli(vault, argv.map((token) => token === singular ? plural : token))
      expect(rejected.exitCode).toBe(1)
      expect(rejected.json).toMatchObject({
        code: 'VALIDATION_ERROR',
        fieldErrors: [{ path: 'arguments', missing: false }],
        stage: 'validation',
      })
    }
    expect(await listDerivedFiles(vault)).toEqual([])

    const saved = await runCli(vault, argv)
    expect(saved).toMatchObject({
      exitCode: 0,
      json: {
        page: {
          librarySlugs: ['synthetic-route-reference'],
          slug: 'synthetic-route-choice',
          sourcePaths: ['research/synthetic-route-note.md'],
        },
      },
    })
    expect(await listDerivedFiles(vault)).toEqual([
      'derived/knowledge/index.md',
      'derived/knowledge/log.md',
      'derived/knowledge/pages/synthetic-route-choice.md',
    ])
    const log = await runCli(vault, ['knowledge', 'log', 'tail', '--limit', '10'])
    expect(log.json).toMatchObject({ count: 1, entries: [{ action: 'upsert' }] })
  })

  it('reads every production optional ledger once as absent without failing or writing', async () => {
    const reads = await collectProductionKnowledgeShows()
    expect(reads.filter((read) => !read.optional)).toEqual([])
    expect([...new Set(reads.map((read) => read.slug))].sort()).toEqual([
      'improvement-opportunities',
      'journal-connected-context',
      'weekly-health-insights',
      'weekly-health-research-scout',
    ])
    // Absence stays a quiet prior-state signal; it never authorizes a write or a guess.
    expect(MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS).toContain(
      'Treat `page: null` as no prior personal insights, but return skip if the read fails.',
    )
    // An unconfirmed or rejected optional read never becomes "no prior history".
    const optionalReaders = MURPH_MANAGED_AUTOMATIONS
      .filter((automation) => automation.instructions.includes('--if-exists'))
    expect(optionalReaders.map((automation) => automation.slug).sort()).toEqual([
      'monthly-improvement-coach',
      'weekly-health-insight',
      'weekly-health-research-scout',
    ])
    for (const automation of optionalReaders) {
      expect(automation.instructions).toMatch(/read fails(?: instead)?, return skip/u)
    }
    // An unreadable or unconfirmed ledger must never look like "no opt-out".
    expect((await readFile(new URL('../skills/journal-connected-context/SKILL.md', import.meta.url), 'utf8'))
      .replace(/\s+/gu, ' ')).toContain(
      '`page: null` means no ledger exists yet. A failed read is not a missing ledger: treat it as a global opt-out for this run and do not rewrite the ledger.',
    )

    const vault = await createVault()
    for (const slug of new Set(reads.map((read) => read.slug))) {
      const optional = await runCli(vault, ['knowledge', 'show', slug, '--if-exists'])
      expect(optional).toEqual({ exitCode: 0, json: { degradation: null, page: null, slug, vault } })
      const strict = await runCli(vault, ['knowledge', 'show', slug])
      expect(strict.exitCode).toBe(1)
      expect(strict.json).toMatchObject({ code: 'knowledge_page_not_found', retryable: false, stage: 'read' })
    }
    expect(await listDerivedFiles(vault)).toEqual([])
  })
})

function buildKnowledgePrompt(input: {
  assistantKnowledgeToolsAvailable?: boolean
  conversationScope?: 'direct' | 'group'
}): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null, assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false, assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: input.assistantKnowledgeToolsAvailable ?? false, channel: 'linq',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    conversationScope: input.conversationScope ?? 'direct', currentLocalDate: '2026-10-16', currentTimeZone: 'UTC',
    hostedRuntime: true, modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false, ordinaryInboundTurn: true,
  })
}

function parseUpsertShape(prompt: string): { command: string[]; libraryFlag: string; sourceFlag: string } {
  const command = /`vault-cli (knowledge upsert [^`]+)`/u.exec(prompt)?.[1]
  const libraryFlag = /`(--library-slug) <slug>`/u.exec(prompt)?.[1]
  const sourceFlag = /`(--source-path) <path>`/u.exec(prompt)?.[1]
  if (!command || !libraryFlag || !sourceFlag) throw new Error('Expected the composed knowledge upsert shape.')
  return { command: command.split(' '), libraryFlag, sourceFlag }
}

async function collectProductionKnowledgeShows(): Promise<Array<{ optional: boolean; slug: string }>> {
  const sources = [
    ...MURPH_MANAGED_AUTOMATIONS.map((automation) => automation.instructions),
    MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS,
    await readFile(new URL('../skills/journal-connected-context/SKILL.md', import.meta.url), 'utf8'),
  ]
  return sources.flatMap((source) => [...source.replace(/\s+/gu, ' ')
    .matchAll(/vault-cli knowledge show ([a-z0-9-]+)( --if-exists)?/gu)]
    .map((match) => ({ optional: match[2] !== undefined, slug: match[1] ?? '' })))
}

async function createVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-cli-guidance-'))
  cleanupPaths.push(vault)
  await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
  return vault
}

async function writeVaultFile(vault: string, relativePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(vault, relativePath)), { recursive: true })
  await writeFile(path.join(vault, relativePath), content, 'utf8')
}

async function listDerivedFiles(vault: string): Promise<string[]> {
  const root = path.join(vault, 'derived/knowledge')
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile())
    .map((entry) => path.relative(vault, path.join(entry.parentPath, entry.name)))
    .sort()
}

async function runCli(vault: string, argv: string[]): Promise<{ exitCode: number; json: unknown }> {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [cliEntrypoint, ...argv, '--vault', vault, '--format', 'json'])
    return { exitCode: 0, json: JSON.parse(stdout) }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string }
    return { exitCode: failure.code ?? -1, json: JSON.parse(failure.stdout ?? 'null') }
  }
}
