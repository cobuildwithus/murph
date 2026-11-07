import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_REF,
  resolveAssistantSkillsRoot,
  withAssistantSkillsRootEnv,
} from '../src/assistant-skill-assets.js'

type AssistantSkillMetadata = {
  readonly description: string
  readonly name: string
}

function parseAssistantSkillFrontmatter(raw: string): AssistantSkillMetadata {
  const normalized = raw.replace(/\r\n/gu, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new Error('SKILL.md must start with YAML frontmatter')
  }

  const frontmatterEnd = normalized.indexOf('\n---\n', 4)
  if (frontmatterEnd === -1) {
    throw new Error('SKILL.md must close YAML frontmatter')
  }

  const values = new Map<string, string>()
  let blockKey: string | null = null
  let blockStyle: 'folded' | 'literal' | null = null

  for (const line of normalized.slice(4, frontmatterEnd).split('\n')) {
    if (line.length === 0) {
      continue
    }

    if (/^\s/u.test(line)) {
      if (!blockKey || !blockStyle) {
        throw new Error(`Unexpected indented SKILL.md frontmatter line: ${line}`)
      }
      const current = values.get(blockKey) ?? ''
      const text = line.trim()
      values.set(
        blockKey,
        blockStyle === 'folded'
          ? [current, text].filter(Boolean).join(' ')
          : [current, text].filter(Boolean).join('\n'),
      )
      continue
    }

    blockKey = null
    blockStyle = null
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line)
    if (!match) {
      throw new Error(`Invalid SKILL.md frontmatter line: ${line}`)
    }

    const key = match[1]
    const value = match[2] ?? ''
    if (!key) {
      throw new Error(`Invalid SKILL.md frontmatter key: ${line}`)
    }

    if (/^[>|][+-]?$/u.test(value)) {
      blockKey = key
      blockStyle = value.startsWith('>') ? 'folded' : 'literal'
      values.set(key, '')
      continue
    }

    const trimmedValue = value.trim()
    const quoted =
      trimmedValue.startsWith('"') || trimmedValue.startsWith("'")
    if (!quoted && /:\s/u.test(trimmedValue)) {
      throw new Error(
        `Plain SKILL.md frontmatter scalar for ${key} contains ': '; use a quoted or folded scalar`,
      )
    }
    values.set(key, trimmedValue)
  }

  const name = values.get('name')?.trim()
  const description = values.get('description')?.trim()
  if (!name || !description) {
    throw new Error('SKILL.md frontmatter must include name and description')
  }

  return { description, name }
}

describe('assistant skill assets', () => {
  async function readSkillFile(skill: (typeof ASSISTANT_SKILLS)[number]) {
    return readFile(path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'), 'utf8')
  }
  it('has a valid SKILL.md for every registered assistant skill', async () => {
    for (const skill of ASSISTANT_SKILLS) {
      const raw = await readSkillFile(skill)
      const metadata = parseAssistantSkillFrontmatter(raw)

      expect(metadata.name).toBe(skill.name)
      expect(metadata.description.length).toBeGreaterThan(0)
      expect(raw.length).toBeGreaterThan(0)
    }
  })

  it('uses unique safe skill slugs and names', () => {
    const slugs = new Set<string>()
    const names = new Set<string>()

    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(slugs.has(skill.slug)).toBe(false)
      expect(names.has(skill.name)).toBe(false)

      slugs.add(skill.slug)
      names.add(skill.name)
    }
  })

  it('builds stable symbolic skill file references', () => {
    expect(MURPH_ASSISTANT_SKILLS_ROOT_REF).toBe('$MURPH_ASSISTANT_SKILLS_ROOT')
    expect(buildAssistantSkillFileRef('murph-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('experiment-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('behavior-followthrough')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/behavior-followthrough/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('competition-training')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/competition-training/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('strength-training')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/strength-training/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('running-cardio')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/running-cardio/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('stress-regulation')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/stress-regulation/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('appointment-scheduling')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('computer-use')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/computer-use/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('connected-apps')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('phone-calls')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('murph-family')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/murph-family/SKILL.md',
    )
  })

  it('honors an explicit MURPH_ASSISTANT_SKILLS_ROOT process env override', () => {
    const original = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
    try {
      process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = '/opt/bundled/skills'
      expect(resolveAssistantSkillsRoot()).toBe('/opt/bundled/skills')

      // Blank overrides fall back to the module-relative package root.
      process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = '   '
      expect(resolveAssistantSkillsRoot()).toMatch(/assistant-engine/)
    } finally {
      if (original === undefined) {
        delete process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
      } else {
        process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = original
      }
    }
  })

  it('uses the canonical package skill root in process env', () => {
    const fallback = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: '   ',
    })
    expect(fallback[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(
      resolveAssistantSkillsRoot(),
    )

    const explicitRoot = path.join('custom', 'assistant-skills')
    const canonical = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: explicitRoot,
    })
    expect(canonical[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(
      resolveAssistantSkillsRoot(),
    )
  })

  it('keeps route hints and SKILL.md descriptions under parser limits', async () => {
    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.triggerHint.length).toBeLessThan(1024)

      const raw = await readSkillFile(skill)
      const frontmatter = raw.match(/^---\n(?<body>[\s\S]*?)\n---/u)
      expect(frontmatter?.groups?.body).toBeTruthy()

      const description = frontmatter?.groups?.body.match(
        /^description:\s*(?<description>.+)$/mu,
      )?.groups?.description

      expect(description).toBeTruthy()
      expect(description?.length).toBeLessThan(1024)
    }
  })
})
