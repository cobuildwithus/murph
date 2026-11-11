import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MURPH_CODEX_BASE_INSTRUCTIONS } from '../src/assistant/codex-base-instructions.js'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.js'
import { ASSISTANT_SKILLS, resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { collectCanonicalToolInventory } from './support/codex-tool-contract-inventory.js'
import { renderPromptRoutes, sweepPromptInputs } from './support/prompt-route-fixtures.js'

/**
 * Every command, flag, tool, tool action, skill path and link that the prompt,
 * a skill or a tool description names must exist.
 *
 * Nothing here quotes instruction wording. A reworded sentence passes as long
 * as the things it names are real; a sentence that names a command, flag, tool
 * or file that does not exist fails, whoever wrote it.
 */
type Source = { where: string; text: string }

const skillsRoot = resolveAssistantSkillsRoot()
const cliRegistryPath = fileURLToPath(new URL('../../cli/src/incur.generated.ts', import.meta.url))
const skillReferenceMapPath = fileURLToPath(new URL('./support/skill-reference-map.json', import.meta.url))

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) walk(file, acc)
    else acc.push(file)
  }
  return acc
}

const skillFiles = walk(skillsRoot).filter((file) => file.endsWith('.md'))
const skillSources: Source[] = skillFiles.map((file) => ({
  where: `skills/${path.relative(skillsRoot, file)}`,
  text: readFileSync(file, 'utf8'),
}))

function promptSources(): Source[] {
  const blocks = new Map<string, Set<string>>()
  const add = (layers: ReturnType<typeof buildAssistantSystemPromptLayers>) => {
    for (const block of layers.blocks) {
      if (!blocks.has(block.id)) blocks.set(block.id, new Set())
      blocks.get(block.id)!.add(block.text)
    }
  }
  Object.values(renderPromptRoutes()).forEach(add)
  for (const input of sweepPromptInputs()) add(buildAssistantSystemPromptLayers(input))
  return [...blocks].flatMap(([id, texts]) =>
    [...texts].map((text) => ({ where: `prompt block ${id}`, text })))
}

const tools = collectCanonicalToolInventory()
const toolSources: Source[] = tools.map((tool) => ({
  where: `tool ${tool.namespace}.${tool.name}`,
  text: `${tool.description}\n${JSON.stringify(tool.inputSchema)}`,
}))

const allSources: Source[] = [
  { where: 'base instructions', text: MURPH_CODEX_BASE_INSTRUCTIONS },
  ...promptSources(),
  ...toolSources,
  ...skillSources,
]

// ---- vault-cli commands and flags -----------------------------------------

function readCliRegistry(): Map<string, Set<string>> {
  const commands = new Map<string, Set<string>>()
  const source = readFileSync(cliRegistryPath, 'utf8')
  for (const match of source.matchAll(/^\s+'([a-z][a-z0-9 -]*)': \{ args: \{(.*?)\}; options: \{(.*)\} \}\s*$/gmu)) {
    const options = new Set<string>()
    let depth = 0
    let current = ''
    const parts: string[] = []
    for (const char of match[3]!) {
      if ('{(['.includes(char)) depth += 1
      if ('})]'.includes(char)) depth -= 1
      if (char === ';' && depth === 0) {
        parts.push(current)
        current = ''
      } else {
        current += char
      }
    }
    parts.push(current)
    for (const part of parts) {
      const key = /^([A-Za-z0-9_]+)\??:/u.exec(part.trim())?.[1]
      if (key) options.add(key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`))
    }
    commands.set(match[1]!, options)
  }
  return commands
}

const cliCommands = readCliRegistry()
const cliGroups = new Set<string>()
for (const command of cliCommands.keys()) {
  const words = command.split(' ')
  for (let size = 1; size <= words.length; size += 1) cliGroups.add(words.slice(0, size).join(' '))
}
// Flags every command accepts from the CLI framework.
const GLOBAL_CLI_FLAGS = new Set([
  'format', 'schema', 'help', 'vault', 'llms', 'llms-full', 'verbose', 'token-count',
  'token-limit', 'token-offset', 'filter-output', 'json', 'version', 'mcp', 'compact',
])
// Commands that instructions name only to say they must not be used. Both are
// gone from the CLI; the private group skills still prohibit them by name.
// Delete these entries when that prose is rewritten.
const DEAD_COMMAND_PROHIBITIONS = new Set(['group shared', 'group weekly'])

function findCliProblems(source: Source): string[] {
  const problems: string[] = []
  const pattern = /vault-cli((?:[ \t]+(?:--?[a-z][a-z0-9-]*(?:=\S+)?|<[^>\n]+>|\[[^\]\n]+\]|"[^"\n]*"|'[^'\n]*'|[A-Za-z0-9_.:/@=,+-]+)){1,40})/gu
  for (const match of source.text.matchAll(pattern)) {
    const tokens = match[1]!.trim().split(/[ \t]+/u)
    const words: string[] = []
    for (const token of tokens) {
      if (/^[a-z][a-z0-9-]*$/u.test(token)) words.push(token)
      else break
    }
    if (words.length === 0) continue
    let command: string | null = null
    for (let size = Math.min(words.length, 4); size >= 1; size -= 1) {
      const candidate = words.slice(0, size).join(' ')
      if (cliCommands.has(candidate)) {
        command = candidate
        break
      }
    }
    if (!command) {
      const known = [3, 2, 1].some((size) => cliGroups.has(words.slice(0, size).join(' ')))
      const named = words.slice(0, 2).join(' ')
      if (!known && !DEAD_COMMAND_PROHIBITIONS.has(named)) {
        problems.push(`${source.where}: unknown command \`vault-cli ${named}\``)
      }
      continue
    }
    // Flags belong to this command only until the prose resumes: stop at the
    // first bare word that is neither a flag nor the value of the flag before it.
    const options = cliCommands.get(command)!
    let previousWasFlag = false
    for (const token of tokens.slice(command.split(' ').length)) {
      const flag = /^--([a-z][a-z0-9-]*)/u.exec(token)?.[1]
      if (flag) {
        const name = flag.replace(/^no-/u, '')
        if (!options.has(name) && !GLOBAL_CLI_FLAGS.has(name)) {
          problems.push(`${source.where}: \`vault-cli ${command}\` has no flag --${flag}`)
        }
        previousWasFlag = !token.includes('=')
        continue
      }
      const placeholder = /^[<["']/u.test(token)
      if (!previousWasFlag && !placeholder) break
      previousWasFlag = false
    }
  }
  return problems
}

// ---- murph.* tools and their actions --------------------------------------

const toolNames = new Set(tools.filter((tool) => tool.namespace === 'murph').map((tool) => tool.name))

function collectActionValues(schema: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) collectActionValues(item, acc)
  } else if (schema && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'action' && value && typeof value === 'object') {
        const action = value as { const?: unknown; enum?: unknown }
        if (typeof action.const === 'string') acc.add(action.const)
        if (Array.isArray(action.enum)) for (const item of action.enum) if (typeof item === 'string') acc.add(item)
      }
      collectActionValues(value, acc)
    }
  }
  return acc
}

const toolActions = new Map<string, Set<string>>()
for (const tool of tools) {
  if (tool.namespace !== 'murph') continue
  const actions = collectActionValues(tool.inputSchema)
  if (!toolActions.has(tool.name)) toolActions.set(tool.name, new Set())
  for (const action of actions) toolActions.get(tool.name)!.add(action)
}

function findToolProblems(source: Source): string[] {
  const problems: string[] = []
  for (const match of source.text.matchAll(/(?<![\w./-])murph\.([a-z][a-z0-9_]*)(\*?)(?![\w])(?:`?[ \t]+action="([a-z_]+)")?/gu)) {
    const [, name, wildcard, action] = match
    if (wildcard) {
      if (![...toolNames].some((tool) => tool.startsWith(name!))) {
        problems.push(`${source.where}: no tool starts with murph.${name}`)
      }
      continue
    }
    if (!toolNames.has(name!)) {
      // `murph.computer_*` is written without the star in some places.
      if (name!.endsWith('_') && [...toolNames].some((tool) => tool.startsWith(name!))) continue
      problems.push(`${source.where}: unknown tool murph.${name}`)
      continue
    }
    const actions = toolActions.get(name!)
    if (action && actions && actions.size > 0 && !actions.has(action)) {
      problems.push(`${source.where}: murph.${name} has no action "${action}"`)
    }
  }
  return problems
}

// ---- skill paths and links -------------------------------------------------

const registeredSlugs = new Set<string>(ASSISTANT_SKILLS.map((skill) => skill.slug))
// Skill directories that are reached only through a tool description and are
// deliberately absent from the skill registry and router.
const TOOL_OWNED_SKILL_DIRECTORIES = ['physical-notes']
// Reference files that no file in their own skill names today, so the model is
// never routed to them. Each entry is a finding for the skill rewrite: name the
// file from its skill or delete it, then remove the entry.
const KNOWN_ORPHAN_REFERENCE_FILES = [
  'physical-therapy/references/evidence-register.md',
  'physical-therapy/references/exercise-catalog-contract.md',
  'physical-therapy/templates/response-templates.md',
]

function findSkillPathProblems(source: Source): string[] {
  const problems: string[] = []
  for (const match of source.text.matchAll(/MURPH_ASSISTANT_SKILLS_ROOT"?\/([a-z0-9-]+)\/([A-Za-z0-9_./-]+\.md)/gu)) {
    if (!existsSync(path.join(skillsRoot, match[1]!, match[2]!))) {
      problems.push(`${source.where}: missing skill file ${match[1]}/${match[2]}`)
    }
  }
  return problems
}

function findSkillLinkProblems(file: string): string[] {
  const problems: string[] = []
  const text = readFileSync(file, 'utf8')
  const where = `skills/${path.relative(skillsRoot, file)}`
  for (const match of text.matchAll(/\]\(((?:references|assets|scripts|\.\.?)\/[^)#\s]+)\)/gu)) {
    if (!existsSync(path.resolve(path.dirname(file), match[1]!))) {
      problems.push(`${where}: broken link ${match[1]}`)
    }
  }
  const skillDir = path.join(skillsRoot, path.relative(skillsRoot, file).split(path.sep)[0]!)
  for (const match of text.matchAll(/`(references\/[A-Za-z0-9_./-]+\.md)`/gu)) {
    if (!existsSync(path.join(skillDir, match[1]!))) {
      problems.push(`${where}: names missing file ${match[1]}`)
    }
  }
  return problems
}

describe('instruction reference integrity', () => {
  it('reads a real command registry, tool inventory and skill tree', () => {
    expect(cliCommands.size).toBeGreaterThan(200)
    expect(cliCommands.has('meal add')).toBe(true)
    expect(toolNames.size).toBeGreaterThan(40)
    expect(skillFiles.length).toBeGreaterThan(ASSISTANT_SKILLS.length)
    // The extractors must actually find references, or the checks below pass on nothing.
    const count = (pattern: RegExp) =>
      allSources.reduce((total, source) => total + [...source.text.matchAll(pattern)].length, 0)
    expect(count(/vault-cli [a-z]/gu)).toBeGreaterThan(100)
    expect(count(/(?<![\w./-])murph\.[a-z]/gu)).toBeGreaterThan(100)
    expect(count(/MURPH_ASSISTANT_SKILLS_ROOT"?\/[a-z0-9-]+\//gu)).toBeGreaterThan(50)
  })

  it('catches an unknown command, flag, tool, action and skill file', () => {
    const where = 'probe'
    expect(findCliProblems({ where, text: 'Run `vault-cli meal nonexistent-subcommand`.' })).toEqual([])
    expect(findCliProblems({ where, text: 'Run `vault-cli nonexistent-group thing`.' })).toHaveLength(1)
    expect(findCliProblems({ where, text: 'Run `vault-cli meal add --no-such-flag x`.' })).toHaveLength(1)
    expect(findCliProblems({ where, text: 'Run `vault-cli meal add` and then pass --no-such-flag elsewhere.' })).toEqual([])
    expect(findToolProblems({ where, text: 'Call `murph.no_such_tool`.' })).toHaveLength(1)
    expect(findToolProblems({ where, text: 'Call `murph.group_data action="no_such_action"`.' })).toHaveLength(1)
    expect(findSkillPathProblems({ where, text: '$MURPH_ASSISTANT_SKILLS_ROOT/no-such-skill/SKILL.md' })).toHaveLength(1)
  })

  it('names only vault-cli commands and flags that exist', () => {
    expect(allSources.flatMap(findCliProblems)).toEqual([])
  })

  it('names only murph tools and tool actions that exist', () => {
    expect(allSources.flatMap(findToolProblems)).toEqual([])
  })

  it('points only at skill files that exist', () => {
    expect(allSources.flatMap(findSkillPathProblems)).toEqual([])
    expect(skillFiles.flatMap(findSkillLinkProblems)).toEqual([])
  })

  it('registers every skill directory and ships every registered skill', () => {
    const onDisk = readdirSync(skillsRoot)
      .filter((name) => existsSync(path.join(skillsRoot, name, 'SKILL.md')))
      .sort()
    expect(onDisk).toEqual([...registeredSlugs, ...TOOL_OWNED_SKILL_DIRECTORIES].sort())
  })

  it('leaves no reference file that its own skill never names', () => {
    const orphans: string[] = []
    for (const slug of registeredSlugs) {
      const dir = path.join(skillsRoot, slug)
      const files = walk(dir).filter((file) => file.endsWith('.md'))
      const texts = files.map((file) => readFileSync(file, 'utf8')).join('\n')
      for (const file of files) {
        const relative = path.relative(dir, file)
        if (relative === 'SKILL.md') continue
        if (!texts.includes(relative) && !texts.includes(path.basename(file))) orphans.push(`${slug}/${relative}`)
      }
    }
    expect(orphans).toEqual(KNOWN_ORPHAN_REFERENCE_FILES)
  })

  it('keeps each skill naming the same tools and sibling skills', () => {
    // A map of identifiers, not wording: which murph tools and which other
    // skills each skill names. When a rewrite drops or adds one on purpose,
    // regenerate with MURPH_UPDATE_SKILL_REFERENCE_MAP=1 and review the diff.
    const actual: Record<string, { skills: string[]; tools: string[] }> = {}
    for (const slug of [...registeredSlugs].sort()) {
      const dir = path.join(skillsRoot, slug)
      const text = walk(dir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n')
      const named = new Set<string>()
      for (const match of text.matchAll(/(?<![\w./-])murph\.([a-z][a-z0-9_]*[a-z0-9])/gu)) {
        if (toolNames.has(match[1]!)) named.add(`murph.${match[1]}`)
      }
      const siblings = new Set<string>()
      // A hyphenated slug is unambiguous anywhere; a one-word slug (journal,
      // pdf, reminders) counts only in backticks or in a skill path.
      for (const match of text.matchAll(/`([a-z0-9]+)`|SKILLS_ROOT"?\/([a-z0-9-]+)\/|(?<![\w/-])([a-z0-9]+(?:-[a-z0-9]+)+)(?![\w-])/gu)) {
        const other = match[1] ?? match[2] ?? match[3]!
        if (other !== slug && registeredSlugs.has(other)) siblings.add(other)
      }
      actual[slug] = { skills: [...siblings].sort(), tools: [...named].sort() }
    }
    if (process.env.MURPH_UPDATE_SKILL_REFERENCE_MAP === '1') {
      writeFileSync(skillReferenceMapPath, `${JSON.stringify(actual, null, 2)}\n`)
    }
    expect(actual).toEqual(JSON.parse(readFileSync(skillReferenceMapPath, 'utf8')))
  })
})
