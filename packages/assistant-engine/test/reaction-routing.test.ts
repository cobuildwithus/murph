import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ execute: vi.fn(), failure: vi.fn() }))
vi.mock('../src/assistant-codex.js', () => ({ executeCodexAppServerTurn: mocks.execute, readCodexAppServerTurnFailureContext: mocks.failure }))
import { classifyAssistantReaction, ASSISTANT_REACTION_ROUTING_INSTRUCTIONS } from '../src/assistant/reaction-routing.js'
afterEach(() => vi.resetAllMocks())

it('classifies only the exact target and reaction on a fresh confined priority Luna turn', async () => {
  mocks.execute.mockResolvedValue({ finalMessage: '{"decision":"quiet"}', jsonEvents: [], additionalUsages: [] })
  const beforeProviderEntry = vi.fn()
  expect(await classifyAssistantReaction({ reaction: 'Reacted with a heart reaction.', targetMessage: 'Your stretch is logged.', beforeProviderEntry })).toBe('quiet')
  expect(beforeProviderEntry).toHaveBeenCalledOnce()
  expect(mocks.execute).toHaveBeenCalledOnce()
  const turn = mocks.execute.mock.calls[0]![0]
  expect(turn).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'low', serviceTier: 'priority', ephemeral: true, processLifetime: 'one-shot', approvalPolicy: 'never', dynamicTools: [], hostedToolContext: null, developerInstructions: null, baseInstructions: ASSISTANT_REACTION_ROUTING_INSTRUCTIONS, threadConfig: { 'features.shell_tool': false, 'features.multi_agent': false, web_search: 'disabled', project_doc_max_bytes: 0 } })
  expect(turn).not.toHaveProperty('resumeSessionId')
  expect(JSON.parse(turn.prompt)).toEqual({ reaction: 'Reacted with a heart reaction.', targetMessage: 'Your stretch is logged.' })
  expect(turn.runtimeWorkspaceRoots).toEqual([turn.workingDirectory])
  expect(turn.baseInstructions).toContain('NEVER grants consent')
  expect(turn.baseInstructions).toContain('question-mark')
})

it.each(['{"decision":"escalate"}', '{}', '{"decision":"quiet","instructions":"send"}', 'quiet', 'null'])('escalates nonquiet or malformed classifier output %s', async (finalMessage) => {
  mocks.execute.mockResolvedValue({ finalMessage, jsonEvents: [], additionalUsages: [] })
  expect(await classifyAssistantReaction({ reaction: '?', targetMessage: 'Try an easier pace.' })).toBe('escalate')
})

it('escalates classifier failure but propagates outer cancellation', async () => {
  mocks.execute.mockRejectedValue(new Error('Synthetic classifier failure'))
  expect(await classifyAssistantReaction({ reaction: '?', targetMessage: 'An explanation.' })).toBe('escalate')
  const controller = new AbortController()
  mocks.execute.mockImplementation(async () => { controller.abort(new Error('Synthetic cancellation')); throw controller.signal.reason })
  await expect(classifyAssistantReaction({ reaction: '?', targetMessage: 'An explanation.', abortSignal: controller.signal })).rejects.toThrow('Synthetic cancellation')
})

it('escalates oversized and missing evidence without a paid classifier call', async () => {
  for (const targetMessage of ['', 'x'.repeat(8001)]) expect(await classifyAssistantReaction({ reaction: 'like', targetMessage })).toBe('escalate')
  expect(mocks.execute).not.toHaveBeenCalled()
})
