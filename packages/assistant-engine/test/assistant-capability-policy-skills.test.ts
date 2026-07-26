import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { hostedPhoneCallStartResponseSchema } from '@murphai/hosted-execution'
import { describe, expect, it } from 'vitest'

import {
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  MURPH_CONNECTED_APPS_DYNAMIC_TOOLS,
} from '../src/assistant-codex/dynamic-tools/connected-apps.js'
import {
  MURPH_CREATE_PHONE_CALL_TOOL,
} from '../src/assistant-codex/dynamic-tools/phone-calls.js'
import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
  type AssistantSkillSlug,
} from '../src/assistant-skill-assets.js'

const CAPABILITY_SKILL_SLUGS = [
  'connected-apps',
  'computer-use',
  'phone-calls',
  'murph-family',
] as const satisfies readonly AssistantSkillSlug[]

describe('assistant capability policy skills', () => {
  it('registers every capability owner with a stable symbolic file reference', () => {
    const registered = new Set(ASSISTANT_SKILLS.map((skill) => skill.slug))

    for (const slug of CAPABILITY_SKILL_SLUGS) {
      expect(registered.has(slug)).toBe(true)
      expect(buildAssistantSkillFileRef(slug)).toBe(
        `$MURPH_ASSISTANT_SKILLS_ROOT/${slug}/SKILL.md`,
      )
    }
  })

  it('keeps phone consent, disclosure, transfer, and result semantics together', async () => {
    const skill = await readSkill('phone-calls')
    const normalized = normalizeWhitespace(skill)

    expect(normalized).toContain(
      'Place a call only when the user asked for it or clearly approved this specific call.',
    )
    expect(normalized).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md',
    )
    expect(normalized).toContain('satisfy its ready-to-act gate')
    expect(normalized).toContain('Set `callerName`')
    expect(normalized).toContain('only user-approved, call-relevant, disclosable facts')
    expect(normalized).toContain('Never include unrelated health details')
    expect(normalized).toContain('Set `allowTransferToUser: true`')
    expect(normalized).toContain('Set it to `false` for information-only calls')
    expect(normalized).toContain('Never call emergency services')

    for (const status of ['starting', 'calling', 'failed'] as const) {
      expect(skill).toContain(`\`${status}\``)
      expect(hostedPhoneCallStartResponseSchema.safeParse({
        phoneCallId: 'phone-call-test',
        status,
      }).success).toBe(true)
    }
    expect(normalized).toContain(
      'Await the later call result before claiming connection, an answer, a booking, an agreement, or any other outcome.',
    )
  })

  it('keeps Family product routing separate from family health context', async () => {
    const skill = await readSkill('murph-family')
    const normalized = normalizeWhitespace(skill)

    expect(normalized).toContain('2–6 sponsored Pulse ($7/month) or Edge ($19/month) seats')
    expect(normalized).toContain('owners cannot see member conversations or health data')
    expect(normalized).toContain('`action: "read_status"`')
    expect(normalized).toContain('`action: "start_checkout"`')
    expect(normalized).toContain('`action: "create_invite"`')
    expect(normalized).toContain('`preparedInvite`')
    expect(normalized).toContain('`already_sponsored`')
    expect(normalized).toContain('`owner: true`')
    expect(normalized).toContain('`billingActive: true`')
    expect(normalized).toContain('matches exactly one member row')
    expect(normalized).toContain(
      'A hosted group cannot own a Family plan, begin checkout, inspect account status, or create invites.',
    )
    expect(normalized).toContain(
      'Never treat ordinary family medical history, symptoms, genetics, household health context, or caregiving as Family account management.',
    )
  })

  it('makes each capability tool route to its policy owner', () => {
    for (const tool of MURPH_CONNECTED_APPS_DYNAMIC_TOOLS) {
      expect(tool.description).toContain(
        '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
      )
    }
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md',
    )
    expect(MURPH_FAMILY_PLAN_TOOL.description).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/murph-family/SKILL.md',
    )
    expect(MURPH_COMPUTER_OPEN_TOOL.description).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/computer-use/SKILL.md',
    )
  })
})

async function readSkill(slug: AssistantSkillSlug): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}
