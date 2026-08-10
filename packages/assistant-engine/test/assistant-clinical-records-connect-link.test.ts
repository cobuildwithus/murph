import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
  AssistantHostedUserActionScope,
} from '../src/assistant/hosted-tool-context.js'

const CONNECT_URL =
  `https://app.example.test/records/connect#clinicalRecordsIntent=cr_${'a'.repeat(32)}`

describe('assistant Clinical Records connect-link tool', () => {
  it('is default-off and accepts only an empty object', () => {
    expect(resolveMurphDynamicTools({ clinicalRecordsConnectLinkAvailable: true }))
      .toContain(MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL)
    expect(resolveMurphDynamicTools({ clinicalRecordsConnectLinkAvailable: false }))
      .not.toContain(MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL)

    expect(readConnectLinkRequest({})).toEqual({
      kind: 'create-clinical-records-connect-link',
    })
    expect(readConnectLinkRequest({ memberId: 'member_other' })?.kind)
      .toBe('invalid-clinical-records-connect-link-arguments')
    expect(readConnectLinkRequest({ provider: 'epic' })?.kind)
      .toBe('invalid-clinical-records-connect-link-arguments')
  })

  it('creates a bound link from current user input and forwards cancellation', async () => {
    const controller = new AbortController()
    const createConnectLink = vi.fn(async () => ({
      connectUrl: CONNECT_URL,
      expiresAt: '2026-07-16T12:15:00.000Z',
      ok: true as const,
    }))
    const request = readConnectLinkRequest({})
    if (!request) {
      throw new Error('Expected a Clinical Records connect-link request.')
    }

    const result = await executeMurphDynamicToolRequest({
      abortSignal: controller.signal,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ createConnectLink }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(createConnectLink).toHaveBeenCalledWith({ signal: controller.signal })
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems[0]?.text).toContain(CONNECT_URL)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '2026-07-16T12:15:00.000Z',
    )
    expect(result.rpcResult.contentItems[0]?.text).not.toContain('"ok"')
  })

  it('rechecks private current-user authority at execution', async () => {
    const createConnectLink = vi.fn(async () => ({
      connectUrl: CONNECT_URL,
      expiresAt: '2026-07-16T12:15:00.000Z',
      ok: true as const,
    }))
    const request = readConnectLinkRequest({})
    if (!request) {
      throw new Error('Expected a Clinical Records connect-link request.')
    }

    for (const userActionScope of [
      null,
      createUserActionScope('group'),
      { ...createUserActionScope('direct'), acceptedInputIds: [] },
    ] as const) {
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createHostedToolContext({
          createConnectLink,
          userActionScope,
        }),
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request,
      })
      expect(result.rpcResult.success).toBe(false)
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'current user input in a private conversation',
      )
    }
    expect(createConnectLink).not.toHaveBeenCalled()
  })

  it('keeps transport failures private', async () => {
    const sensitiveFailure = 'database failure for private member record'
    const request = readConnectLinkRequest({})
    if (!request) {
      throw new Error('Expected a Clinical Records connect-link request.')
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        createConnectLink: vi.fn(async () => {
          throw new Error(sensitiveFailure)
        }),
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toBe(
      'Clinical Records connection link could not be created',
    )
    expect(result.rpcResult.contentItems[0]?.text).not.toContain(sensitiveFailure)
  })
})

function readConnectLinkRequest(args: unknown) {
  return readTestMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: args,
      namespace: 'murph',
      tool: 'create_clinical_records_connect_link',
    },
  })
}

function createHostedToolContext(input: {
  createConnectLink: NonNullable<
    AssistantHostedToolContext['clinicalRecordsConnectLinkTool']
  >['createConnectLink']
  userActionScope?: AssistantHostedUserActionScope | null
}): AssistantHostedToolContext {
  return {
    clinicalRecordsConnectLinkTool: {
      createConnectLink: input.createConnectLink,
    },
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () =>
      input.userActionScope === undefined
        ? createUserActionScope('direct')
        : input.userActionScope,
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
  }
}

function createUserActionScope(
  conversationScope: AssistantHostedUserActionScope['conversationScope'],
): AssistantHostedUserActionScope {
  return {
    acceptedInputIds: ['ain_current_user'],
    conversationId: 'conversation_current_user',
    conversationScope,
    inboundMailboxItemIds: ['mailbox_current_user'],
    originSessionId: 'session_current_user',
    recipientKey: 'recipient_current_user',
  }
}
