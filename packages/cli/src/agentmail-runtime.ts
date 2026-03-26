import { errorMessage, normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_AGENTMAIL_BASE_URL = 'https://api.agentmail.to/v0'
const AGENTMAIL_REQUEST_TIMEOUT_MS = 30_000
const AGENTMAIL_HTTP_MAX_ATTEMPTS = 3
const AGENTMAIL_HTTP_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000])

export interface AgentmailInbox {
  pod_id?: string | null
  inbox_id: string
  email: string
  updated_at?: string | null
  created_at?: string | null
  display_name?: string | null
  client_id?: string | null
}

export interface AgentmailMessageAttachment {
  attachment_id: string
  size?: number | null
  filename?: string | null
  content_type?: string | null
  content_disposition?: string | null
  content_id?: string | null
}

export interface AgentmailMessage {
  inbox_id: string
  thread_id: string
  message_id: string
  labels?: string[] | null
  timestamp?: string | null
  from?: string | null
  to?: string[] | null
  size?: number | null
  updated_at?: string | null
  created_at?: string | null
  reply_to?: string[] | null
  cc?: string[] | null
  bcc?: string[] | null
  subject?: string | null
  preview?: string | null
  text?: string | null
  html?: string | null
  extracted_text?: string | null
  extracted_html?: string | null
  attachments?: AgentmailMessageAttachment[] | null
  in_reply_to?: string | null
  references?: string[] | null
  headers?: Record<string, string> | null
}

export interface AgentmailThread {
  inbox_id: string
  thread_id: string
  labels?: string[] | null
  timestamp?: string | null
  senders?: string[] | null
  recipients?: string[] | null
  last_message_id?: string | null
  message_count?: number | null
  size?: number | null
  updated_at?: string | null
  created_at?: string | null
  messages?: AgentmailMessage[] | null
  received_timestamp?: string | null
  sent_timestamp?: string | null
  subject?: string | null
  preview?: string | null
  attachments?: AgentmailMessageAttachment[] | null
}

export interface AgentmailListInboxesResponse {
  count: number
  inboxes: AgentmailInbox[]
  limit?: number | null
  next_page_token?: string | null
}

export interface ListAgentmailInboxesInput {
  limit?: number | null
  pageToken?: string | null
  ascending?: boolean | null
}

export interface AgentmailListMessagesResponse {
  count: number
  messages: AgentmailMessage[]
  limit?: number | null
  next_page_token?: string | null
}

export interface AgentmailAttachmentDownload {
  attachment_id: string
  size?: number | null
  download_url: string
  expires_at?: string | null
  filename?: string | null
  content_type?: string | null
  content_disposition?: string | null
  content_id?: string | null
}

export interface AgentmailMessageMutationResult {
  message_id: string
  thread_id: string
}

export interface AgentmailFetchResponse {
  arrayBuffer(): Promise<ArrayBuffer>
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export type AgentmailFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<AgentmailFetchResponse>

export interface AgentmailApiClientDependencies {
  baseUrl?: string | null
  fetchImplementation?: AgentmailFetch
}

export interface CreateAgentmailInboxInput {
  username?: string | null
  domain?: string | null
  displayName?: string | null
  clientId?: string | null
}

export interface SendAgentmailMessageInput {
  inboxId: string
  to: string | readonly string[]
  subject?: string | null
  text?: string | null
  html?: string | null
  cc?: string | readonly string[] | null
  bcc?: string | readonly string[] | null
  replyTo?: string | readonly string[] | null
  labels?: readonly string[] | null
}

export interface ReplyToAgentmailMessageInput {
  inboxId: string
  messageId: string
  text?: string | null
  html?: string | null
  to?: string | readonly string[] | null
  cc?: string | readonly string[] | null
  bcc?: string | readonly string[] | null
  replyTo?: string | readonly string[] | null
  replyAll?: boolean | null
  labels?: readonly string[] | null
}

export interface UpdateAgentmailMessageInput {
  inboxId: string
  messageId: string
  addLabels?: readonly string[] | null
  removeLabels?: readonly string[] | null
}

export interface ListAgentmailMessagesInput {
  inboxId: string
  limit?: number | null
  pageToken?: string | null
  labels?: readonly string[] | null
  before?: string | null
  after?: string | null
  ascending?: boolean | null
  includeSpam?: boolean | null
  includeBlocked?: boolean | null
  includeTrash?: boolean | null
}

export interface GetAgentmailMessageInput {
  inboxId: string
  messageId: string
}

export interface GetAgentmailAttachmentInput {
  inboxId: string
  messageId: string
  attachmentId: string
}

export interface AgentmailApiClient {
  readonly apiKey: string
  readonly baseUrl: string
  listInboxes(signal?: AbortSignal): Promise<AgentmailListInboxesResponse>
  listInboxes(
    input: ListAgentmailInboxesInput,
    signal?: AbortSignal,
  ): Promise<AgentmailListInboxesResponse>
  getInbox(inboxId: string, signal?: AbortSignal): Promise<AgentmailInbox>
  createInbox(input?: CreateAgentmailInboxInput, signal?: AbortSignal): Promise<AgentmailInbox>
  sendMessage(
    input: SendAgentmailMessageInput,
    signal?: AbortSignal,
  ): Promise<AgentmailMessageMutationResult>
  replyToMessage(
    input: ReplyToAgentmailMessageInput,
    signal?: AbortSignal,
  ): Promise<AgentmailMessageMutationResult>
  getThread(threadId: string, signal?: AbortSignal): Promise<AgentmailThread>
  listMessages(
    input: ListAgentmailMessagesInput,
    signal?: AbortSignal,
  ): Promise<AgentmailListMessagesResponse>
  getMessage(input: GetAgentmailMessageInput, signal?: AbortSignal): Promise<AgentmailMessage>
  updateMessage(
    input: UpdateAgentmailMessageInput,
    signal?: AbortSignal,
  ): Promise<AgentmailMessage>
  getAttachment(
    input: GetAgentmailAttachmentInput,
    signal?: AbortSignal,
  ): Promise<AgentmailAttachmentDownload>
  downloadUrl(downloadUrl: string, signal?: AbortSignal): Promise<Uint8Array>
}

export function resolveAgentmailApiKey(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.AGENTMAIL_API_KEY)
}

export function resolveAgentmailBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.AGENTMAIL_BASE_URL)
}

export function createAgentmailApiClient(
  apiKey: string,
  dependencies: AgentmailApiClientDependencies = {},
): AgentmailApiClient {
  const normalizedApiKey = normalizeNullableString(apiKey)
  if (!normalizedApiKey) {
    throw new VaultCliError(
      'AGENTMAIL_API_KEY_REQUIRED',
      'AgentMail access requires AGENTMAIL_API_KEY.',
    )
  }

  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'AGENTMAIL_UNAVAILABLE',
      'AgentMail access requires fetch support in the current Node.js runtime.',
    )
  }

  const baseUrl = normalizeAgentmailBaseUrl(
    dependencies.baseUrl ?? DEFAULT_AGENTMAIL_BASE_URL,
  )

  const request = async <T>(input: {
    path: string
    method: 'GET' | 'PATCH' | 'POST'
    body?: Record<string, unknown> | null
    query?: URLSearchParams | null
    signal?: AbortSignal
  }): Promise<T> => {
    const url = new URL(input.path.replace(/^\//u, ''), `${baseUrl}/`)
    if (input.query) {
      url.search = input.query.toString()
    }

    let attempt = 1

    while (true) {
      let response: AgentmailFetchResponse

      try {
        response = await fetchAgentmailResponse({
          body: input.body ?? undefined,
          fetchImplementation,
          headers: {
            authorization: `Bearer ${normalizedApiKey}`,
            ...(input.body ? { 'content-type': 'application/json' } : {}),
          },
          method: input.method,
          path: input.path,
          signal: input.signal,
          url: url.toString(),
        })
      } catch (error) {
        if (isRetryableAgentmailError(error) && attempt < AGENTMAIL_HTTP_MAX_ATTEMPTS) {
          await waitForAgentmailRetryDelay(attempt, input.signal)
          attempt += 1
          continue
        }

        throw error
      }

      if (!response.ok) {
        const failure = await createAgentmailHttpError(
          response,
          input.method,
          input.path,
          input.body ?? undefined,
        )
        if (isRetryableAgentmailError(failure) && attempt < AGENTMAIL_HTTP_MAX_ATTEMPTS) {
          await waitForAgentmailRetryDelay(attempt, input.signal)
          attempt += 1
          continue
        }

        throw failure
      }

      return (await response.json()) as T
    }
  }

  return {
    apiKey: normalizedApiKey,
    baseUrl,

    async listInboxes(
      inputOrSignal?: ListAgentmailInboxesInput | AbortSignal,
      signal?: AbortSignal,
    ) {
      const input = isAbortSignal(inputOrSignal) ? undefined : inputOrSignal
      const resolvedSignal = isAbortSignal(inputOrSignal) ? inputOrSignal : signal
      const query = new URLSearchParams()
      if (input?.limit !== undefined && input.limit !== null) {
        query.set('limit', String(Math.max(1, Math.floor(input.limit))))
      }
      const pageToken = normalizeNullableString(input?.pageToken)
      if (pageToken) {
        query.set('page_token', pageToken)
      }
      if (typeof input?.ascending === 'boolean') {
        query.set('ascending', String(input.ascending))
      }

      return request<AgentmailListInboxesResponse>({
        path: '/inboxes',
        method: 'GET',
        signal: resolvedSignal,
        query,
      })
    },

    async getInbox(inboxId, signal) {
      return request<AgentmailInbox>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(inboxId, 'inboxId'))}`,
        method: 'GET',
        signal,
      })
    },

    async createInbox(input = {}, signal) {
      return request<AgentmailInbox>({
        path: '/inboxes',
        method: 'POST',
        signal,
        body: compactRecord({
          username: normalizeNullableString(input.username),
          domain: normalizeNullableString(input.domain),
          display_name: normalizeNullableString(input.displayName),
          client_id: normalizeNullableString(input.clientId),
        }),
      })
    },

    async sendMessage(input, signal) {
      return request<AgentmailMessageMutationResult>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages/send`,
        method: 'POST',
        signal,
        body: compactRecord({
          to: normalizeStringListInput(input.to),
          subject: normalizeNullableString(input.subject),
          text: normalizeNullableString(input.text),
          html: normalizeNullableString(input.html),
          cc: normalizeStringListInput(input.cc),
          bcc: normalizeStringListInput(input.bcc),
          reply_to: normalizeStringListInput(input.replyTo),
          labels: normalizeStringArray(input.labels),
        }),
      })
    },

    async replyToMessage(input, signal) {
      return request<AgentmailMessageMutationResult>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages/${encodeURIComponent(normalizeRequiredText(input.messageId, 'messageId'))}/reply`,
        method: 'POST',
        signal,
        body: compactRecord({
          text: normalizeNullableString(input.text),
          html: normalizeNullableString(input.html),
          to: normalizeStringListInput(input.to),
          cc: normalizeStringListInput(input.cc),
          bcc: normalizeStringListInput(input.bcc),
          reply_to: normalizeStringListInput(input.replyTo),
          reply_all:
            typeof input.replyAll === 'boolean' ? input.replyAll : undefined,
          labels: normalizeStringArray(input.labels),
        }),
      })
    },

    async getThread(threadId, signal) {
      return request<AgentmailThread>({
        path: `/threads/${encodeURIComponent(normalizeRequiredText(threadId, 'threadId'))}`,
        method: 'GET',
        signal,
      })
    },

    async listMessages(input, signal) {
      const query = new URLSearchParams()
      if (input.limit !== undefined && input.limit !== null) {
        query.set('limit', String(Math.max(1, Math.floor(input.limit))))
      }
      if (normalizeNullableString(input.pageToken)) {
        query.set('page_token', normalizeRequiredText(input.pageToken!, 'pageToken'))
      }
      for (const label of normalizeStringArray(input.labels) ?? []) {
        query.append('labels', label)
      }
      if (normalizeNullableString(input.before)) {
        query.set('before', normalizeRequiredText(input.before!, 'before'))
      }
      if (normalizeNullableString(input.after)) {
        query.set('after', normalizeRequiredText(input.after!, 'after'))
      }
      if (typeof input.ascending === 'boolean') {
        query.set('ascending', String(input.ascending))
      }
      if (typeof input.includeSpam === 'boolean') {
        query.set('include_spam', String(input.includeSpam))
      }
      if (typeof input.includeBlocked === 'boolean') {
        query.set('include_blocked', String(input.includeBlocked))
      }
      if (typeof input.includeTrash === 'boolean') {
        query.set('include_trash', String(input.includeTrash))
      }

      return request<AgentmailListMessagesResponse>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages`,
        method: 'GET',
        signal,
        query,
      })
    },

    async getMessage(input, signal) {
      return request<AgentmailMessage>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages/${encodeURIComponent(normalizeRequiredText(input.messageId, 'messageId'))}`,
        method: 'GET',
        signal,
      })
    },

    async updateMessage(input, signal) {
      return request<AgentmailMessage>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages/${encodeURIComponent(normalizeRequiredText(input.messageId, 'messageId'))}`,
        method: 'PATCH',
        signal,
        body: compactRecord({
          add_labels: normalizeStringArray(input.addLabels),
          remove_labels: normalizeStringArray(input.removeLabels),
        }),
      })
    },

    async getAttachment(input, signal) {
      return request<AgentmailAttachmentDownload>({
        path: `/inboxes/${encodeURIComponent(normalizeRequiredText(input.inboxId, 'inboxId'))}/messages/${encodeURIComponent(normalizeRequiredText(input.messageId, 'messageId'))}/attachments/${encodeURIComponent(normalizeRequiredText(input.attachmentId, 'attachmentId'))}`,
        method: 'GET',
        signal,
      })
    },

    async downloadUrl(downloadUrl, signal) {
      const url = normalizeRequiredText(downloadUrl, 'downloadUrl')
      let response: AgentmailFetchResponse
      try {
        response = await fetchImplementation(url, {
          method: 'GET',
          signal,
        })
      } catch (error) {
        throw new VaultCliError(
          'AGENTMAIL_DOWNLOAD_FAILED',
          'AgentMail attachment download failed before a response was returned.',
          createAgentmailErrorContext({
            error: errorMessage(error),
            method: 'GET',
            path: url,
          }),
        )
      }

      if (!response.ok) {
        throw await createAgentmailHttpError(response, 'GET', url)
      }

      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

async function fetchAgentmailResponse(input: {
  body?: Record<string, unknown>
  fetchImplementation: AgentmailFetch
  headers: Record<string, string>
  method: 'GET' | 'PATCH' | 'POST'
  path: string
  signal?: AbortSignal
  url: string
}): Promise<AgentmailFetchResponse> {
  const timeout = createTimeoutAbortController(input.signal, AGENTMAIL_REQUEST_TIMEOUT_MS)

  try {
    return await input.fetchImplementation(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: timeout.signal,
    })
  } catch (error) {
    if (input.signal?.aborted) {
      throw error
    }

    throw new VaultCliError(
      'AGENTMAIL_REQUEST_FAILED',
      timeout.timedOut()
        ? `AgentMail request ${input.method} ${input.path} timed out after ${AGENTMAIL_REQUEST_TIMEOUT_MS}ms.`
        : `AgentMail request ${input.method} ${input.path} failed before a response was returned.`,
      createAgentmailErrorContext({
        error: errorMessage(error),
        method: input.method,
        path: input.path,
        retryable: shouldRetryAgentmailTransportFailure(input.method, input.path, input.body),
        timedOut: timeout.timedOut(),
        timeoutMs: AGENTMAIL_REQUEST_TIMEOUT_MS,
      }),
    )
  } finally {
    timeout.cleanup()
  }
}

function shouldRetryAgentmailTransportFailure(
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): boolean {
  return isAgentmailRequestReplaySafe(method, path, body)
}

function shouldRetryAgentmailHttpStatus(
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  status: number,
  body?: Record<string, unknown>,
): boolean {
  if (status === 429) {
    return true
  }

  return (status === 408 || status >= 500) && isAgentmailRequestReplaySafe(method, path, body)
}

function isAgentmailRequestReplaySafe(
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): boolean {
  if (method === 'GET' || method === 'PATCH') {
    return true
  }

  return (
    path === '/inboxes' &&
    typeof body?.client_id === 'string' &&
    normalizeNullableString(body.client_id) !== null
  )
}

function isRetryableAgentmailError(error: unknown): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === 'AGENTMAIL_REQUEST_FAILED' &&
    error.context?.retryable === true
  )
}

async function waitForAgentmailRetryDelay(
  attempt: number,
  signal?: AbortSignal,
): Promise<void> {
  const delay =
    AGENTMAIL_HTTP_RETRY_DELAYS_MS[
      Math.min(Math.max(attempt - 1, 0), AGENTMAIL_HTTP_RETRY_DELAYS_MS.length - 1)
    ] ?? 0

  if (delay <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, delay)

    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createTimeoutAbortController(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  cleanup(): void
  signal: AbortSignal
  timedOut(): boolean
} {
  const controller = new AbortController()
  let didTimeout = false

  const onAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }

  const timeout = setTimeout(() => {
    didTimeout = signal?.aborted !== true
    controller.abort()
  }, timeoutMs)

  return {
    cleanup() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    },
    signal: controller.signal,
    timedOut() {
      return didTimeout
    },
  }
}

function createAbortError(): Error {
  const error = new Error('Operation aborted.')
  error.name = 'AbortError'
  return error
}

async function createAgentmailHttpError(
  response: AgentmailFetchResponse,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<VaultCliError> {
  let payload: unknown = null
  let rawText: string | null = null

  try {
    payload = await response.json()
  } catch {
    try {
      rawText = await response.text()
    } catch {}
  }

  return new VaultCliError(
    'AGENTMAIL_REQUEST_FAILED',
    extractAgentmailErrorMessage(payload, rawText) ??
      `AgentMail request ${method} ${path} failed with HTTP ${response.status}.`,
    createAgentmailErrorContext({
      status: response.status,
      method,
      path,
      retryable: shouldRetryAgentmailHttpStatus(method, path, response.status, body),
    }),
  )
}

function createAgentmailErrorContext(input: {
  status?: number
  method: string
  path: string
  error?: string
  retryable?: boolean
  timedOut?: boolean
  timeoutMs?: number
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      status: input.status,
      method: input.method,
      path: input.path,
      error: input.error,
      retryable: input.retryable,
      timedOut: input.timedOut,
      timeoutMs: input.timeoutMs,
    }).filter(([, value]) => value !== undefined),
  )
}

function extractAgentmailErrorMessage(
  payload: unknown,
  rawText: string | null,
): string | null {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      normalizeNullableString(asString(record.message)) ??
      normalizeNullableString(asString(record.error)) ??
      normalizeNullableString(asString(record.detail))
    )
  }

  return normalizeNullableString(rawText)
}

function normalizeAgentmailBaseUrl(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'AGENTMAIL_BASE_URL_INVALID',
      'AgentMail access requires a non-empty API base URL.',
    )
  }

  return normalized.replace(/\/+$/u, '')
}

export async function listAllAgentmailInboxes(
  client: Pick<AgentmailApiClient, 'listInboxes'>,
  signal?: AbortSignal,
): Promise<AgentmailInbox[]> {
  const inboxesById = new Map<string, AgentmailInbox>()
  const seenPageTokens = new Set<string>()
  let pageToken: string | null = null

  while (true) {
    const listed = await client.listInboxes(pageToken ? { pageToken } : {}, signal)

    for (const inbox of listed.inboxes) {
      if (!inboxesById.has(inbox.inbox_id)) {
        inboxesById.set(inbox.inbox_id, inbox)
      }
    }

    const nextPageToken = normalizeNullableString(listed.next_page_token)
    if (!nextPageToken) {
      return [...inboxesById.values()]
    }

    if (seenPageTokens.has(nextPageToken)) {
      throw new VaultCliError(
        'AGENTMAIL_PAGINATION_INVALID',
        'AgentMail inbox pagination returned a repeated next_page_token.',
        { nextPageToken },
      )
    }

    seenPageTokens.add(nextPageToken)
    pageToken = nextPageToken
  }
}

export function matchesAgentmailHttpError(
  error: unknown,
  input: {
    status?: number
    method?: 'GET' | 'PATCH' | 'POST'
    path?: string
  } = {},
): error is VaultCliError {
  if (!(error instanceof VaultCliError)) {
    return false
  }

  if (error.code !== 'AGENTMAIL_REQUEST_FAILED') {
    return false
  }

  const status = error.context?.status
  const method = error.context?.method
  const path = error.context?.path

  if (input.status !== undefined && status !== input.status) {
    return false
  }

  if (input.method !== undefined && method !== input.method) {
    return false
  }

  if (input.path !== undefined && path !== input.path) {
    return false
  }

  return true
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof (value as { aborted?: unknown }).aborted === 'boolean'
  )
}

function normalizeRequiredText(
  value: string | null | undefined,
  fieldName: string,
): string {
  const normalized = normalizeNullableString(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'invalid_payload',
    `${fieldName} must be a non-empty string.`,
  )
}

function normalizeStringArray(
  values: readonly string[] | null | undefined,
): string[] | undefined {
  if (!values) {
    return undefined
  }

  const normalized = values
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => value !== null)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeStringListInput(
  value: string | readonly string[] | null | undefined,
): string | string[] | undefined {
  if (typeof value === 'string') {
    return normalizeNullableString(value) ?? undefined
  }

  return normalizeStringArray(value)
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entryValue]) => entryValue !== undefined && entryValue !== null,
    ),
  )
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
