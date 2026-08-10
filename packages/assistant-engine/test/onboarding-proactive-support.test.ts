import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'
import {
  MURPH_GENERATE_SONG_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-song.js'

describe('proactive onboarding support', () => {
  it('makes the first reminder-and-review package proactive but keeps the launch text-only', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedAutomationAvailable: true,
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
      channel: 'linq',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-07-17',
      currentTimeZone: 'America/New_York',
      hostedRuntime: true,
      onboardingGuidance: true,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
    })

    expect(prompt).toContain('do not wait for them to ask for reminders')
    expect(prompt).toContain(
      'put the exact finite reminder-and-review package inside the launch offer',
    )
    expect(prompt).toContain(
      'treat a clear yes as authorization for those named plan and support writes',
    )
    expect(prompt).toContain(
      'only an explicit opt-out, a one-time action, or a real delivery or safety blocker may leave it without reminders',
    )
    expect(prompt).toContain('Formal tone is not a quiet-support preference.')
    expect(prompt).toContain(
      'follow the text-only close owned by `behavior-followthrough` through the onboarding skill',
    )
    expect(prompt).toContain(
      'Onboarding itself never triggers music or requires media for completion.',
    )
    expect(prompt).not.toContain(
      'Do not generate or offer a song during onboarding.',
    )
    expect(prompt).toContain(
      'put no text or later bubble after it. An owning skill may still require attached response media',
    )
    expect(MURPH_GENERATE_SONG_TOOL.description).toContain(
      'onboarding never triggers music automatically',
    )
  })

  it('requires schedule resolution, modality matching, and a text-only onboarding close', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [
      behaviorRaw,
      onboardingRoot,
      onboardingAspiration,
      onboardingReturn,
      musicRaw,
    ] = await Promise.all([
      readFile(
        path.join(skillsRoot, 'behavior-followthrough', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(
          skillsRoot,
          'murph-onboarding',
          'references',
          'aspiration-foundation-delegation.md',
        ),
        'utf8',
      ),
      readFile(
        path.join(
          skillsRoot,
          'murph-onboarding',
          'references',
          'return-launch-completion.md',
        ),
        'utf8',
      ),
      readFile(
        path.join(skillsRoot, 'music-generation', 'SKILL.md'),
        'utf8',
      ),
    ])
    const behavior = behaviorRaw.replace(/\s+/gu, ' ')
    const onboarding = [
      onboardingRoot,
      onboardingAspiration,
      onboardingReturn,
    ].join('\n').replace(/\s+/gu, ' ')
    const music = musicRaw.replace(/\s+/gu, ' ')

    expect(behavior).toContain('"Any day you have time" is unresolved.')
    expect(behavior).toContain(
      'proactive support is the default launch shape, not an optional menu after the plan',
    )
    expect(behavior).toContain(
      'one actionable reminder for each planned occurrence in the initial support window',
    )
    expect(behavior).toContain(
      'A clear yes to that offer authorizes the named plan, reminder, and review writes together.',
    )
    expect(behavior).toContain('mandatory text launch close')
    expect(behavior).toContain(
      'name the exact next scheduled touchpoint and what useful help will arrive',
    )
    expect(behavior).toContain(
      'end with one broad invitation to work on anything else Murph can help with',
    )
    expect(behavior).toContain(
      'The onboarding launch close is text-only.',
    )
    expect(behavior).toContain(
      'Do not automatically generate, offer, or mention a song as onboarding delight.',
    )
    expect(behavior).toContain(
      'A song the user explicitly requests remains ordinary current-request media',
    )
    expect(behavior).not.toContain('a song may follow')
    expect(behavior).not.toContain('A song is a bonus')
    expect(behavior).not.toContain('Telegram is currently a route blocker')
    expect(behavior).not.toContain('the song could not safely be attached in this chat')

    expect(onboarding).toContain(
      'perform the canonical plan and exact reminder/review writes named in the launch offer in the same turn',
    )
    expect(onboarding).toContain(
      'Do not leave reminder setup for the user to request later and do not ask for a second confirmation.',
    )
    expect(onboarding).toContain(
      "Follow `behavior-followthrough`'s text-only launch close after the plan and support writes succeed.",
    )
    expect(onboarding).toContain(
      'Do not add automatic launch media or make media an onboarding completion requirement.',
    )
    expect(onboarding).toContain(
      'the named support writes succeeded or an explicit opt-out or real blocker is recorded',
    )
    expect(music).toContain(
      'Onboarding does not automatically trigger music.',
    )
    expect(music).toContain(
      'Use this skill during onboarding only when the user explicitly asks for a song',
    )
    expect(onboarding).toContain(
      'You can type it out instead — either works just as well.',
    )
    expect(onboarding).toContain(
      'I can walk you through sending a voice memo.',
    )
    expect(onboarding).toContain(
      'Do not offer it based on guessed age, and do not make unknown age block or delay the invitation.',
    )
    expect(onboarding).toContain(
      'Only when they answered that invitation with a voice memo',
    )
    expect(onboarding).toContain(
      'have not since declined voice, and `murph.generate_voice_memo` is available',
    )
    expect(onboarding).toContain(
      'That response is voice-only: do not duplicate the question or the already-sent delegation acknowledgement in text.',
    )
    expect(onboarding).toContain(
      'Also use text when voice generation is unavailable, fails, or the user prefers text.',
    )
    expect(onboarding).not.toContain('Read `music-generation` and call `generate_song`')

    expect(music).toContain(
      "The song is the reply's only media item, but it may accompany text.",
    )
    expect(behavior).not.toContain('automatic launch-song eligibility')
    expect(onboarding).not.toContain('launch-song eligibility')
    expect(music).not.toContain('first-onboarding launch song')
  })
})
