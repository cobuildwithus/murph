import { describe, expect, it, vi } from 'vitest'
import { executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { MURPH_LEAVE_GROUP_TOOL } from '../src/assistant-codex/dynamic-tools/leave-group.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.js'

const inputId = `ain_${'a'.repeat(32)}`
const args = { reason: 'asked_to_leave', messageRef: inputId }
const parse = (arguments_: unknown) => readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: { namespace: 'murph', tool: 'leave_group', arguments: arguments_ } })!
const port = vi.fn()
function context(): AssistantHostedToolContext {
  return { computerToolsAvailable: false, vaultFileSendAvailable: false, groupTool: { request: port },
    currentUserActionScope: () => ({ conversationScope: 'group', resultNotificationChannel: 'linq', acceptedInputIds: [inputId],
      originSessionId: 'synthetic-session', conversationId: null, recipientKey: null, inboundMailboxItemIds: [] }),
    currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [], sendVaultFile: async () => { throw new Error('Unavailable') } }
}
const execute = (ctx = context()) => executeMurphDynamicToolRequest({ request: parse(args), hostedToolContext: ctx,
  env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null })

describe('leave group tool', () => {
  it('declares a strict bounded schema and requires explicit availability', () => {
    expect(MURPH_LEAVE_GROUP_TOOL.inputSchema).toMatchObject({ additionalProperties: false, required: ['reason', 'messageRef'],
      properties: { messageRef: { minLength: 1, maxLength: 128 }, reason: { enum: ['bot_loop', 'spam', 'no_real_members', 'asked_to_leave'] } } })
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_LEAVE_GROUP_TOOL)
    expect(resolveMurphDynamicTools({ leaveGroupAvailable: true })).toContain(MURPH_LEAVE_GROUP_TOOL)
  })
  it.each([{}, { reason: 'other', messageRef: inputId }, { ...args, messageRef: '' }, { ...args, messageRef: 'a'.repeat(129) },
    ...['target', 'line', 'force', 'text', 'linqThread'].map(key => ({ ...args, [key]: 'untrusted' }))])('rejects invalid arguments %#', invalid => {
    expect(parse(invalid).kind).toBe('invalid-tool-arguments')
  })
  it.each(['left', 'already_left'] as const)('makes %s terminal without claiming provider removal', async status => {
    port.mockReset().mockResolvedValue({ action: 'leave_group', result: { status } })
    expect(await execute()).toMatchObject({ finalActionPatch: { kind: 'none', owner: 'leave-group' } })
    expect(port).toHaveBeenCalledExactlyOnceWith({ action: 'leave_group', reason: args.reason, origin: { kind: 'accepted_input', assistantInputId: inputId } })
  })
  it('keeps an unavailable result answerable', async () => {
    port.mockReset().mockResolvedValue({ action: 'leave_group', result: { status: 'unavailable', reason: 'game_bound' } })
    const result = await execute()
    expect(result.finalActionPatch).toBeUndefined()
    expect(result.rpcResult.contentItems[0]?.text).toContain('game_bound')
  })
  it.each(['direct', 'telegram', 'missing', 'foreign'] as const)('rejects %s authority', async kind => {
    port.mockReset()
    const ctx = context(), scope = ctx.currentUserActionScope!()!
    ctx.currentUserActionScope = () => kind === 'missing' ? null : ({ ...scope,
      ...(kind === 'direct' ? { conversationScope: 'direct' as const } : {}),
      ...(kind === 'telegram' ? { resultNotificationChannel: 'telegram' as const } : {}),
      ...(kind === 'foreign' ? { acceptedInputIds: ['another-input'] } : {}) })
    expect((await execute(ctx)).rpcResult.success).toBe(false)
    expect(port).not.toHaveBeenCalled()
  })
})
