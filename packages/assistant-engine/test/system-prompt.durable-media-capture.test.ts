import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  const input: AssistantSystemPromptInput = {
    assistantCliContract: null,
    channel: null,
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-26',
    currentTimeZone: 'America/Los_Angeles',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
  }

  return buildAssistantSystemPromptLayers(input).stableRouteCapabilityPrompt
}

describe('assistant durable visual media guidance', () => {
  it('routes longitudinal images through canonical capture records instead of ad hoc copies', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'vault-cli capture add --media <readable-file-path> --collection <stable-series-slug> --format json'
    )
    expect(prompt).toContain(
      'vault-cli capture import-json --input @<payload.json> --format json'
    )
    expect(prompt).toContain(
      'canonical capture records with immutable `raw/captures/**` media and manifests'
    )
    expect(prompt).toContain('`raw/inbox/**` media is transient evidence')
    expect(prompt).toContain('actual readable filesystem paths')
    expect(prompt).toContain('vault-relative `raw/inbox/**` storedPath')
    expect(prompt).toContain('Do not use `mkdir`, `cp`, ad hoc experiment folders')
    expect(prompt).toContain(
      'save captures first, then optionally append an experiment checkpoint'
    )
    expect(prompt).toContain('returned capture event ids')
    expect(prompt).toContain('do not claim it was saved')
    expect(prompt).toContain('sensitive documents or media')
    expect(prompt).not.toContain(
      'Save available attachment paths with `vault-cli capture add --media <path>'
    )
  })
})
