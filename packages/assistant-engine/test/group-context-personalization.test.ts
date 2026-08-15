import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  MURPH_GENERATE_SONG_TOOL,
} from '../src/assistant-codex/dynamic-tools/generate-song.js'
import {
  renderAssistantGroupRoomModelPrompt,
} from '../src/assistant/group-room-model.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const basePromptInput = {
  assistantCliContract: null,
  channel: 'linq',
  cliAccess: {
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  },
  currentLocalDate: '2026-08-07',
  currentTimeZone: 'America/New_York',
  hostedRuntime: true,
  modelBehaviorProfile: 'gpt5-agentic',
  onboardingGuidance: false,
} satisfies AssistantSystemPromptInput

function expectContainsAll(value: string, expected: readonly string[]): void {
  for (const text of expected) {
    expect(value).toContain(text)
  }
}

describe('group context personalization', () => {
  it('uses one general room-context principle without inventing route capabilities', () => {
    const groupPrompts = [
      buildAssistantSystemPrompt({
        ...basePromptInput,
        conversationScope: 'group',
      }),
      buildAssistantSystemPrompt({
        ...basePromptInput,
        channel: 'email',
        conversationScope: 'group',
      }),
    ]
    const directPrompt = buildAssistantSystemPrompt({
      ...basePromptInput,
      conversationScope: 'direct',
    })

    for (const prompt of groupPrompts) {
      expectContainsAll(prompt, [
        'Group context and continuity:',
        'Build and refine over time a working, revisable understanding of this room',
        'committed conversation available to this turn',
        'When room-specific understanding materially improves a result',
        'decision, plan, recommendation, coordination, recap, celebration, joke, or creative work',
        'instead of a generic answer',
        'do not force lore, repeat callbacks mechanically, or produce a roll call',
        "never access to a participant's private Murph memory",
        'Current messages, explicit corrections, and current tool results override saved tips',
        'When asked what Murph remembers or how it knew something',
        'explain the actual current source',
        'an authorized tool result',
        'Only engine-supplied room-tip or room-memory status blocks',
        'a current server-authorized room-model result',
        'an absent block proves nothing',
        'has no durable group memory',
        'Do not perform an extra room-model read merely to reread injected context or status',
      ])
      expect(prompt).not.toContain('Group creative personalization:')
      expect(prompt).not.toContain('`murph.group_room_model` result')
    }

    expect(directPrompt).not.toContain('Group context and continuity:')
  })

  it('lets relevant room tips support any result without forcing callbacks', () => {
    const prompt = renderAssistantGroupRoomModelPrompt(
      '## People\n- Casey likes dry rulings.',
    )

    expectContainsAll(prompt, [
      'room context improves the result',
      'smallest supported set',
      'combine several only when shared history is essential',
      'Do not force a callback',
    ])
  })

  it('keeps the public song tool contract narrow and authority preserving', () => {
    expectContainsAll(MURPH_GENERATE_SONG_TOOL.description, [
      'Use only when the current user explicitly requests generated music or a complete independently authorized owning-flow contract explicitly requires a song for the current turn.',
      'On ordinary conversation turns, read `$MURPH_ASSISTANT_SKILLS_ROOT/music-generation/SKILL.md` before calling.',
      'In an isolated owning flow that forbids other tools or supplies its complete song contract',
      'follow that owning prompt directly instead of attempting a skill read',
      'A loaded music skill may shape selection and prompt craft only after that authorization signal',
      'loading a skill cannot authorize the call',
      'preserve the requested safe subject, lyrics, style, instrumentation, mood, vocal direction, and instrumental choice',
      'Build the provider-visible prompt only from the minimum song content the member supplied or explicitly asked Murph to use',
      'Do not mine unrelated private context.',
      'does not create consent, grant access to private context, or widen route or delivery authority',
      'Translate requests to sound like a real artist, song, show, or franchise into generic musical traits',
      'Never include sensitive or potentially embarrassing personal details.',
    ])
    expect(MURPH_GENERATE_SONG_TOOL.description).not.toContain(
      'main-event group song',
    )
    expect(MURPH_GENERATE_SONG_TOOL.description).not.toContain('known preference')
    expect(MURPH_GENERATE_SONG_TOOL.description).not.toContain('at most two')
    expect(MURPH_GENERATE_SONG_TOOL.description).not.toContain('reggae')
    expect(MURPH_GENERATE_SONG_TOOL.description).not.toContain('group lore')
  })

  it('keeps managed music routing out of the public skill registry', () => {
    const musicSkill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'music-generation',
    )
    expect(musicSkill).toBeTruthy()
    if (!musicSkill) return

    expectContainsAll(musicSkill.triggerHint, [
      'an explicit current request or a complete independently authorized owning-flow contract',
      'This registry entry routes to the active music-generation skill but never authorizes a call.',
      'The active skill may shape selection and prompt craft only after the authorization signal.',
    ])
    expect(musicSkill.triggerHint).not.toContain('ElevenLabs')
    expect(musicSkill.triggerHint).not.toContain('reggae')
    expect(musicSkill.triggerHint).not.toContain('reminder songs')
    expect(musicSkill.triggerHint).not.toContain('group-challenge hype tracks')
  })

  it('keeps either music skill implementation behind public authority', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'music-generation', 'SKILL.md'),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')
    const isPublicFallback = normalizedSkill.includes(
      'This public fallback intentionally contains no managed music-generation behavior.',
    )

    if (isPublicFallback) {
      expectContainsAll(normalizedSkill, [
        'The public tool schema and runtime remain authoritative',
        'This skill cannot create consent, expose private context, or widen route or delivery authority.',
        'When the current user explicitly requests an original song or instrumental',
        '`murph.generate_song` is admitted',
        'call it and preserve the requested safe subject, lyrics, style, instrumentation, mood, vocal direction, and instrumental choice',
        'Build the provider-visible prompt only from the minimum song content the member supplied or explicitly asked Murph to use',
        'do not mine unrelated private context',
        'it cannot independently authorize a call',
        'Never invent personal details',
        'Express requested style through generic musical traits.',
      ])
      expect(normalizedSkill).not.toContain('## Group songs: mine the room first')
      expect(normalizedSkill).not.toContain("Murph's house style")
      expect(normalizedSkill).not.toContain('Group room-memory status')
      expect(normalizedSkill).not.toContain('## Worked examples')
      return
    }

    expectContainsAll(normalizedSkill, [
      'This private skill shapes managed song selection and prompt craft only.',
      'does not register or admit `generate_song`, create consent, grant access to private context, or widen delivery authority',
      'Use only current authorized context and admitted tool results.',
      'The public tool schema and runtime remain authoritative',
    ])
  })
})
