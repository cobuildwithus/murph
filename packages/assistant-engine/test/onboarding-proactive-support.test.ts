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
  it('makes the first reminder-and-review package proactive but bounded', () => {
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
      'the song is also required whenever `generate_song` is available on the current deliverable route',
    )
    expect(prompt).toContain(
      'Formal tone, low humor, or quiet reminder support changes the musical register, not whether the song is generated.',
    )
    expect(prompt).toContain(
      'do not merely offer a song or defer it',
    )
    expect(prompt).toContain(
      'read `music-generation` and call `generate_song`',
    )
    expect(prompt).toContain(
      "An explicit no-music/no-audio preference, the owning skill's safety/privacy exclusion, or time-sensitive help that must be delivered first makes the launch ineligible for music",
    )
    expect(prompt).toContain(
      'state that blocker in plain user-facing language without provider, tool, configuration, environment-variable, or credential names',
    )
    expect(prompt).toContain(
      'A present tool is not enough when its delivery path could suppress the mandatory text close on generation failure',
    )
    expect(prompt).toContain(
      'put no text or later bubble after it. An owning skill may still require attached response media',
    )
    expect(MURPH_GENERATE_SONG_TOOL.description).toContain(
      'leave final response text empty unless an owning flow requires accompanying text; an onboarding launch song always retains its mandatory text close',
    )
  })

  it('requires schedule resolution, same-turn support writes, and a warm close', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [behaviorRaw, onboardingRaw, musicRaw] = await Promise.all([
      readFile(
        path.join(skillsRoot, 'behavior-followthrough', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(skillsRoot, 'music-generation', 'SKILL.md'),
        'utf8',
      ),
    ])
    const behavior = behaviorRaw.replace(/\s+/gu, ' ')
    const onboarding = onboardingRaw.replace(/\s+/gu, ' ')
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
    expect(behavior).toContain('mandatory launch close')
    expect(behavior).toContain(
      'name the exact next scheduled touchpoint and what useful help will arrive',
    )
    expect(behavior).toContain(
      'end with one broad invitation to work on anything else Murph can help with',
    )
    expect(behavior).toContain('the launch song is mandatory')
    expect(behavior).toContain(
      'Do not merely offer one, say it can be made later, or finish the launch with text only.',
    )
    expect(behavior).toContain(
      'read `music-generation` and call it before finishing the launch turn',
    )
    expect(behavior).toContain(
      'Formal tone gets a polished, warm, restrained arrangement and lyric',
    )
    expect(behavior).toContain(
      'Eligibility also requires an unused response-media slot',
    )
    expect(behavior).toContain(
      'no time-sensitive help that must be delivered first',
    )
    expect(behavior).toContain(
      "When the user's current request requires another response media item, honor that request and treat the media conflict as a route blocker.",
    )
    expect(behavior).toContain(
      'Telegram is currently a route blocker for this launch rule',
    )
    expect(behavior).toContain(
      'the song could not safely be attached in this chat',
    )
    expect(behavior).toContain(
      'send the mandatory text close, and do not leave onboarding open for media',
    )
    expect(behavior).toContain(
      'a generation failure is never a blocker to the plan or close',
    )
    expect(behavior).toContain(
      'Skip only for acute or high-stakes care, medication or clinical adherence',
    )
    expect(behavior).toContain(
      'Never put labs, medications, diagnoses, injuries, body measurements, or private friction in lyrics.',
    )
    expect(behavior).toContain(
      'safety/privacy exclusion, or time-sensitive help that must be delivered first makes the launch ineligible for music; omit the song without calling attention to the omission',
    )
    expect(behavior).toContain(
      'If the song was omitted, was there an explicit no-music/no-audio preference, safety/privacy exclusion, or time-sensitive help that had to be delivered first; otherwise, was there an unavailable or failed tool/route, response-media conflict, or generation failure with a plain user-facing blocker stated?',
    )
    expect(behavior).toContain(
      'without provider, tool, configuration, environment-variable, or credential names',
    )
    expect(behavior).toContain(
      'The broad invitation remains the final text sentence.',
    )
    expect(behavior).not.toContain('a song may follow')
    expect(behavior).not.toContain('A song is a bonus')

    expect(onboarding).toContain(
      'perform the canonical plan and exact reminder/review writes named in the launch offer in the same turn',
    )
    expect(onboarding).toContain(
      'Do not leave reminder setup for the user to request later and do not ask for a second confirmation.',
    )
    expect(onboarding).toContain(
      'the song is mandatory too. Formal tone, low humor, or quiet reminder support changes its register, not whether it is generated.',
    )
    expect(onboarding).toContain(
      'do not merely offer a song or defer it',
    )
    expect(onboarding).toContain(
      'Read `music-generation` and call `generate_song` before finishing the launch turn',
    )
    expect(onboarding).toContain(
      'the song remains part of the same launch reply without replacing the useful setup confirmation or delaying time-sensitive help',
    )
    expect(onboarding).toContain(
      'the named support writes succeeded or an explicit opt-out or real blocker is recorded',
    )
    expect(onboarding).toContain(
      'the song was generated in that turn; an explicit no-music/no-audio preference, safety/privacy exclusion, or time-sensitive help made it ineligible; or an otherwise-eligible tool/route/media/generation blocker was stated in plain user-facing language.',
    )
    expect(music).toContain(
      'tone changes the arrangement and lyric register, not whether the song is generated',
    )
    expect(music).toContain(
      'An explicit no-music or no-audio preference still wins.',
    )
    expect(music).toContain(
      "The song is the reply's only media item, but it may accompany text.",
    )
    expect(music).toContain(
      'leave the reply text empty unless an owning flow requires accompanying text. An onboarding launch song always retains its mandatory text close.',
    )
    expect(music).toContain(
      'the mandatory first-onboarding launch song is 15–20s',
    )
  })
})
