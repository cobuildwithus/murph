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

  it('keeps group logistics, consent, disclosure, transfer, and result semantics together', async () => {
    const skill = await readSkill('phone-calls')
    const normalized = normalizeWhitespace(skill)
    const registration = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'phone-calls',
    )

    expect(registration?.triggerHint).toContain(
      'hosted group Murph may call a public venue or service business',
    )
    expect(registration?.triggerHint).toContain(
      'ordinary shared-life logistics task',
    )
    expect(normalized).toContain(
      'Private and hosted-group calls use the same consent and readiness flow.',
    )
    expect(normalized).toContain(
      'Never emit a special structured preview, or require a second turn, merely because the request came from a group.',
    )
    expect(normalized).toContain(
      'the current bounded request may authorize the call in the same provider turn',
    )
    expect(normalized).toContain(
      "Set `message_ref` to that request's visible `ain_...` reference.",
    )
    expect(normalized).toContain(
      'It must still be the newest accepted request when the call starts.',
    )
    expect(normalized).toContain(
      "The host reloads that exact message and revalidates the provider sender's current room membership and Murph activation.",
    )
    expect(normalized).toContain(
      'The current requester must explicitly supply or approve any requester name or contact fact used in the call.',
    )
    expect(normalized).toContain(
      "One participant's request never authorizes a different participant's identity, account, contact details, health facts, or other private facts.",
    )
    expect(normalized).toContain(
      'For a hosted-group reservation, availability check, or service call',
    )
    expect(normalized).toContain(
      'do not load `appointment-scheduling` unless health care is involved',
    )
    expect(normalized).toContain('party size or resource count')
    expect(normalized).toContain(
      'charge, commitment, materially different booking, or failed reservation',
    )
    expect(normalized).toContain(
      'Do not make a purchase, payment, reservation, or other commitment unless the requester explicitly asked for it and supplied adequate bounds.',
    )
    expect(normalized).toContain(
      "This skill never expands the conversation's scope boundary or authorizes code production or work, school, or professional operations.",
    )
    expect(normalized).toContain('room-visible logistical facts may be used')
    expect(normalized).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md',
    )
    expect(normalized).toContain('satisfy its ready-to-act gate')
    expect(normalized).toContain('Set `callerName`')
    expect(normalized).toContain('call-relevant, disclosable facts approved by the requester')
    expect(normalized).toContain(
      'A requester name or contact fact may be disclosed only when the destination requires it and the current request explicitly supplies or approves it',
    )
    expect(normalized).toContain(
      "never infer or disclose another participant's private identity, account, contact, or health facts",
    )
    expect(normalized).toContain('Never include unrelated health details')
    expect(normalized).toContain('Set `allowTransferToUser: true`')
    expect(normalized).toContain('Set it to `false` for information-only calls')
    expect(normalized).toContain('Never call emergency services')
    expect(normalized).not.toContain(['GROUP', 'CALL', 'PREVIEW'].join(' '))
    expect(normalized).not.toContain('Render exactly these ten lines')

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

    // A general "Family Edge versus Max" question must be answerable from the
    // loaded skill without an account-status tool call.
    const generalFamilyComparisonFacts = [
      '$15.20 on Edge',
      '$39.20 on Max',
      'Edge and Max share the same premium runtime/model access',
      'Max adds included usage, not a separate model capability',
    ]

    expect(normalized).toContain(
      '2–6 sponsored Pulse ($7/month), Edge ($19/month), or Max ($49/month) seats',
    )
    for (const fact of generalFamilyComparisonFacts) {
      expect(normalized).toContain(fact)
    }
    expect(normalized).toContain('`planCode: "max"` for Max')
    expect(normalized).toContain('owners cannot see member conversations or health data')
    expect(normalized).toContain('`action: "read_status"`')
    expect(normalized).toContain('`action: "start_checkout"`')
    expect(normalized).toContain('`action: "create_invite"`')
    expect(normalized).toContain('before every Family invitation')
    expect(normalized).toContain(
      'Never pass invite context to `start_checkout`; checkout cannot create or prepare an invite.',
    )
    expect(normalized).toContain(
      'If `read_status` cannot be read, say no change was attempted and that retrying the status read is safe.',
    )
    expect(normalized).toContain(
      'Only call `action: "create_invite"` when the status proves all three conditions:',
    )
    expect(normalized).toContain('`plans.<requested plan>.remaining` is greater than zero')
    expect(normalized).toContain(
      'When the requested plan has no remaining paid seat, do not call `create_invite`',
    )
    expect(normalized).toContain('https://www.withmurph.ai/settings#family')
    expect(normalized).toContain(
      'The link is navigation only; never claim that opening it purchased a seat or created an invite.',
    )
    expect(normalized).toContain(
      'say the request was not confirmed and ask the owner to check Family Settings before retrying',
    )
    expect(normalized).not.toContain('`preparedInvite`')
    expect(normalized).toContain('`already_sponsored`')
    expect(normalized).toContain('`owner: true`')
    expect(normalized).toContain('`billingActive: true`')
    expect(normalized).toContain('matches exactly one member row')
    expect(normalized).toContain(
      'When that exact row has `isOwner: true`, send `https://www.withmurph.ai/settings?addUsage=family#family`',
    )
    expect(normalized).toContain(
      'For another active member, send `https://www.withmurph.ai/settings#family`',
    )
    expect(normalized).toContain(
      'Never place member or Family identifiers into a model-composed URL.',
    )
    expect(skill).not.toMatch(/Provide `?\/settings#family/iu)
    expect(MURPH_FAMILY_PLAN_TOOL.description).not.toContain('https://')
    expect(normalized).toContain(
      'A hosted group cannot own a Family plan, begin checkout, inspect account status, or create invites.',
    )
    expect(normalized).toContain(
      'Never treat ordinary family medical history, symptoms, genetics, household health context, or caregiving as Family account management.',
    )
  })

  it('keeps target capability policy out of terse tool call contracts', () => {
    for (const tool of MURPH_CONNECTED_APPS_DYNAMIC_TOOLS) {
      expect(tool.description).not.toContain('SKILL.md')
    }
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md',
    )
    expect(MURPH_FAMILY_PLAN_TOOL.description).not.toContain('SKILL.md')
    expect(MURPH_COMPUTER_OPEN_TOOL.description).not.toContain('SKILL.md')
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
