import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const RETIRED_USAGE_TERM = ['cost', 'weighted'].join('-')

async function readLowUsageSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'hosted-low-usage', 'SKILL.md'),
    'utf8',
  )
}

describe('assistant hosted low-usage skill', () => {
  it('registers low-usage, explicit options, and follow-up triggers', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain('trusted hosted turn context')
    expect(skill?.triggerHint).toContain('Family-sponsored Murph')
    expect(skill?.triggerHint).toContain('hosted group conversation')
    expect(skill?.triggerHint).toContain(
      'available ways to add or earn more usage',
    )
    expect(buildAssistantSkillFileRef('hosted-low-usage')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
    )
  })

  it('treats broad get-more-usage questions as all-options requests', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'adding usage, or ways to get or earn more usage',
    )
    expect(normalizedSkill).toContain(
      'how to get more usage, what options exist, how to earn usage, or about a group referral',
    )
    expect(normalizedSkill).toContain(
      'A direct funding intent explicitly asks to fund, sponsor, contribute, pay to add usage, receive the funding link, or otherwise selects the paid path over earned options',
    )
    expect(normalizedSkill).toContain(
      'A broad-options intent asks generically how to get or add more usage, get more Murph time, or keep the room going',
    )
    expect(normalizedSkill).toContain(
      'Call `read_usage` only',
    )
    expect(normalizedSkill).toContain(
      'Do not call `read_usage_referral` or add earned referral options',
    )
    expect(normalizedSkill).toContain(
      'Do this even when current usage is `healthy`',
    )
    expect(normalizedSkill).toContain(
      'never make more than one pre-action referral read in one user turn',
    )
    expect(normalizedSkill).toContain(
      'The applied-but-snapshot-unavailable recovery rules below are the only exception',
    )
    expect(normalizedSkill).toContain(
      'Do not answer with only the paid or funding path or make the sender ask again',
    )
    expect(normalizedSkill).toContain(
      'A direct group funding intent explicitly selects the paid or funding path rather than asking generically for more usage',
    )
    expect(normalizedSkill).toContain(
      "use this turn's `read_usage_referral` result",
    )
    expect(normalizedSkill).toContain(
      'If there is no current-turn result, including on a later follow-up, call it once',
    )
    expect(normalizedSkill).not.toContain(
      'When the current sender asks about the earned option, call `read_usage_referral` again',
    )
  })

  it('keeps the first heads-up to one short final segment', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')
    const firstHeadsUpSection = skill.slice(
      skill.indexOf('## Choose the first-heads-up question'),
      skill.indexOf('## Referral comedy shape'),
    )

    expect(skill).toContain('append exactly one final usage segment')
    expect(skill).toContain(
      'using `---` only when the active direct reply style expressly authorizes that',
    )
    expect(skill).toContain(
      'In an interactive group, append the first assistant-initiated low-usage mention',
    )
    expect(skill).toContain('Never use `---` there')
    expect(skill).toContain(
      'even when the underlying transport supports reply bubbles',
    )
    expect(skill).toContain(
      'The second is a one-bubble\n' +
      'group example with no delimiter',
    )
    expect(skill).toContain(
      "Maya won yesterday's step challenge with 14,320 steps. 🏆\n\n" +
      "Tiny operational drama: we're getting low on Murph time",
    )
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
    expect(skill).toContain(
      'active direct reply style does not expressly authorize `---`',
    )
    expect(skill).toContain('final paragraph with no delimiter')
    expect(skill).toContain('internal delimiter as visible copy')
    expect(normalizedSkill).toContain(
      'ignore `usedPercent`, `remainingPercent`, `forecast`, `includedUsageUsedPercent`',
    )
    expect(skill).toContain('Do not render a link or Markdown link')
    expect(normalizedSkill).toContain(
      'In a group, also keep the first heads-up link-free',
    )
    expect(normalizedSkill).toContain(
      'A yes to "want the options?" asks only for an explanation',
    )
    expect(firstHeadsUpSection).not.toContain(
      'https://www.withmurph.ai/groups/fund/',
    )
    expect(firstHeadsUpSection).toContain(
      "we're getting low on Murph time in here",
    )
    expect(firstHeadsUpSection).toContain('Want me to check the options?')
    expect(firstHeadsUpSection).not.toContain(
      "we're getting low on messages in here",
    )
    expect(normalizedSkill).toContain(
      'Do not frame each text as a unit being spent',
    )
    expect(skill).toContain('Do not repeat the heads-up')
  })

  it('routes only supported direct, Family, and group options', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(skill).toContain('**Pulse Trial:**')
    expect(skill).toContain('**Direct paid Pulse or Edge:**')
    expect(skill).toContain('**Family sponsored:**')
    expect(skill).toContain('**Hosted group:**')
    expect(normalizedSkill).toContain('Do not promise a link')
    expect(skill).toContain('never invent one')
    expect(skill).toContain('**Family Pulse or Edge:**')
    expect(skill).toContain('**Family Max:**')
    expect(skill).toContain('Personal top-ups are unavailable')
    expect(skill).toContain('Personal top-ups and a higher Family tier are unavailable')
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
    expect(normalizedSkill).toContain(
      'In a hosted group, after someone accepts the link-free first heads-up',
    )
    expect(normalizedSkill).toContain(
      "pass that response's exact opaque accepted `message_ref`",
    )
    expect(normalizedSkill).toContain(
      "Never infer the responder from the whole grouped turn",
    )
    expect(normalizedSkill).toContain(
      'Keep this first mention link-free and option-neutral',
    )
    expect(normalizedSkill).toContain(
      '`fundingNeeded` is the sole server-owned urgency signal',
    )
    expect(normalizedSkill).toContain(
      'When it is false, skip the heads-up entirely and do not infer or explain why',
    )
    expect(normalizedSkill).toContain(
      'do not name or count earned, sponsored, paid, funding, or referral paths',
    )
    expect(normalizedSkill).toContain(
      'A returned funding URL is authority for a later requested follow-up, not copy for the first heads-up',
    )
    expect(normalizedSkill).toContain(
      'present all of them before any link',
    )
    expect(normalizedSkill).toContain(
      'place any funding URL after the group-funding path rather than opening with it',
    )
    expect(normalizedSkill).toContain(
      'Never send it in the first assistant-initiated heads-up',
    )
    expect(normalizedSkill).toContain(
      'sponsoring more Murph time for the room, not buying messages',
    )
    expect(normalizedSkill).toContain(
      'Do not volunteer message counts',
    )
    expect(normalizedSkill).not.toContain(
      'include it in the same segment as a plain first-party link',
    )
    expect(normalizedSkill).not.toContain(
      'sponsor action in approximate messages',
    )
    expect(skill).toContain("Match the room's energy")
    expect(normalizedSkill).toContain('without naming or singling out a nonpayer')
    expect(normalizedSkill).toContain('guilt-trip, call out nonpayers')
    expect(normalizedSkill).toContain('skip the heads-up entirely')
    expect(skill).toContain('standing no-re-offer rule wins')
    expect(skill).toContain('Never switch it automatically')
    expect(normalizedSkill).toContain('If no funding URL is returned')
    expect(normalizedSkill).not.toContain('sponsorshipStatus')
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

  it('separates explicit group funding from low-capacity urgency', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      '`fundingNeeded` controls urgency, not whether a returned funding URL may be shared after an explicit request',
    )
    expect(normalizedSkill).toContain(
      'describe a returned first-party funding URL as the private path to sponsor more Murph time for the room',
    )
    expect(normalizedSkill).toContain(
      'does not make explicit funding unavailable',
    )
    expect(normalizedSkill).toContain(
      'the room needs more Murph time to avoid or recover from a pause',
    )
    expect(normalizedSkill).toContain(
      'The deterministic Web-owned exhaustion notice may include its own current first-party recovery link',
    )
    expect(normalizedSkill).not.toContain(
      'Share a returned first-party funding URL only when `fundingNeeded` is true',
    )
  })

  it('answers only explicit current-room usage progress with the bounded aggregate', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'an explicit current-room usage-progress question asks how much of this room\'s included usage has been used in the current period',
    )
    expect(normalizedSkill).toContain(
      'A request about funding, sponsoring, contributing, adding usage, options, referrals, or earning more usage does not qualify by itself',
    )
    expect(normalizedSkill).toContain(
      'For an integer from 0 through 99, answer with exactly: "About X% of this room\'s included usage for the current period has been used."',
    )
    expect(normalizedSkill).toContain(
      'For 100, answer with exactly: "At least all of this room\'s included usage for the current period has been used."',
    )
    expect(normalizedSkill).toContain(
      'Never rewrite this as "100% used," "0% left," "out," "exhausted," or a claim that no usage remains',
    )
    expect(normalizedSkill).toContain(
      'an authoritative included-usage progress figure for this room is unavailable right now',
    )
    expect(normalizedSkill).toContain(
      'Do not treat a missing field as zero or answer from an earlier read',
    )
    expect(normalizedSkill).toContain(
      'Ignore `includedUsageUsedPercent` for every assistant-initiated heads-up',
    )
    expect(normalizedSkill).toContain(
      'when handling funding, sponsor, contribution, add-usage, options, referral, or earned-usage intent',
    )
    expect(normalizedSkill).toContain(
      'the percentage must not rank, justify, or change the options',
    )
    expect(normalizedSkill).toContain(
      'Only an explicit current-room progress question authorizes the exact included-usage wording above',
    )
  })

  it('maps the member-facing Core plan without renaming hosted groups', async () => {
    const skill = await readLowUsageSkill()
    const hostedGroupHeading =
      '- **Group:** Call `read_usage` again when the state may have changed.'
    const hostedGroupIndex = skill.indexOf(hostedGroupHeading)

    expect(hostedGroupIndex).toBeGreaterThan(0)
    const directPlanGuidance = skill.slice(0, hostedGroupIndex)
    const hostedGroupGuidance = skill.slice(hostedGroupIndex)

    expect(directPlanGuidance).toContain(
      'Core is the member-facing name\n' +
      '  for `targetPlanCode: "launch_group_monthly"`.',
    )
    expect(directPlanGuidance).toContain(
      'Core maps\n' +
      '  to `launch_group_monthly`.',
    )
    expect(directPlanGuidance).toContain('**Direct paid Core:**')
    expect(directPlanGuidance).not.toMatch(/\bGroup\b/u)
    expect(hostedGroupGuidance).toContain(hostedGroupHeading)
    expect(hostedGroupGuidance).not.toContain('sponsorshipStatus')
  })

  it('preserves explicit billing confirmation and payment truth', async () => {
    const skill = await readLowUsageSkill()
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'A recommendation or low-usage warning is not consent',
    )
    expect(skill).toContain('Merely describing referral options is not consent')
    expect(skill).toContain('an explicit "both" is consent')
    expect(skill).toContain('Different policies are independent')
    expect(skill).toContain('one-option limit')
    expect(normalizedSkill).toContain('one compact message')
    expect(normalizedSkill).toContain(
      'Call `arm_usage_referral` once with the exact selected `policyCodes` set',
    )
    expect(skill).toContain('Never split one selection across multiple calls')
    expect(skill).toContain('usage_referral_selection_requires_one')
    expect(normalizedSkill).toContain(
      'no new referral option from that request committed',
    )
    expect(normalizedSkill).toContain(
      'only one referral option can be started now',
    )
    expect(normalizedSkill).toContain('invent operational limitations')
    expect(normalizedSkill).toContain('still `armed` when the group is created')
    expect(normalizedSkill).toContain('language respectful and person-first')
    expect(normalizedSkill).toContain('use dehumanizing labels')
    expect(normalizedSkill).not.toContain(
      'names every exact option just presented',
    )
    expect(normalizedSkill).toContain(
      'Canceling one policy never cancels or replaces another',
    )
    expect(normalizedSkill).toContain(
      'Use each returned `rewardLabel` exactly',
    )
    expect(normalizedSkill).toContain(
      'preserve its "about" estimate language',
    )
    expect(normalizedSkill).toContain(
      'Never derive message counts, current balance, or calendar/trial duration from it',
    )
    expect(normalizedSkill.toLowerCase()).not.toContain(RETIRED_USAGE_TERM)
    expect(normalizedSkill).toContain('Never reveal qualification counters')
    expect(normalizedSkill).toContain(
      'state the returned `expiresAt` as the referral option\'s public occurrence deadline',
    )
    expect(normalizedSkill).toContain(
      '`usage_referral_arm_applied_snapshot_unavailable`, the selected referral option started',
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
    expect(normalizedSkill).toContain(
      'the named referral option was started, but Murph could not refresh its current status',
    )
    expect(normalizedSkill).toContain(
      'the named referral option was canceled, but Murph could not refresh its current status',
    )
    expect(normalizedSkill).not.toContain('say only one can be armed now')
    expect(normalizedSkill).not.toContain('say the arm committed')
    expect(normalizedSkill).not.toContain('say the cancellation committed')
    expect(normalizedSkill).toContain(
      'including a referral option started after the cancellation',
    )
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
      'asks them to come back and say hi in the group once setup is done',
    )
    expect(normalizedSkill).toContain(
      'confirm the handoff in one short sentence',
    )
    expect(normalizedSkill).not.toContain(
      'After starting that referral option, explain the reciprocal setup path',
    )
    expect(normalizedSkill).toContain(
      'introduce me to your mom and I can secure this group some additional Murph time',
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
      'never reveal whether or how the room is currently funded, who paid',
    )
    expect(skill).not.toContain('claim the room is sponsored')
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
          activeMissions: [{
            destinationKind: 'personal',
            expiresAt: '2026-08-03T18:00:00.000Z',
            policyCode: 'active_group_v1',
            rewardLabel:
              'about 14 more days of Murph usage for your Murph',
            state: 'armed',
          }],
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
      'about 14 more days of Murph usage for your Murph',
    )
    expect(assembledContext).not.toMatch(/\$|weighted usage credit/iu)
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
      label: 'an arm followed by no active referral',
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
              activeMissions: [],
              availablePolicies: [],
              trialCreditNotice: null,
            },
            status: 'ok',
          },
        },
      ],
    },
    {
      label: 'an arm followed by multiple active referrals',
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
              activeMissions: [
                {
                  destinationKind: 'personal',
                  expiresAt: '2026-08-03T18:00:00.000Z',
                  policyCode: 'new_person_activation_v1',
                  rewardLabel:
                    'about 10 more days of Murph usage for your Murph',
                  state: 'armed',
                },
                {
                  destinationKind: 'personal',
                  expiresAt: '2026-08-04T18:00:00.000Z',
                  policyCode: 'active_group_v1',
                  rewardLabel:
                    'about 14 more days of Murph usage for your Murph',
                  state: 'armed',
                },
              ],
              availablePolicies: [],
              trialCreditNotice: null,
            },
            status: 'ok',
          },
        },
      ],
    },
    {
      label: 'a cancel followed by a newly armed referral',
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
              activeMissions: [{
                destinationKind: 'personal',
                expiresAt: '2026-08-05T18:00:00.000Z',
                policyCode: 'new_person_activation_v1',
                rewardLabel:
                  'about 10 more days of Murph usage for your Murph',
                state: 'armed',
              }],
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
    expect(normalizedContext).not.toMatch(/\$|weighted usage credit/iu)
    expect(normalizedContext).toContain('or claim that commit failed')
  })

  it.each([
    {
      expectedMemberCopy:
        'the named referral option was started, but Murph could not refresh its current status',
      forbiddenMemberDirective: 'say the arm committed',
      mutationAction: 'arm_usage_referral',
      unavailableReason:
        'usage_referral_arm_applied_snapshot_unavailable',
    },
    {
      expectedMemberCopy:
        'the named referral option was canceled, but Murph could not refresh its current status',
      forbiddenMemberDirective: 'say the cancellation committed',
      mutationAction: 'cancel_usage_referral',
      unavailableReason:
        'usage_referral_cancel_applied_snapshot_unavailable',
    },
  ])('keeps failed $mutationAction recovery plain for members', async ({
    expectedMemberCopy,
    forbiddenMemberDirective,
    mutationAction,
    unavailableReason,
  }) => {
    const skill = await readLowUsageSkill()
    const assembledContext = [
      skill,
      '<tool_result>',
      JSON.stringify({
        action: mutationAction,
        result: {
          referral: null,
          status: 'unavailable',
          unavailableReason,
        },
      }),
      '</tool_result>',
      '<tool_result>',
      JSON.stringify({
        action: 'read_usage_referral',
        result: {
          referral: null,
          status: 'unavailable',
        },
      }),
      '</tool_result>',
    ].join('\n').replace(/\s+/gu, ' ')

    expect(assembledContext).toContain(
      'keep the action and lifecycle names internal',
    )
    expect(assembledContext).toContain(expectedMemberCopy)
    expect(assembledContext).not.toContain(forbiddenMemberDirective)
  })

  it.each([
    {
      mutationAction: 'arm_usage_referral',
      unavailableReason:
        'usage_referral_arm_applied_snapshot_unavailable',
    },
    {
      mutationAction: 'cancel_usage_referral',
      unavailableReason:
        'usage_referral_cancel_applied_snapshot_unavailable',
    },
  ])('keeps one pre-action read and one required recovery read after $mutationAction', async ({
    mutationAction,
    unavailableReason,
  }) => {
    const skill = await readLowUsageSkill()
    const toolActions = [
      'read_usage_referral',
      mutationAction,
      'read_usage_referral',
    ]
    const assembledContext = [
      skill,
      '<tool_result>',
      JSON.stringify({
        action: mutationAction,
        result: {
          referral: null,
          status: 'unavailable',
          unavailableReason,
        },
      }),
      '</tool_result>',
    ].join('\n')
    const normalizedContext = assembledContext.replace(/\s+/gu, ' ')

    expect(toolActions.filter((action) =>
      action === 'read_usage_referral'
    )).toHaveLength(2)
    expect(toolActions.filter((action) =>
      action === mutationAction
    )).toHaveLength(1)
    expect(normalizedContext).toContain(
      'never make more than one pre-action referral read in one user turn',
    )
    expect(normalizedContext).toContain(
      'only exception and require one authoritative post-mutation read',
    )
    expect(normalizedContext).toContain(
      'Immediately call `read_usage_referral`',
    )
  })
})
