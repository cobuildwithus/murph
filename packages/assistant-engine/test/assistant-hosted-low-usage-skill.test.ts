import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

async function readLowUsageSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'hosted-low-usage', 'SKILL.md'),
    'utf8',
  )
}

describe('assistant hosted low-usage skill', () => {
  it('registers the trusted low-usage and follow-up trigger', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain('trusted hosted turn context')
    expect(skill?.triggerHint).toContain('insufficient_image_capacity')
    expect(skill?.triggerHint).toContain('reason would_exhaust')
    expect(skill?.triggerHint).toContain('Family-sponsored Murph')
    expect(skill?.triggerHint).toContain('hosted group conversation')
    expect(buildAssistantSkillFileRef('hosted-low-usage')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
    )
  })

  it('handles only a trusted image-capacity denial without overstating exhaustion', async () => {
    const skill = await readLowUsageSkill()

    expect(skill).toContain('`status: insufficient_image_capacity`')
    expect(skill).toContain('`reason: would_exhaust`')
    expect(skill).toContain('`image_started: false`')
    expect(skill).toContain('image did not start')
    expect(skill).toContain('not proof')
    expect(skill).toContain("member's whole plan or the group's whole period")
    expect(skill).toContain('Do not retry automatically')
    expect(skill).toContain('wait for a new explicit request')
    expect(skill).toContain('Do not append a separate low-usage heads-up')
    expect(skill).toContain('Keep this first mention link-free')
    expect(skill).toContain('once even when its coarse')
    expect(skill).toContain('state returns `healthy`')
    expect(skill).toContain('Do not invoke another sales skill')
    expect(skill).toContain('Do not apply the first-heads-up shape')
  })

  it('keeps the first heads-up to one short final segment', async () => {
    const skill = await readLowUsageSkill()

    expect(skill).toContain('append exactly one final usage segment')
    expect(skill).toContain('using `---` only on a bubble-supporting channel')
    expect(skill).toContain('begins after one final `---` line')
    expect(skill).toContain('may still use earlier natural')
    expect(skill).toContain('current message already asks about usage')
    expect(skill).toContain('Do not append a redundant heads-up')
    expect(skill).toContain('urgent, an emergency or crisis')
    expect(skill).toContain('whether or not the reply needs a')
    expect(skill).toContain('requires a safety-changing or')
    expect(skill).toContain('defer the entire usage heads-up')
    expect(skill).toContain('one or two short sentences')
    expect(skill).toContain('Never spread it across multiple usage')
    expect(skill).toContain('without `---` bubble support')
    expect(skill).toContain('final paragraph with no delimiter')
    expect(skill).toContain('Never expose the internal delimiter')
    expect(skill).toContain('ignore `usedPercent`, `remainingPercent`, `forecast`')
    expect(skill).toContain('Do not render a link or Markdown link')
    expect(skill).toContain('Do not repeat the heads-up')
  })

  it('routes only supported direct, Family, and group options', async () => {
    const skill = await readLowUsageSkill()

    expect(skill).toContain('**Pulse Trial:**')
    expect(skill).toContain('**Direct paid Pulse or Edge:**')
    expect(skill).toContain('**Family sponsored:**')
    expect(skill).toContain('**Hosted group:**')
    expect(skill).toContain('Do not promise a link')
    expect(skill).toContain('Personal top-ups are unavailable')
    expect(skill).toContain('Family plan owner may')
    expect(skill).toContain('add one-time usage for this active member')
    expect(skill).toContain('`murph.family_plan action="read_status"`')
    expect(skill).toContain('`owner: true`, `billingActive: true`')
    expect(skill).toContain('matches exactly one `members` row')
    expect(skill).toContain('navigation to Settings > Family')
    expect(skill).toContain('call `murph.group action="read_usage"` once before writing the')
    expect(skill).toContain('include it in the same segment as a plain first-party link')
    expect(skill).toContain("Match the room's energy")
    expect(skill).toContain('nominating someone to cover it')
    expect(skill).toContain('skip the heads-up entirely')
    expect(skill).toContain('standing no-re-offer rule wins')
    expect(skill).toContain('Never switch it automatically')
    expect(skill).toContain('If no funding URL is returned')
    expect(skill).toContain('period end when relevant')
    expect(skill).toContain('remaining percentage when the result includes remainingPercent')
    expect(skill).not.toContain('Share only its')
  })

  it('preserves explicit billing confirmation and payment truth', async () => {
    const skill = await readLowUsageSkill()

    expect(skill).toContain(
      'A recommendation or low-usage warning is not consent',
    )
    expect(skill).toContain('require a matching current quote')
    expect(skill).toContain('A bare yes after multiple options is ambiguous')
    expect(skill).toContain(
      'Never choose an amount, start Checkout, or claim usage was added',
    )
    expect(skill).toContain(
      'never reveal who paid, amounts, or',
    )
    expect(skill).toContain('never claim usage was added when it was not')
    expect(skill).toContain('standing objective')
    expect(skill).toContain('deferral rules below still outrank this objective')
  })
})
