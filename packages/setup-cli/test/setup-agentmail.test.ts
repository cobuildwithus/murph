import assert from 'node:assert/strict'
import { test } from 'vitest'

import type {
  AgentmailApiClient,
  AgentmailListInboxesResponse,
  AgentmailInbox,
  ListAgentmailInboxesInput,
} from '@murphai/operator-config/agentmail-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createSetupAgentmailSelectionResolver } from '../src/setup-agentmail.ts'

type AgentmailListInboxesForwarder = {
  (signal?: AbortSignal): Promise<AgentmailListInboxesResponse>
  (
    input: ListAgentmailInboxesInput,
    signal?: AbortSignal,
  ): Promise<AgentmailListInboxesResponse>
}

test('setup agentmail selection returns null when the API key is absent', async () => {
  let createClientCalls = 0
  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      createClientCalls += 1
      return createAgentmailClientStub(async () => {
        throw new Error('unexpected')
      })
    },
  })

  assert.equal(
    await resolveSelection({
      allowPrompt: true,
      env: {},
    }),
    null,
  )
  assert.equal(createClientCalls, 0)
})

test('setup agentmail selection discovers a single inbox and trims its email address', async () => {
  let observedBaseUrl: string | undefined
  const inboxes: AgentmailInbox[] = [
    {
      inbox_id: 'inbox-1',
      email: '  user@example.com  ',
      display_name: 'Primary inbox',
    },
  ]

  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient(input) {
      observedBaseUrl = input.baseUrl
      return createAgentmailClientStub(async () => ({
        count: inboxes.length,
        inboxes,
        limit: null,
        next_page_token: null,
      }))
    },
  })

  const selected = await resolveSelection({
    allowPrompt: true,
    env: {
      AGENTMAIL_API_KEY: 'agentmail-api-key',
      AGENTMAIL_BASE_URL: 'https://api.agentmail.test/v0/',
    },
  })

  assert.deepEqual(selected, {
    accountId: 'inbox-1',
    emailAddress: 'user@example.com',
    mode: 'discovered',
  })
  assert.equal(observedBaseUrl, 'https://api.agentmail.test/v0/')
})

test('setup agentmail selection lets the user choose from multiple inboxes', async () => {
  const chosen: AgentmailInbox = {
    inbox_id: 'inbox-2',
    email: 'team@example.com',
    display_name: 'Team inbox',
  }
  const prompter = {
    async chooseInbox() {
      return chosen
    },
    async promptManualInboxId() {
      return null
    },
  }

  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => ({
        count: 2,
        inboxes: [
          {
            inbox_id: 'inbox-1',
            email: 'one@example.com',
            display_name: 'One',
          },
          chosen,
        ],
        limit: null,
        next_page_token: null,
      }))
    },
    prompter,
  })

  const selected = await resolveSelection({
    allowPrompt: true,
    env: {
      AGENTMAIL_API_KEY: 'agentmail-api-key',
    },
  })

  assert.deepEqual(selected, {
    accountId: 'inbox-2',
    emailAddress: 'team@example.com',
    mode: 'selected',
  })
})

test('setup agentmail selection returns null when multiple inboxes exist but prompting is disabled', async () => {
  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => ({
        count: 2,
        inboxes: [
          {
            inbox_id: 'inbox-1',
            email: 'one@example.com',
            display_name: 'One',
          },
          {
            inbox_id: 'inbox-2',
            email: 'two@example.com',
            display_name: 'Two',
          },
        ],
        limit: null,
        next_page_token: null,
      }))
    },
  })

  assert.equal(
    await resolveSelection({
      allowPrompt: false,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-api-key',
      },
    }),
    null,
  )
})

test('setup agentmail selection falls back to manual entry for forbidden inbox discovery', async () => {
  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => {
        throw new VaultCliError('AGENTMAIL_REQUEST_FAILED', 'Forbidden', {
          status: 403,
          method: 'GET',
          path: '/inboxes',
        })
      })
    },
    prompter: {
      async chooseInbox() {
        return null
      },
      async promptManualInboxId() {
        return 'manual-inbox-id'
      },
    },
  })

  const selected = await resolveSelection({
    allowPrompt: true,
    env: {
      AGENTMAIL_API_KEY: 'agentmail-api-key',
    },
  })

  assert.deepEqual(selected, {
    accountId: 'manual-inbox-id',
    emailAddress: null,
    mode: 'manual',
  })
})

test('setup agentmail selection returns null when manual fallback is unavailable or prompting is disabled', async () => {
  const forbiddenError = new VaultCliError(
    'AGENTMAIL_REQUEST_FAILED',
    'Forbidden',
    {
      status: 403,
      method: 'GET',
      path: '/inboxes',
    },
  )
  const resolveSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => {
        throw forbiddenError
      })
    },
    prompter: {
      async chooseInbox() {
        return null
      },
      async promptManualInboxId() {
        return null
      },
    },
  })

  assert.equal(
    await resolveSelection({
      allowPrompt: false,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-api-key',
      },
    }),
    null,
  )
  assert.equal(
    await resolveSelection({
      allowPrompt: true,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-api-key',
      },
    }),
    null,
  )
})

test('setup agentmail selection rethrows non-http failures and wraps non-Error throwables', async () => {
  const rethrowSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => {
        throw new Error('network down')
      })
    },
  })
  await assert.rejects(
    rethrowSelection({
      allowPrompt: true,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-api-key',
      },
    }),
    /network down/u,
  )

  const wrappedSelection = createSetupAgentmailSelectionResolver({
    createClient() {
      return createAgentmailClientStub(async () => {
        throw 'boom'
      })
    },
  })
  await assert.rejects(
    wrappedSelection({
      allowPrompt: true,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-api-key',
      },
    }),
    /boom/u,
  )
})

function createAgentmailClientStub(
  listInboxes: (
    input?: ListAgentmailInboxesInput,
    signal?: AbortSignal,
  ) => Promise<AgentmailListInboxesResponse>,
): AgentmailApiClient {
  return {
    apiKey: 'agentmail-api-key',
    baseUrl: 'https://api.agentmail.test/v0/',
    listInboxes: createAgentmailListInboxesForwarder(listInboxes),
    async getInbox() {
      return {
        inbox_id: 'stub-inbox',
        email: 'stub@example.com',
      }
    },
    async createInbox() {
      return {
        inbox_id: 'stub-inbox',
        email: 'stub@example.com',
      }
    },
    async sendMessage() {
      return {
        message_id: 'stub-message',
        thread_id: 'stub-thread',
      }
    },
    async replyToMessage() {
      return {
        message_id: 'stub-message',
        thread_id: 'stub-thread',
      }
    },
    async getThread() {
      return {
        inbox_id: 'stub-inbox',
        thread_id: 'stub-thread',
      }
    },
    async listMessages() {
      return {
        count: 0,
        messages: [],
        limit: null,
        next_page_token: null,
      }
    },
    async getMessage() {
      return {
        inbox_id: 'stub-inbox',
        thread_id: 'stub-thread',
        message_id: 'stub-message',
      }
    },
    async updateMessage() {
      return {
        inbox_id: 'stub-inbox',
        thread_id: 'stub-thread',
        message_id: 'stub-message',
      }
    },
    async getAttachment() {
      return {
        attachment_id: 'stub-attachment',
        download_url: 'https://example.invalid/attachment',
      }
    },
    async downloadUrl() {
      return new Uint8Array()
    },
  }
}

function createAgentmailListInboxesForwarder(
  listInboxes: (
    input?: ListAgentmailInboxesInput,
    signal?: AbortSignal,
  ) => Promise<AgentmailListInboxesResponse>,
): AgentmailListInboxesForwarder {
  function forward(signal?: AbortSignal): Promise<AgentmailListInboxesResponse>
  function forward(
    input: ListAgentmailInboxesInput,
    signal?: AbortSignal,
  ): Promise<AgentmailListInboxesResponse>
  function forward(
    inputOrSignal?: ListAgentmailInboxesInput | AbortSignal,
    signal?: AbortSignal,
  ): Promise<AgentmailListInboxesResponse> {
    if (isAbortSignal(inputOrSignal)) {
      return listInboxes(undefined, inputOrSignal)
    }

    return listInboxes(inputOrSignal, signal)
  }

  return forward
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof (value as { aborted?: unknown }).aborted === 'boolean'
  )
}
