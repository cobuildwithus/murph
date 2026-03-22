import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_AGENTMAIL_BASE_URL = 'https://api.agentmail.to/v0'

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
  return (
    normalizeNullableString(env.HEALTHYBOB_AGENTMAIL_API_KEY) ??
    normalizeNullableString(env.AGENTMAIL_API_KEY)
  )
}

export function resolveAgentmailBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_AGENTMAIL_BASE_URL) ??
    normalizeNullableString(env.AGENTMAIL_BASE_URL)
  )
}

export function createAgentmailApiClient(
  apiKey: string,
  dependencies: AgentmailApiClientDependencies = {},
): AgentmailApiClient {
  const normalizedApiKey = normalizeNullableString(apiKey)
  if (!normalizedApiKey) {
    throw new VaultCliError(
      'AGENTMAIL_API_KEY_REQUIRED',
      'AgentMail access requires HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY.',
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

    let response: AgentmailFetchResponse
    try {
      response = await fetchImplementation(url.toString(), {
        method: input.method,
        headers: {
          authorization: `Bearer ${normalizedApiKey}`,
          ...(input.body ? { 'content-type': 'application/json' } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
      })
    } catch (error) {
      throw new VaultCliError(
        'AGENTMAIL_REQUEST_FAILED',
        `AgentMail request ${input.method} ${input.path} failed before a response was returned.`,
        { error: errorMessage(error) },
      )
    }

    if (!response.ok) {
      throw await createAgentmailHttpError(response, input.method, input.path)
    }

    return (await response.json()) as T
  }

  return {
    apiKey: normalizedApiKey,
    baseUrl,

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
          { error: errorMessage(error) },
        )
      }

      if (!response.ok) {
        throw await createAgentmailHttpError(response, 'GET', url)
      }

      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

async function createAgentmailHttpError(
  response: AgentmailFetchResponse,
  method: string,
  path: string,
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
    { status: response.status },
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

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}
