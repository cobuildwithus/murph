import { createHash } from 'node:crypto'

import type { AssistantModelSpec } from './model-spec.js'

export interface AssistantResponsesRequestDebugEvent {
  contextManagementPresent: boolean
  gatewayOnlyProviderCount: number
  gatewayTagsCount: number
  gatewayUserPresent: boolean
  gatewayZeroDataRetention: boolean | null
  inputMessageCount: number | null
  inputRoles: string[]
  inputTextFieldCount: number
  inputTextHash: string | null
  inputTextLength: number
  instructionsHash: string | null
  instructionsLength: number | null
  method: string | null
  model: string | null
  payloadTopLevelKeys: string[]
  previousResponseIdPresent: boolean
  providerOptionsHash: string | null
  requestBodyHash: string
  requestBodyLength: number
  requestUrlOrigin: string | null
  requestUrlPath: string | null
  responseFormatHash: string | null
  schema: 'murph.assistant-responses-request-debug.v1'
  textConfigHash: string | null
  toolChoice: string | null
  toolCount: number
  toolNames: string[]
  toolsHash: string | null
  type: 'assistant.responses.request.debug'
}

export interface AssistantResponsesRequestPolicy {
  debugObserver?: (event: AssistantResponsesRequestDebugEvent) => void
  gatewayOnlyProviders?: readonly string[] | null
  gatewayReporting?: {
    tags?: readonly string[]
    user?: string | null
  }
  gatewayZeroDataRetention?: boolean
}

const OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD = 200_000
const ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT = Object.freeze([
  {
    type: 'compaction',
    compact_threshold: OPENAI_RESPONSES_AUTO_COMPACTION_THRESHOLD,
  },
] as const)

type AssistantFetchInput = Parameters<typeof fetch>[0]
type AssistantFetchInit = Parameters<typeof fetch>[1]

export function createAssistantResponsesFetch(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input: AssistantFetchInput, init?: AssistantFetchInit) => {
    const nextInit = await maybeMutateAssistantResponsesRequest(requestPolicy, input, init)
    return await baseFetch(input, nextInit)
  }
}

export async function maybeMutateAssistantResponsesRequest(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<AssistantFetchInit | undefined> {
  if (!shouldMutateAssistantResponsesRequest(input, init)) {
    return init
  }

  const body = await readAssistantFetchBody(input, init)
  if (!body) {
    return init
  }

  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return init
  }

  const nextPayload = applyAssistantResponsesRequestPolicy(payload, requestPolicy)
  const nextBody = nextPayload ? JSON.stringify(nextPayload) : body
  observeAssistantResponsesRequest({
    body: nextBody,
    init,
    input,
    payload: nextPayload ?? payload,
    requestPolicy,
  })

  if (!nextPayload) {
    return init
  }

  return {
    ...init,
    body: nextBody,
  }
}

export function applyAssistantResponsesRequestPolicy(
  payload: Record<string, unknown>,
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  let nextPayload: Record<string, unknown> | null = null

  if (!('context_management' in payload)) {
    nextPayload = {
      ...payload,
      context_management: ASSISTANT_RESPONSES_AUTO_COMPACTION_CONTEXT,
    }
  }

  const gatewayOptions = resolveAssistantGatewayRequestOptions(requestPolicy)

  if (gatewayOptions) {
    const currentProviderOptions = nextPayload?.providerOptions ?? payload.providerOptions
    const nextProviderOptions = isAssistantPlainObject(currentProviderOptions)
      ? {
          ...currentProviderOptions,
        }
      : {}
    const currentGatewayOptions = isAssistantPlainObject(nextProviderOptions.gateway)
      ? {
          ...nextProviderOptions.gateway,
        }
      : {}
    const nextGatewayOptions = {
      ...currentGatewayOptions,
      ...gatewayOptions,
    }

    nextProviderOptions.gateway = nextGatewayOptions
    nextPayload = {
      ...(nextPayload ?? payload),
      providerOptions: nextProviderOptions,
    }
  }

  return nextPayload
}

export function resolveAssistantGatewayRequestOptions(
  requestPolicy: AssistantResponsesRequestPolicy | undefined,
): Record<string, unknown> | null {
  const gatewayOptions: Record<string, unknown> = {}

  if (requestPolicy?.gatewayZeroDataRetention === true) {
    gatewayOptions.zeroDataRetention = true
  }

  const only = normalizeGatewayProviderSlugs(
    requestPolicy?.gatewayOnlyProviders ?? [],
  )
  if (only.length > 0) {
    gatewayOptions.only = only
  }

  const reporting = requestPolicy?.gatewayReporting
  const user = normalizeGatewayReportingString(reporting?.user ?? null)
  const tags = normalizeGatewayReportingTags(reporting?.tags ?? [])

  if (user) {
    gatewayOptions.user = user
  }

  if (tags.length > 0) {
    gatewayOptions.tags = tags
  }

  return Object.keys(gatewayOptions).length > 0 ? gatewayOptions : null
}

export function shouldMutateAssistantResponsesRequest(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): boolean {
  const url = readAssistantFetchUrl(input)
  if (!url) {
    return false
  }

  const method = (
    init?.method ??
    (input instanceof Request ? input.method : 'POST')
  ).toUpperCase()

  if (method !== 'POST') {
    return false
  }

  try {
    return new URL(url).pathname.endsWith('/responses')
  } catch {
    return false
  }
}

export function resolveAssistantApiKey(spec: AssistantModelSpec): string | undefined {
  if (typeof spec.apiKey === 'string' && spec.apiKey.length > 0) {
    return spec.apiKey
  }

  if ('apiKeyEnvValue' in spec) {
    return typeof spec.apiKeyEnvValue === 'string' && spec.apiKeyEnvValue.length > 0
      ? spec.apiKeyEnvValue
      : undefined
  }

  if (typeof spec.apiKeyEnv === 'string' && spec.apiKeyEnv.length > 0) {
    const value = process.env[spec.apiKeyEnv]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return undefined
}

function normalizeGatewayProviderSlugs(providers: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedProviders: string[] = []

  for (const provider of providers) {
    const normalized = normalizeGatewayReportingString(provider)?.toLowerCase() ?? null
    if (
      !normalized ||
      !/^[a-z0-9][a-z0-9._-]*$/u.test(normalized) ||
      seen.has(normalized)
    ) {
      continue
    }

    seen.add(normalized)
    normalizedProviders.push(normalized)
  }

  return normalizedProviders
}

function normalizeGatewayReportingString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeGatewayReportingTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  for (const tag of tags) {
    const normalized = normalizeGatewayReportingString(tag)

    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedTags.push(normalized)
  }

  return normalizedTags
}

function readAssistantFetchUrl(
  input: AssistantFetchInput,
): string | null {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  if (input instanceof Request) {
    return input.url
  }

  return null
}

function observeAssistantResponsesRequest(input: {
  body: string
  init?: AssistantFetchInit
  input: AssistantFetchInput
  payload: Record<string, unknown>
  requestPolicy: AssistantResponsesRequestPolicy | undefined
}): void {
  const observer = input.requestPolicy?.debugObserver
  if (!observer) {
    return
  }

  try {
    observer(
      buildAssistantResponsesRequestDebugEvent({
        body: input.body,
        init: input.init,
        input: input.input,
        payload: input.payload,
      }),
    )
  } catch {
    // Request debug observers must never interfere with the provider call.
  }
}

function buildAssistantResponsesRequestDebugEvent(input: {
  body: string
  init?: AssistantFetchInit
  input: AssistantFetchInput
  payload: Record<string, unknown>
}): AssistantResponsesRequestDebugEvent {
  const urlDetails = readAssistantResponsesRequestUrlDetails(input.input)
  const gatewayOptions = readAssistantJsonObjectPath(input.payload, [
    'providerOptions',
    'gateway',
  ])
  const inputSummary = summarizeAssistantResponsesInput(input.payload.input)
  const toolNames = listAssistantResponsesToolNames(input.payload.tools)
  const instructions = readAssistantString(input.payload.instructions)
  const responseFormat =
    input.payload.response_format ?? input.payload.responseFormat ?? null
  const toolChoice =
    readAssistantString(input.payload.tool_choice)
    ?? readAssistantString(input.payload.toolChoice)

  return {
    contextManagementPresent: 'context_management' in input.payload,
    gatewayOnlyProviderCount: readAssistantStringArray(gatewayOptions?.only).length,
    gatewayTagsCount: readAssistantStringArray(gatewayOptions?.tags).length,
    gatewayUserPresent: readAssistantString(gatewayOptions?.user) !== null,
    gatewayZeroDataRetention:
      typeof gatewayOptions?.zeroDataRetention === 'boolean'
        ? gatewayOptions.zeroDataRetention
        : null,
    inputMessageCount: inputSummary.messageCount,
    inputRoles: inputSummary.roles,
    inputTextFieldCount: inputSummary.textFieldCount,
    inputTextHash:
      inputSummary.textFieldValues.length > 0
        ? hashAssistantResponsesStableJson(inputSummary.textFieldValues)
        : null,
    inputTextLength: inputSummary.textLength,
    instructionsHash: instructions ? hashAssistantResponsesString(instructions) : null,
    instructionsLength: instructions?.length ?? null,
    method: readAssistantResponsesRequestMethod(input.input, input.init),
    model: readAssistantString(input.payload.model),
    payloadTopLevelKeys: Object.keys(input.payload).sort(),
    previousResponseIdPresent:
      readAssistantString(input.payload.previous_response_id) !== null
      || readAssistantString(input.payload.previousResponseId) !== null,
    providerOptionsHash: hashAssistantResponsesJsonValueOrNull(
      input.payload.providerOptions,
    ),
    requestBodyHash: hashAssistantResponsesString(input.body),
    requestBodyLength: input.body.length,
    requestUrlOrigin: urlDetails.origin,
    requestUrlPath: urlDetails.path,
    responseFormatHash: hashAssistantResponsesJsonValueOrNull(responseFormat),
    schema: 'murph.assistant-responses-request-debug.v1',
    textConfigHash: hashAssistantResponsesJsonValueOrNull(input.payload.text),
    toolChoice,
    toolCount: toolNames.length,
    toolNames,
    toolsHash: hashAssistantResponsesJsonValueOrNull(input.payload.tools),
    type: 'assistant.responses.request.debug',
  }
}

function readAssistantResponsesRequestUrlDetails(input: AssistantFetchInput): {
  origin: string | null
  path: string | null
} {
  const url = readAssistantFetchUrl(input)
  if (!url) {
    return {
      origin: null,
      path: null,
    }
  }

  try {
    const parsed = new URL(url)
    return {
      origin: parsed.origin,
      path: parsed.pathname,
    }
  } catch {
    return {
      origin: null,
      path: null,
    }
  }
}

function readAssistantResponsesRequestMethod(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): string | null {
  const method = init?.method ?? (input instanceof Request ? input.method : 'POST')
  return typeof method === 'string' && method.trim().length > 0
    ? method.trim().toUpperCase()
    : null
}

function summarizeAssistantResponsesInput(input: unknown): {
  messageCount: number | null
  roles: string[]
  textFieldCount: number
  textFieldValues: string[]
  textLength: number
} {
  const textFieldValues: string[] = []
  const roles: string[] = []

  collectAssistantResponsesTextFields(input, textFieldValues)
  collectAssistantResponsesRoles(input, roles)

  return {
    messageCount: Array.isArray(input) ? input.length : null,
    roles: [...new Set(roles)].sort(),
    textFieldCount: textFieldValues.length,
    textFieldValues,
    textLength: textFieldValues.reduce((sum, value) => sum + value.length, 0),
  }
}

function listAssistantResponsesToolNames(input: unknown): string[] {
  const tools = Array.isArray(input) ? input : []
  return tools
    .map((tool) => {
      const record = isAssistantPlainObject(tool) ? tool : null
      const functionRecord = isAssistantPlainObject(record?.function)
        ? record.function
        : null
      return readAssistantString(record?.name)
        ?? readAssistantString(functionRecord?.name)
        ?? null
    })
    .filter((name): name is string => name !== null)
    .sort()
}

function collectAssistantResponsesRoles(input: unknown, roles: string[]): void {
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectAssistantResponsesRoles(entry, roles)
    }
    return
  }

  if (!isAssistantPlainObject(input)) {
    return
  }

  const role = readAssistantString(input.role)
  if (role) {
    roles.push(role)
  }

  if ('content' in input) {
    collectAssistantResponsesRoles(input.content, roles)
  }
}

function collectAssistantResponsesTextFields(
  input: unknown,
  values: string[],
): void {
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectAssistantResponsesTextFields(entry, values)
    }
    return
  }

  if (!isAssistantPlainObject(input)) {
    return
  }

  const text = readAssistantString(input.text)
  if (text) {
    values.push(text)
  }

  const content = input.content
  if (typeof content === 'string' && content.trim().length > 0) {
    values.push(content)
    return
  }

  collectAssistantResponsesTextFields(content, values)
}

function readAssistantJsonObjectPath(
  input: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> | null {
  let cursor: unknown = input
  for (const key of path) {
    if (!isAssistantPlainObject(cursor)) {
      return null
    }
    cursor = cursor[key]
  }

  return isAssistantPlainObject(cursor) ? cursor : null
}

function readAssistantString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readAssistantStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : []
}

function hashAssistantResponsesJsonValueOrNull(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : hashAssistantResponsesStableJson(value)
}

function hashAssistantResponsesStableJson(value: unknown): string {
  return hashAssistantResponsesString(stableStringifyAssistantResponsesJson(value))
}

function hashAssistantResponsesString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringifyAssistantResponsesJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyAssistantResponsesJson).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyAssistantResponsesJson(record[key])}`)
    .join(',')}}`
}

async function readAssistantFetchBody(
  input: AssistantFetchInput,
  init?: AssistantFetchInit,
): Promise<string | null> {
  if (typeof init?.body === 'string') {
    return init.body
  }

  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }

  return null
}

function isAssistantPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
