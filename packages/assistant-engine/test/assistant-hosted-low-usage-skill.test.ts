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
    expect(skill?.triggerHint).toContain('Family-sponsored Murph')
    expect(skill?.triggerHint).toContain('hosted group conversation')
    expect(buildAssistantSkillFileRef('hosted-low-usage')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
    )
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
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(skill).toContain('**Pulse Trial:**')
    expect(skill).toContain('**Direct paid Pulse or Edge:**')
    expect(skill).toContain('**Family sponsored:**')
    expect(skill).toContain('**Hosted group:**')
    expect(skill).toContain('Do not promise a link')
    expect(skill).toContain('Personal top-ups are unavailable')
    expect(skill).toContain('Family plan owner may')
    expect(skill).toContain('add one-time usage for this active member')
    expect(skill).toContain('`murph.family_plan action="read_status"`')
    expect(normalizedSkill).toContain(
      '`murph.family_plan action="read_status"` once when available before wording the heads-up',
    )
    expect(normalizedSkill).toContain(
      '`members` row with `isOwner: true` and `status: "active"`',
    )
    expect(normalizedSkill).toContain(
      'Use the Family status read above before choosing second- or third-person wording',
    )
    expect(normalizedSkill).toContain(
      'Do not make a confirmed owner correct a third-person "the owner can" statement',
    )
    expect(normalizedSkill).toContain(
      'on that turn when available, even if this heads-up already checked owner status',
    )
    expect(normalizedSkill).toContain(
      'a less capable model that uses less AI usage',
    )
    expect(skill).toContain('`owner: true`, `billingActive: true`')
    expect(skill).toContain('matches')
    expect(skill).toContain('exactly one `members` row')
    expect(skill).toContain(
      '`https://www.withmurph.ai/settings?addUsage=family#family`',
    )
    expect(skill).toContain(
      '`https://www.withmurph.ai/settings?addUsage=true#subscription`',
    )
    expect(skill).toContain('Never put a member ID or')
    expect(skill).toContain('group ID into a model-composed link')
    expect(skill).toContain('call `murph.group action="read_usage"` once before writing the')
    expect(skill).toContain('`murph.group action="read_usage_referral"` once')
    expect(skill).toContain('This only offers')
    expect(skill).toContain('does not arm one')
    expect(skill).toContain('include it in the same segment as a plain first-party link')
    expect(skill).toContain("Match the room's energy")
    expect(skill).toContain('without naming or singling out a nonpayer')
    expect(skill).toContain('guilt-trip, call out nonpayers')
    expect(skill).toContain('skip the heads-up entirely')
    expect(skill).toContain('standing no-re-offer rule wins')
    expect(skill).toContain('Never switch it automatically')
    expect(skill).toContain('If no funding URL is returned')
    expect(skill).toContain('period end when relevant')
    expect(skill).toContain('remaining percentage when the result includes remainingPercent')
    expect(skill).toContain(
      'returned percentages and forecast as overall available AI usage',
    )
    expect(normalizedSkill).toContain(
      'does not expose how much comes from included allowance or any usage-credit source, including purchase or referral',
    )
    expect(normalizedSkill).toContain(
      'If asked for a source split, say it is unavailable',
    )
    expect(normalizedSkill).toContain(
      'never assign a returned percentage to included allowance, purchased credit, referral credit, or another source',
    )
    expect(skill).not.toContain('included-versus-purchased')
    expect(skill).not.toContain('Share only its')
  })

  it('preserves explicit billing confirmation and payment truth', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'A recommendation or low-usage warning is not consent',
    )
    expect(skill).toContain('Merely describing a referral mission is not consent')
    expect(skill).toContain('one exact current sender chooses one exact returned policy')
    expect(normalizedSkill).toContain('Treat returned message counts as approximate')
    expect(normalizedSkill).toContain('Never reveal qualification counters')
    expect(normalizedSkill).toContain(
      'state the returned `expiresAt` as the mission\'s public occurrence deadline',
    )
    expect(normalizedSkill).toContain(
      '`usage_referral_arm_applied_snapshot_unavailable`, the arm committed',
    )
    expect(normalizedSkill).toContain(
      'Do not arm it again or claim that commit failed',
    )
    expect(normalizedSkill).toContain(
      'that recovery read is authoritative for current state',
    )
    expect(normalizedSkill).toContain(
      '`usage_referral_cancel_applied_snapshot_unavailable`, the cancellation committed',
    )
    expect(normalizedSkill).toContain('including a mission armed after the cancellation')
    expect(normalizedSkill).toContain(
      'private anti-gaming thresholds, or late-arrival grace rules',
    )
    expect(normalizedSkill).not.toContain(
      'Never restate qualification counters, time windows',
    )
    expect(normalizedSkill).toContain(
      'Start a fresh group and make it genuinely active, with multiple people actually talking.',
    )
    expect(normalizedSkill).toContain(
      'Give the referrer only the group-opening goal',
    )
    expect(normalizedSkill).toContain(
      'The ordinary first-reply group setup flow owns the rest',
    )
    expect(normalizedSkill).toContain(
      'confirm the handoff in one short sentence',
    )
    expect(normalizedSkill).not.toContain(
      'After arming that mission, explain the reciprocal setup path',
    )
    expect(normalizedSkill).toContain(
      'introduce me to your mom and I can bring this group roughly another 50 messages',
    )
    expect(normalizedSkill).toContain('Murph is the butt of the joke')
    expect(normalizedSkill).toContain('Do not reuse the mom line as a template')
    expect(normalizedSkill).toContain('Do not sexualize or degrade the absent person')
    expect(normalizedSkill).toContain('Do not say "sign up your mom"')
    expect(skill).toContain('require a matching current quote')
    expect(skill).toContain('A bare yes after multiple options is ambiguous')
    expect(skill).toContain('Never choose an amount, start')
    expect(skill).toContain('Checkout, or claim usage was added')
    expect(skill).toContain(
      'never reveal who paid, amounts, or',
    )
    expect(skill).toContain('never claim messages were sponsored when they were not')
    expect(skill).toContain('standing objective')
    expect(skill).toContain('deferral rules below still outrank this objective')
  })

  it('keeps the public arm deadline in the tool-result context without private thresholds', async () => {
    const skill = await readLowUsageSkill()
    const armedToolResult = {
      action: 'arm_usage_referral',
      result: {
        outcome: 'armed',
        referral: {
          active: {
            destinationKind: 'personal',
            expiresAt: '2026-08-03T18:00:00.000Z',
            policyCode: 'active_group_v1',
            rewardLabel:
              'about 140 more messages on the model your Murph is using now',
            state: 'armed',
          },
        },
        status: 'ok',
      },
    }
    const assembledContext = [
      skill,
      '<tool_result>',
      JSON.stringify(armedToolResult),
      '</tool_result>',
    ].join('\n')

    expect(assembledContext).toContain('2026-08-03T18:00:00.000Z')
    expect(assembledContext).toContain(
      'about 140 more messages on the model your Murph is using now',
    )
    expect(JSON.stringify(armedToolResult)).not.toContain('humanMessageCount')
    expect(JSON.stringify(armedToolResult)).not.toContain(
      'nonReferrerMessageCount',
    )
    expect(JSON.stringify(armedToolResult)).not.toContain(
      'minimumActivitySpan',
    )
  })

  it.each([
    {
      label: 'an arm followed by no active mission',
      toolResults: [
        {
          action: 'arm_usage_referral',
          result: {
            referral: null,
            status: 'unavailable',
            unavailableReason:
              'usage_referral_arm_applied_snapshot_unavailable',
          },
        },
        {
          action: 'read_usage_referral',
          result: {
            outcome: 'read',
            referral: {
              active: null,
              availablePolicies: [],
              trialCreditNotice: null,
            },
            status: 'ok',
          },
        },
      ],
    },
    {
      label: 'an arm followed by a superseding mission',
      toolResults: [
        {
          action: 'arm_usage_referral',
          result: {
            referral: null,
            status: 'unavailable',
            unavailableReason:
              'usage_referral_arm_applied_snapshot_unavailable',
          },
        },
        {
          action: 'read_usage_referral',
          result: {
            outcome: 'read',
            referral: {
              active: {
                destinationKind: 'personal',
                expiresAt: '2026-08-04T18:00:00.000Z',
                policyCode: 'active_group_v1',
                rewardLabel:
                  'about 140 more messages on the model your Murph is using now',
                state: 'armed',
              },
              availablePolicies: [],
              trialCreditNotice: null,
            },
            status: 'ok',
          },
        },
      ],
    },
    {
      label: 'a cancel followed by a newly armed mission',
      toolResults: [
        {
          action: 'cancel_usage_referral',
          result: {
            referral: null,
            status: 'unavailable',
            unavailableReason:
              'usage_referral_cancel_applied_snapshot_unavailable',
          },
        },
        {
          action: 'read_usage_referral',
          result: {
            outcome: 'read',
            referral: {
              active: {
                destinationKind: 'personal',
                expiresAt: '2026-08-05T18:00:00.000Z',
                policyCode: 'new_person_activation_v1',
                rewardLabel:
                  'about 100 more messages on the model your Murph is using now',
                state: 'armed',
              },
              availablePolicies: [],
              trialCreditNotice: null,
            },
            status: 'ok',
          },
        },
      ],
    },
  ])('makes the recovery read authoritative for $label', async ({
    toolResults,
  }) => {
    const skill = await readLowUsageSkill()
    const assembledContext = [
      skill,
      ...toolResults.flatMap((toolResult) => [
        '<tool_result>',
        JSON.stringify(toolResult),
        '</tool_result>',
      ]),
    ].join('\n')
    const normalizedContext = assembledContext.replace(/\s+/gu, ' ')
    const mutationAction = toolResults[0]?.action

    expect(toolResults.filter(({ action }) => action === mutationAction))
      .toHaveLength(1)
    expect(toolResults.at(-1)?.action).toBe('read_usage_referral')
    expect(normalizedContext).toContain(
      'that recovery read is authoritative for current state',
    )
    expect(normalizedContext).toContain('or claim that commit failed')
  })
})
