import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as catalog from '../src/assistant-codex/dynamic-tool-catalog.js'
import { MURPH_CODEX_BASE_INSTRUCTIONS } from '../src/assistant/codex-base-instructions.js'
import { ASSISTANT_SKILLS, resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { collectCanonicalToolInventory } from './support/codex-tool-contract-inventory.js'
import { renderPromptRoutes } from './support/prompt-route-fixtures.js'

/**
 * Size ceilings for everything the model reads: the prompt layers per route,
 * every tool declaration, and every skill.
 *
 * Ceilings only. Shrinking never fails. Growing past a ceiling fails until the
 * table is regenerated on purpose and the new number is reviewed:
 *
 *   MURPH_UPDATE_INSTRUCTION_BUDGETS=1 pnpm --dir packages/assistant-engine \
 *     exec vitest run --config vitest.config.ts --no-coverage test/instruction-budgets.test.ts
 *
 * Regenerating sets each ceiling to the measured size plus 3%, rounded up to
 * the next 50 bytes, so a small edit passes and real growth does not. An item
 * that measures zero keeps a ceiling of zero.
 *
 * The table is test/support/instruction-budgets.json. Git history is its changelog.
 */
const BUDGETS_PATH = fileURLToPath(new URL('./support/instruction-budgets.json', import.meta.url))
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const HEADROOM = 1.03
const ceilingFor = (size: number) => Math.ceil((size * HEADROOM) / 50) * 50

function measure(): Record<string, Record<string, number>> {
  const prompt: Record<string, number> = { 'base-instructions': bytes(MURPH_CODEX_BASE_INSTRUCTIONS) }
  for (const [route, layers] of Object.entries(renderPromptRoutes())) {
    prompt[`${route} core`] = bytes(layers.staticCacheableCorePrompt)
    prompt[`${route} route`] = bytes(layers.stableRouteCapabilityPrompt)
    prompt[`${route} thread`] = bytes(layers.threadContextPrompt)
    prompt[`${route} total`] = bytes(layers.prompt)
  }

  // One entry per tool name; route variants of one name share the larger size.
  const toolDescriptions: Record<string, number> = {}
  const toolDeclarations: Record<string, number> = {}
  for (const tool of collectCanonicalToolInventory()) {
    const name = `${tool.namespace}.${tool.name}`
    toolDescriptions[name] = Math.max(toolDescriptions[name] ?? 0, bytes(tool.description))
    toolDeclarations[name] = Math.max(
      toolDeclarations[name] ?? 0,
      bytes(tool.description) + bytes(JSON.stringify(tool.inputSchema)),
    )
  }

  // The largest roster each kind of conversation can be handed.
  const toolRosters: Record<string, number> = {}
  for (const mode of ['direct', 'group'] as const) {
    const roster = catalog.resolveMurphDynamicTools(new Proxy({}, {
      get: (_target, key) => (key === 'progressUpdateMode' ? mode : true),
    }))
    toolRosters[`${mode} all capabilities`] = roster.reduce(
      (total, tool) => total + bytes(tool.description) + bytes(JSON.stringify(tool.inputSchema)),
      0,
    )
  }

  const skillsRoot = resolveAssistantSkillsRoot()
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    return statSync(file).isDirectory() ? walk(file) : [file]
  })
  const skillEntryFiles: Record<string, number> = {}
  const skillTrees: Record<string, number> = {}
  for (const skill of ASSISTANT_SKILLS) {
    const dir = path.join(skillsRoot, skill.slug)
    skillEntryFiles[skill.slug] = bytes(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
    skillTrees[skill.slug] = walk(dir)
      .filter((file) => file.endsWith('.md'))
      .reduce((total, file) => total + bytes(readFileSync(file, 'utf8')), 0)
  }

  const sorted = (table: Record<string, number>) =>
    Object.fromEntries(Object.entries(table).sort(([left], [right]) => left.localeCompare(right)))
  return {
    prompt: sorted(prompt),
    skillEntryFiles: sorted(skillEntryFiles),
    skillTrees: sorted(skillTrees),
    toolDeclarations: sorted(toolDeclarations),
    toolDescriptions: sorted(toolDescriptions),
    toolRosters: sorted(toolRosters),
  }
}

describe('instruction budgets', () => {
  const actual = measure()
  if (process.env.MURPH_UPDATE_INSTRUCTION_BUDGETS === '1') {
    const regenerated = Object.fromEntries(Object.entries(actual).map(([table, sizes]) => [
      table,
      Object.fromEntries(Object.entries(sizes).map(([name, size]) => [name, ceilingFor(size)])),
    ]))
    writeFileSync(BUDGETS_PATH, `${JSON.stringify(regenerated, null, 2)}\n`)
  }
  const ceilings = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8')) as Record<string, Record<string, number>>

  it.each(Object.keys(actual))('%s: every measured item has a ceiling and none is stale', (table) => {
    expect(Object.keys(ceilings[table] ?? {}).sort()).toEqual(Object.keys(actual[table]!).sort())
  })

  it.each(Object.keys(actual))('%s: nothing has grown past its ceiling', (table) => {
    const over = Object.entries(actual[table]!)
      .filter(([name, size]) => size > (ceilings[table]?.[name] ?? 0))
      .map(([name, size]) => `${name}: ${size} bytes, ceiling ${ceilings[table]?.[name]}`)
    expect(over).toEqual([])
  })
})
