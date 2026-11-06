import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAssistantConnectedChannelGreetingInstructions } from '../src/assistant/connected-channel-greeting.js'

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), transcript: vi.fn() }))
vi.mock('../src/assistant/store.js', () => ({
  listAssistantSessions: mocks.sessions,
  listAssistantTranscriptTailEntries: mocks.transcript,
}))
beforeEach(() => vi.resetAllMocks())

describe('connected channel private context', () => {
  it('uses bounded private conversation and excludes groups and outgoing-only welcomes', async () => {
    mocks.sessions.mockResolvedValue([
      { sessionId: 'private-email', binding: { threadIsDirect: true } },
      { sessionId: 'group', binding: { threadIsDirect: false } },
      { sessionId: 'unknown', binding: { threadIsDirect: null } },
      { sessionId: 'welcome-only', binding: { threadIsDirect: true } },
    ])
    mocks.transcript.mockImplementation(async (_vault, sessionId) => sessionId === 'private-email'
      ? [{ kind: 'user', createdAt: '2026-09-12T09:00:00.000Z', text: 'I am looking forward to my weekend walk.' }]
      : [{ kind: 'assistant', createdAt: '2026-09-12T09:00:00.000Z', text: 'PRIVATE_WELCOME_ONLY_SENTINEL' }])
    const instructions = await buildAssistantConnectedChannelGreetingInstructions({ channel: 'linq', vault: 'synthetic-vault' })
    expect(instructions).toContain('weekend walk')
    expect(instructions).not.toContain('PRIVATE_WELCOME_ONLY_SENTINEL')
    expect(instructions).toContain('Do not restart onboarding')
    expect(instructions).toContain('quoted untrusted data')
    expect(mocks.sessions).toHaveBeenCalledWith('synthetic-vault', { limit: 16 })
    expect(mocks.transcript.mock.calls.map((call) => call[1])).toEqual(['private-email', 'welcome-only'])
    expect(mocks.transcript.mock.calls.every((call) => call[2].maxBytes === 16_384)).toBe(true)
  })

  it('permits a simple truthful greeting when old conversation content was retired', async () => {
    mocks.sessions.mockResolvedValue([])
    const instructions = await buildAssistantConnectedChannelGreetingInstructions({ channel: 'email', vault: 'synthetic-vault' })
    expect(instructions).toContain('connected email')
    expect(instructions).toContain('do not invent prior topics or familiarity')
    expect(instructions).toContain('Avoid unsolicited sensitive health details')
    expect(instructions).toContain('Do not schedule, save, send a second message, or use tools')
  })
})
