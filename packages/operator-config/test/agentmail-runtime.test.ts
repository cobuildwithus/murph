import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  createAgentmailApiClient,
  listAllAgentmailInboxes,
  matchesAgentmailHttpError,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
} from '../src/agentmail-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })
}

test('agentmail helpers trim env values, validate configuration, and shape requests', async () => {
  assert.equal(
    resolveAgentmailApiKey({ AGENTMAIL_API_KEY: '  agentmail-key  ' }),
    'agentmail-key',
  )
  assert.equal(
    resolveAgentmailBaseUrl({ AGENTMAIL_BASE_URL: '  https://agentmail.example.test/v1/  ' }),
    'https://agentmail.example.test/v1/',
  )

  assert.throws(
    () => createAgentmailApiClient('   '),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_API_KEY_REQUIRED',
  )
  assert.throws(
    () => createAgentmailApiClient('key', { baseUrl: '   ' }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_BASE_URL_INVALID',
  )

  const seenRequests: Array<{
    body?: string
    headers: Record<string, string>
    method: string
    url: string
  }> = []

  const client = createAgentmailApiClient('  secret-key  ', {
    baseUrl: ' https://agentmail.example.test/v1/ ',
    fetchImplementation: vi.fn(async (url, init) => {
      seenRequests.push({
        body: init.body,
        headers: init.headers ?? {},
        method: init.method,
        url,
      })

      if (url.endsWith('/inboxes?limit=1&page_token=page-1&ascending=true')) {
        return createJsonResponse({
          count: 1,
          inboxes: [
            {
              email: 'hello@example.test',
              inbox_id: 'inbox-1',
            },
          ],
        })
      }

      if (url.endsWith('/inboxes') && init.method === 'POST') {
        return createJsonResponse({
          client_id: 'client-1',
          email: 'ops@example.test',
          inbox_id: 'created-inbox',
        })
      }

      if (
        url.endsWith(
          '/inboxes/inbox-1/messages?limit=2&page_token=cursor-1&labels=unread&labels=important&before=2026-04-08T12%3A00%3A00.000Z&after=2026-04-01T00%3A00%3A00.000Z&ascending=false&include_spam=true&include_blocked=false&include_trash=true',
        )
      ) {
        return createJsonResponse({
          count: 0,
          messages: [],
        })
      }

      if (url.endsWith('/inboxes/inbox-1/messages/message-1') && init.method === 'PATCH') {
        return createJsonResponse({
          inbox_id: 'inbox-1',
          message_id: 'message-1',
          thread_id: 'thread-1',
        })
      }

      throw new Error(`Unexpected AgentMail request: ${init.method} ${url}`)
    }),
  })

  assert.equal(client.apiKey, 'secret-key')
  assert.equal(client.baseUrl, 'https://agentmail.example.test/v1')

  await client.listInboxes({
    limit: 0,
    pageToken: ' page-1 ',
    ascending: true,
  })
  await client.createInbox({
    username: '   ',
    domain: ' example.test ',
    displayName: ' Murph Ops ',
    clientId: ' client-1 ',
  })
  await client.listMessages({
    inboxId: ' inbox-1 ',
    limit: 2.8,
    pageToken: ' cursor-1 ',
    labels: [' unread ', '   ', 'important'],
    before: ' 2026-04-08T12:00:00.000Z ',
    after: ' 2026-04-01T00:00:00.000Z ',
    ascending: false,
    includeSpam: true,
    includeBlocked: false,
    includeTrash: true,
  })
  await client.updateMessage({
    inboxId: ' inbox-1 ',
    messageId: ' message-1 ',
    addLabels: [' replied ', '   '],
    removeLabels: [' archived '],
  })

  assert.equal(seenRequests.length, 4)
  assert.equal(
    seenRequests[0]?.headers.authorization,
    'Bearer secret-key',
  )
  assert.deepEqual(JSON.parse(seenRequests[1]?.body ?? '{}'), {
    client_id: 'client-1',
    display_name: 'Murph Ops',
    domain: 'example.test',
  })
  assert.deepEqual(JSON.parse(seenRequests[3]?.body ?? '{}'), {
    add_labels: ['replied'],
    remove_labels: ['archived'],
  })
})

test('agentmail retries only replay-safe operations and preserves request failure context', async () => {
  let createAttempts = 0
  let sendAttempts = 0

  const client = createAgentmailApiClient('agentmail-key', {
    fetchImplementation: vi.fn(async (url, init) => {
      if (url.endsWith('/inboxes') && init.method === 'POST') {
        createAttempts += 1
        if (createAttempts === 1) {
          return createJsonResponse(
            {
              detail: 'try again shortly',
            },
            {
              headers: {
                'Retry-After': '0',
              },
              status: 503,
            },
          )
        }

        return createJsonResponse({
          email: 'ops@example.test',
          inbox_id: 'retry-created',
        })
      }

      if (url.endsWith('/inboxes/inbox-1/messages/send')) {
        sendAttempts += 1
        return createJsonResponse(
          {
            error: 'send failed',
          },
          {
            headers: {
              'Retry-After': '0',
            },
            status: 503,
          },
        )
      }

      throw new Error(`Unexpected AgentMail request: ${init.method} ${url}`)
    }),
  })

  assert.deepEqual(
    await client.createInbox({
      clientId: ' stable-client-id ',
      domain: 'example.test',
    }),
    {
      email: 'ops@example.test',
      inbox_id: 'retry-created',
    },
  )
  assert.equal(createAttempts, 2)

  await assert.rejects(
    () =>
      client.sendMessage({
        inboxId: 'inbox-1',
        to: 'hello@example.test',
        text: 'hello',
      }),
    (error) =>
      matchesAgentmailHttpError(error, {
        status: 503,
        method: 'POST',
        path: '/inboxes/inbox-1/messages/send',
      }) &&
      error instanceof VaultCliError &&
      error.context?.retryable === false &&
      error.message === 'send failed',
  )
  assert.equal(sendAttempts, 1)
})

test('agentmail download and pagination helpers surface deterministic failures', async () => {
  const downloadClient = createAgentmailApiClient('agentmail-key', {
    fetchImplementation: vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            message: 'download refused',
          },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('attachment-body', {
          status: 200,
        }),
      ),
  })

  await assert.rejects(
    () => downloadClient.downloadUrl(' https://download.example.test/file-1 '),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_DOWNLOAD_FAILED' &&
      error.context?.path === 'https://download.example.test/file-1',
  )

  await assert.rejects(
    () => downloadClient.downloadUrl('https://download.example.test/file-2'),
    (error) =>
      matchesAgentmailHttpError(error, {
        status: 403,
        method: 'GET',
        path: 'https://download.example.test/file-2',
      }) &&
      error instanceof VaultCliError &&
      error.message === 'download refused',
  )

  assert.deepEqual(
    [...(await downloadClient.downloadUrl('https://download.example.test/file-3'))],
    [...new TextEncoder().encode('attachment-body')],
  )

  const listedPageTokens: Array<string | null> = []
  assert.deepEqual(
    await listAllAgentmailInboxes({
      async listInboxes(
        inputOrSignal?: { pageToken?: string | null } | AbortSignal,
      ) {
        const input =
          inputOrSignal && typeof inputOrSignal === 'object' && 'aborted' in inputOrSignal
            ? undefined
            : inputOrSignal
        listedPageTokens.push(input?.pageToken ?? null)
        if (!input?.pageToken) {
          return {
            count: 2,
            inboxes: [
              { email: 'one@example.test', inbox_id: 'inbox-1' },
              { email: 'two@example.test', inbox_id: 'inbox-2' },
            ],
            next_page_token: 'next-1',
          }
        }

        return {
          count: 2,
          inboxes: [
            { email: 'one@example.test', inbox_id: 'inbox-1' },
            { email: 'three@example.test', inbox_id: 'inbox-3' },
          ],
        }
      },
    }),
    [
      { email: 'one@example.test', inbox_id: 'inbox-1' },
      { email: 'two@example.test', inbox_id: 'inbox-2' },
      { email: 'three@example.test', inbox_id: 'inbox-3' },
    ],
  )
  assert.deepEqual(listedPageTokens, [null, 'next-1'])

  await assert.rejects(
    () =>
      listAllAgentmailInboxes({
        async listInboxes(
          inputOrSignal?: { pageToken?: string | null } | AbortSignal,
        ) {
          const input =
            inputOrSignal && typeof inputOrSignal === 'object' && 'aborted' in inputOrSignal
              ? undefined
              : inputOrSignal
          return {
            count: 1,
            inboxes: [{ email: 'loop@example.test', inbox_id: 'inbox-1' }],
            next_page_token: input?.pageToken ? 'repeat-token' : ' repeat-token ',
          }
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_PAGINATION_INVALID' &&
      error.context?.nextPageToken === 'repeat-token',
  )
})

test('agentmail client covers direct resource methods, unavailable fetch, and error matching edges', async () => {
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', undefined)
  assert.throws(
    () => createAgentmailApiClient('agentmail-key'),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_UNAVAILABLE',
  )
  vi.stubGlobal('fetch', originalFetch)

  const seenRequests: Array<{
    body?: string
    headers?: Record<string, string>
    method: string
    url: string
  }> = []
  const client = createAgentmailApiClient('agentmail-key', {
    fetchImplementation: vi.fn(async (url, init) => {
      seenRequests.push({
        body: init.body,
        headers: init.headers,
        method: init.method,
        url,
      })

      if (url.endsWith('/inboxes/inbox-1') && init.method === 'GET') {
        return createJsonResponse({
          email: 'ops@example.test',
          inbox_id: 'inbox-1',
        })
      }

      if (url.endsWith('/inboxes/inbox-1/messages/send') && init.method === 'POST') {
        return createJsonResponse({
          message_id: 'sent-message',
          thread_id: 'thread-1',
        })
      }

      if (
        url.endsWith('/inboxes/inbox-1/messages/message-1/reply') &&
        init.method === 'POST'
      ) {
        return createJsonResponse({
          message_id: 'reply-message',
          thread_id: 'thread-1',
        })
      }

      if (url.endsWith('/threads/thread-1') && init.method === 'GET') {
        return createJsonResponse({
          inbox_id: 'inbox-1',
          thread_id: 'thread-1',
        })
      }

      if (
        url.endsWith('/inboxes/inbox-1/messages/message-1') &&
        init.method === 'GET'
      ) {
        return createJsonResponse({
          inbox_id: 'inbox-1',
          message_id: 'message-1',
          thread_id: 'thread-1',
        })
      }

      if (
        url.endsWith('/inboxes/inbox-1/messages/message-1/attachments/attachment-1') &&
        init.method === 'GET'
      ) {
        return createJsonResponse({
          attachment_id: 'attachment-1',
          download_url: 'https://download.example.test/file',
        })
      }

      if (url.endsWith('/inboxes') && init.method === 'GET') {
        return createJsonResponse({
          count: 1,
          inboxes: [{ email: 'ops@example.test', inbox_id: 'inbox-1' }],
        })
      }

      if (url.endsWith('/inboxes?ascending=false') && init.method === 'GET') {
        return createJsonResponse({
          count: 1,
          inboxes: [{ email: 'ops@example.test', inbox_id: 'inbox-1' }],
        })
      }

      throw new Error(`Unexpected AgentMail request: ${init.method} ${url}`)
    }),
  })

  const abortController = new AbortController()
  await client.listInboxes(abortController.signal)
  assert.equal(seenRequests[0]?.headers?.authorization, 'Bearer agentmail-key')

  assert.deepEqual(await client.getInbox(' inbox-1 '), {
    email: 'ops@example.test',
    inbox_id: 'inbox-1',
  })
  assert.deepEqual(
    await client.sendMessage({
      inboxId: ' inbox-1 ',
      to: [' first@example.test ', '   ', 'second@example.test'],
      cc: ' cc@example.test ',
      bcc: ['   '],
      html: ' <p>Hello</p> ',
      labels: [' unread ', '   '],
      replyTo: ' reply@example.test ',
      subject: ' Hello ',
    }),
    {
      message_id: 'sent-message',
      thread_id: 'thread-1',
    },
  )
  assert.deepEqual(
    await client.replyToMessage({
      inboxId: ' inbox-1 ',
      messageId: ' message-1 ',
      bcc: ' hidden@example.test ',
      cc: [' team@example.test '],
      html: ' <p>Reply</p> ',
      labels: [' answered '],
      replyAll: true,
      replyTo: [' alias@example.test '],
      text: ' hi ',
      to: '   ',
    }),
    {
      message_id: 'reply-message',
      thread_id: 'thread-1',
    },
  )
  assert.deepEqual(await client.getThread(' thread-1 '), {
    inbox_id: 'inbox-1',
    thread_id: 'thread-1',
  })
  assert.deepEqual(
    await client.getMessage({
      inboxId: ' inbox-1 ',
      messageId: ' message-1 ',
    }),
    {
      inbox_id: 'inbox-1',
      message_id: 'message-1',
      thread_id: 'thread-1',
    },
  )
  assert.deepEqual(
    await client.getAttachment({
      attachmentId: ' attachment-1 ',
      inboxId: ' inbox-1 ',
      messageId: ' message-1 ',
    }),
    {
      attachment_id: 'attachment-1',
      download_url: 'https://download.example.test/file',
    },
  )

  assert.deepEqual(JSON.parse(seenRequests[3]?.body ?? '{}'), {
    bcc: 'hidden@example.test',
    cc: ['team@example.test'],
    html: '<p>Reply</p>',
    labels: ['answered'],
    reply_all: true,
    reply_to: ['alias@example.test'],
    text: 'hi',
  })

  await assert.rejects(
    () => client.getInbox('   '),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'invalid_payload' &&
      error.message === 'inboxId must be a non-empty string.',
  )
  await assert.rejects(
    () => client.downloadUrl('   '),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'invalid_payload' &&
      error.message === 'downloadUrl must be a non-empty string.',
  )

  const httpError = new VaultCliError('AGENTMAIL_REQUEST_FAILED', 'bad request', {
    method: 'GET',
    path: '/inboxes',
    status: 429,
  })
  assert.equal(matchesAgentmailHttpError(httpError), true)
  assert.equal(matchesAgentmailHttpError(httpError, { status: 503 }), false)
  assert.equal(matchesAgentmailHttpError(httpError, { method: 'POST' }), false)
  assert.equal(matchesAgentmailHttpError(httpError, { path: '/threads' }), false)
  assert.equal(matchesAgentmailHttpError(new Error('nope')), false)
})

test('agentmail error handling covers transport failures, retryable GETs, and fallback messages', async () => {
  const transportFailureClient = createAgentmailApiClient('agentmail-key', {
    fetchImplementation: vi.fn(async () => {
      throw new Error('socket closed')
    }),
  })

  await assert.rejects(
    () => transportFailureClient.getInbox('inbox-1'),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_REQUEST_FAILED' &&
      error.context?.method === 'GET' &&
      error.context?.path === '/inboxes/inbox-1' &&
      error.context?.retryable === true &&
      error.context?.timedOut === false &&
      error.message ===
        'AgentMail request GET /inboxes/inbox-1 failed before a response was returned.',
  )

  let getAttempts = 0
  const retryClient = createAgentmailApiClient('agentmail-key', {
    fetchImplementation: vi.fn(async (url, init) => {
      if (url.endsWith('/inboxes/inbox-1') && init.method === 'GET') {
        getAttempts += 1
        if (getAttempts === 1) {
          return createJsonResponse(
            {
              detail: 'back off',
            },
            {
              headers: {
                'Retry-After': '0',
              },
              status: 429,
            },
          )
        }

        return createJsonResponse({
          email: 'retry@example.test',
          inbox_id: 'inbox-1',
        })
      }

      if (url.endsWith('/inboxes/inbox-2') && init.method === 'GET') {
        return createJsonResponse({}, { status: 500 })
      }

      throw new Error(`Unexpected AgentMail request: ${init.method} ${url}`)
    }),
  })

  assert.deepEqual(await retryClient.getInbox('inbox-1'), {
    email: 'retry@example.test',
    inbox_id: 'inbox-1',
  })
  assert.equal(getAttempts, 2)

  await assert.rejects(
    () => retryClient.getInbox('inbox-2'),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'AGENTMAIL_REQUEST_FAILED' &&
      error.message === 'AgentMail request GET /inboxes/inbox-2 failed with HTTP 500.' &&
      error.context?.retryable === true,
  )
})
