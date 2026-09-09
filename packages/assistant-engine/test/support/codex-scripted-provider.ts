// Shared credential-free Responses stub for the REAL pinned App Server tests.
// Only the provider wire and isolated fixture setup live here. Production owns
// the App Server, thread lifecycle, scheduling, tool dispatch, and validation.
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTED_STUB_KEY_ENV = 'MURPH_SCRIPTED_STUB_KEY'
export const SCRIPTED_MODEL = 'gpt-5.6-terra'
const SCRIPTED_MODEL_PROVIDER = 'local-stub'
const codexCommand = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/.bin/codex',
)

interface ScriptedResponseRoute {
  beforeRespond?: () => Promise<void>
  completionLabel?: string
  delayMs?: number
  requestExcludes?: readonly string[]
  requestIncludes?: readonly string[]
  usageInputTokens?: number
}

export type ScriptedResponseBody = (
  | { text: string }
  | {
      commentaryAndFunctionCall: {
        commentary: string
        functionCall: {
          arguments: Record<string, unknown>
          name: string
          namespace?: string
        }
      }
    }
  | {
      customToolCall: {
        input: string
        name: string
      }
    }
  | {
      toolSearchCall: {
        limit?: number
        query: string
      }
    }
  | {
      functionCall: {
        arguments: Record<string, unknown>
        name: string
        namespace?: string
      }
    }
)

export type ScriptedResponse = ScriptedResponseRoute & (
  | ScriptedResponseBody
  | { respond: (request: ScriptedProviderRequestSummary) => ScriptedResponseBody }
)

export interface ScriptedStub {
  baseUrl: string
  captureProviderRequestDiagnostics(options?: { completeInput?: boolean }): void
  close(): Promise<void>
  completedResponseLabelsSinceBaseline(): string[]
  markRequestBaseline(): void
  queue(...responses: readonly ScriptedResponse[]): void
  resetQueue(): void
  requestCountSinceBaseline(): number
  requestSummariesSinceBaseline(): ScriptedProviderRequestSummary[]
}

export interface ScriptedProviderRequestSummary {
  completeProviderInput?: { json: string; excludedTransportFields: string[] }
  customToolCallOutputs?: string[]
  functionCallOutputs?: string[]
  imageWidths?: number[]
  model: string | null
  providerRequestDiagnostics?: {
    bytes: number
    sha256: string
    includesAllTools: boolean
    includesExecCommand: boolean
    includesAutomation: boolean
    includesGroup: boolean
    includesPhysicalNoteRecovery: boolean
    includesReadShared: boolean
    includesResponseCardCompactTableShape: boolean
    includesResponseCardNutritionV2Shape: boolean
    includesGroupEmail: boolean
    includesToolSearch: boolean
  }
  serviceTier: string | null
  toolSearchOutputTools?: unknown[]
}

export async function prepareScriptedTurnScenario(
  scriptedStub: ScriptedStub,
  temporaryPaths: string[],
  options: {
    additionalTomlLines?: readonly string[]
    model?: string
    modelProvider?: string
    multiAgentV2?: boolean
  } = {},
): Promise<{
  stub: ScriptedStub
  turnInput: {
    codexCommand: string
    codexHome: string
    env: NodeJS.ProcessEnv
    model: string
    modelProvider: string
    reasoningEffort: string
    sandbox: 'workspace-write'
    workingDirectory: string
  }
}> {
  scriptedStub.markRequestBaseline()
  const modelProvider = options.modelProvider ?? SCRIPTED_MODEL_PROVIDER
  const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-codex-scripted-home-'))
  temporaryPaths.push(codexHome)
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-scripted-workspace-'),
  )
  temporaryPaths.push(workingDirectory)
  await writeFile(
    path.join(codexHome, 'config.toml'),
    buildScriptedCodexConfigToml(scriptedStub.baseUrl, {
      ...options,
      modelProvider,
    }),
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )

  return {
    stub: scriptedStub,
    turnInput: {
      codexCommand,
      codexHome,
      env: {
        [SCRIPTED_STUB_KEY_ENV]: 'scripted-local-key',
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
      },
      model: options.model ?? SCRIPTED_MODEL,
      modelProvider,
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
    },
  }
}

function buildScriptedCodexConfigToml(
  baseUrl: string,
  options: {
    additionalTomlLines?: readonly string[]
    modelProvider?: string
    multiAgentV2?: boolean
  } = {},
): string {
  const modelProvider = options.modelProvider ?? SCRIPTED_MODEL_PROVIDER
  return [
    `model = "${SCRIPTED_MODEL}"`,
    `model_provider = "${modelProvider}"`,
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'check_for_update_on_startup = false',
    '',
    '[history]',
    'persistence = "none"',
    '',
    `[model_providers."${modelProvider}"]`,
    'name = "Local scripted stub"',
    `base_url = "${baseUrl}"`,
    `env_key = "${SCRIPTED_STUB_KEY_ENV}"`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    '',
    ...(options.multiAgentV2
      ? [
          '[features.multi_agent_v2]',
          'enabled = true',
          'expose_spawn_agent_model_overrides = true',
          'max_concurrent_threads_per_session = 4',
          '',
        ]
      : []),
    ...(options.additionalTomlLines ?? []),
  ].join('\n')
}

export async function startScriptedResponsesStub(): Promise<ScriptedStub> {
  const queuedResponses: ScriptedResponse[] = []
  const requestSummaries: ScriptedProviderRequestSummary[] = []
  const completedResponseLabels: string[] = []
  let responseSequence = 0
  let responsesRequestCount = 0
  let requestBaseline = 0
  let requestSummaryBaseline = 0
  let providerRequestDiagnosticsEnabled = false
  let completeProviderInputEnabled = false

  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.statusCode = 404
      response.end(JSON.stringify({ error: `unhandled ${request.method} ${request.url}` }))
      return
    }

    let requestBody = ''
    for await (const chunk of request) {
      requestBody += typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf8')
    }
    responsesRequestCount += 1
    requestSummaries.push(readScriptedProviderRequestSummary(
      requestBody,
      providerRequestDiagnosticsEnabled,
      completeProviderInputEnabled,
    ))
    const scriptedResponseIndex = queuedResponses.findIndex((candidate) =>
      scriptedResponseMatchesRequest(candidate, requestBody)
    )
    const scripted = scriptedResponseIndex >= 0
      ? queuedResponses.splice(scriptedResponseIndex, 1)[0]
      : undefined
    if (!scripted) {
      response.statusCode = 500
      response.end(JSON.stringify({
        error: 'scripted responses stub received a request without a queued response',
      }))
      return
    }

    await scripted.beforeRespond?.()

    if (scripted.delayMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, scripted.delayMs)
      })
    }

    responseSequence += 1
    const responseId = `resp_scripted_${responseSequence}`
    // A local scripted model can choose its next response from the REAL wire
    // output (for example, page through complete generated tool metadata).
    let body: ScriptedResponseBody
    try {
      body = 'respond' in scripted
        ? scripted.respond(requestSummaries[requestSummaries.length - 1]!)
        : scripted
    } catch (error) {
      // Terminate the local turn with the failed assertion, rather than leave
      // an HTTP request hanging until timeout. Metadata guards require their
      // exact success marker, so this cannot turn a failed proof into a pass.
      body = {
        text: `SCRIPTED_RESPONSE_ASSERTION_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
    const outputItems = 'commentaryAndFunctionCall' in body
      ? [
          {
            content: [
              {
                annotations: [],
                text: body.commentaryAndFunctionCall.commentary,
                type: 'output_text',
              },
            ],
            id: `msg_${responseId}_commentary`,
            phase: 'commentary',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
          {
            arguments: JSON.stringify(
              body.commentaryAndFunctionCall.functionCall.arguments,
            ),
            call_id: `call_${responseId}_group_email`,
            id: `fcall_${responseId}_group_email`,
            name: body.commentaryAndFunctionCall.functionCall.name,
            ...(body.commentaryAndFunctionCall.functionCall.namespace
              ? {
                  namespace:
                    body.commentaryAndFunctionCall.functionCall.namespace,
                }
              : {}),
            status: 'completed',
            type: 'function_call',
          },
        ]
      : [
          'toolSearchCall' in body
            ? {
                arguments: {
                  query: body.toolSearchCall.query,
                  ...(body.toolSearchCall.limit === undefined
                    ? {}
                    : { limit: body.toolSearchCall.limit }),
                },
                call_id: `call_${responseId}`,
                execution: 'client',
                id: `tsearch_${responseId}`,
                status: 'completed',
                type: 'tool_search_call',
              }
            : 'customToolCall' in body
              ? {
                  call_id: `call_${responseId}`,
                  id: `ctcall_${responseId}`,
                  input: body.customToolCall.input,
                  name: body.customToolCall.name,
                  status: 'completed',
                  type: 'custom_tool_call',
                }
              : 'functionCall' in body
                ? {
                    arguments: JSON.stringify(body.functionCall.arguments),
                    call_id: `call_${responseId}`,
                    id: `fcall_${responseId}`,
                    name: body.functionCall.name,
                    ...(body.functionCall.namespace
                      ? { namespace: body.functionCall.namespace }
                      : {}),
                    status: 'completed',
                    type: 'function_call',
                  }
                : {
                    content: [
                      {
                        annotations: [],
                        text: body.text,
                        type: 'output_text',
                      },
                    ],
                    id: `msg_${responseId}`,
                    role: 'assistant',
                    status: 'completed',
                    type: 'message',
                  },
        ]
    writeScriptedSseResponse({
      outputItems,
      response,
      responseId,
      usageInputTokens: scripted.usageInputTokens,
    })
    if (scripted.completionLabel) {
      completedResponseLabels.push(scripted.completionLabel)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the scripted responses stub to bind a TCP port.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    captureProviderRequestDiagnostics: (options) => {
      providerRequestDiagnosticsEnabled = true
      completeProviderInputEnabled = options?.completeInput === true
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
    completedResponseLabelsSinceBaseline: () => [...completedResponseLabels],
    markRequestBaseline: () => {
      completedResponseLabels.splice(0)
      providerRequestDiagnosticsEnabled = false
      completeProviderInputEnabled = false
      requestBaseline = responsesRequestCount
      requestSummaryBaseline = requestSummaries.length
    },
    queue: (...responses) => {
      queuedResponses.push(...responses)
    },
    resetQueue: () => {
      queuedResponses.splice(0)
    },
    requestCountSinceBaseline: () => responsesRequestCount - requestBaseline,
    requestSummariesSinceBaseline: () =>
      requestSummaries.slice(requestSummaryBaseline),
  }
}

function scriptedResponseMatchesRequest(
  response: ScriptedResponse,
  requestBody: string,
): boolean {
  return (response.requestIncludes ?? []).every((value) =>
    requestBody.includes(value)
  ) && (response.requestExcludes ?? []).every((value) =>
    !requestBody.includes(value)
  )
}

function readScriptedProviderRequestSummary(
  requestBody: string,
  includeDiagnostics: boolean,
  includeCompleteInput = false,
): ScriptedProviderRequestSummary {
  const body = readRecord(JSON.parse(requestBody))
  const customToolCallOutputs = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'custom_tool_call_output')
      .map((item) => readProviderToolOutputText(item?.output))
      .filter((output): output is string => output !== null)
    : []
  const functionCallOutputs = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'function_call_output')
      .map((item) => readString(item?.output))
      .filter((output): output is string => output !== null)
    : []
  const toolSearchOutputTools = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'tool_search_output')
      .flatMap((item) => Array.isArray(item?.tools) ? item.tools : [])
    : []
  const imageWidths = Array.isArray(body?.input)
    ? body.input.flatMap((inputItem) => {
        const content = readRecord(inputItem)?.content
        if (!Array.isArray(content)) {
          return []
        }
        return content
          .map(readRecord)
          .filter((item) => item?.type === 'input_image')
          .map((item) => readString(item?.image_url))
          .filter((imageUrl): imageUrl is string => imageUrl !== null)
          .map(readPngDataUrlWidth)
          .filter((width): width is number => width !== null)
      })
    : []
  const directTools = Array.isArray(body?.tools)
    ? body.tools.map(readRecord)
    : []
  const additionalTools = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'additional_tools')
      .flatMap((item) =>
        Array.isArray(item?.tools) ? item.tools.map(readRecord) : []
      )
    : []
  const tools = [...directTools, ...additionalTools]
  // Opt-in local fake-provider measurement only. Keep ALL request fields and
  // values except the new thread's transport cache identity. Canonicalize JSON
  // object order, not array order or model-visible text. No request is printed.
  let completeProviderInput: ScriptedProviderRequestSummary['completeProviderInput']
  if (includeCompleteInput && body) {
    const { prompt_cache_key: _cacheIdentity, ...completeInput } = body
    completeProviderInput = {
      json: JSON.stringify(completeInput, (_key, value: unknown) => {
        const record = readRecord(value)
        return record
          ? Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))
          : value
      }),
      excludedTransportFields: Object.hasOwn(body, 'prompt_cache_key') ? ['prompt_cache_key'] : [],
    }
  }
  return {
    ...(completeProviderInput ? { completeProviderInput } : {}),
    ...(customToolCallOutputs.length > 0 ? { customToolCallOutputs } : {}),
    ...(functionCallOutputs.length > 0 ? { functionCallOutputs } : {}),
    ...(imageWidths.length > 0 ? { imageWidths } : {}),
    model: readString(body?.model),
    ...(includeDiagnostics
      ? {
          providerRequestDiagnostics: {
            bytes: Buffer.byteLength(requestBody),
            sha256: createHash('sha256').update(requestBody).digest('hex'),
            includesAllTools: requestBody.includes('ALL_TOOLS'),
            includesExecCommand: requestBody.includes('exec_command'),
            includesAutomation: requestBody.includes('"name":"automation"'),
            includesGroup: requestBody.includes('"name":"group"'),
            includesPhysicalNoteRecovery:
              requestBody.includes('"name":"resolve_physical_note"'),
            includesReadShared: requestBody.includes('read_shared'),
            includesResponseCardCompactTableShape: [
              'compact_table',
              'columns',
              'rowHeader',
              'rows',
              'values',
              'tracking',
              'snapshotAt',
            ].every((field) => requestBody.includes(field)),
            includesResponseCardNutritionV2Shape: [
              'daily_nutrition',
              'fiberGrams',
              'goals',
              'status',
              'target',
              'totals',
            ].every((field) => requestBody.includes(field)),
            includesGroupEmail: requestBody.includes('send_email'),
            includesToolSearch: tools.some((tool) => tool?.type === 'tool_search'),
          },
        }
      : {}),
    serviceTier: readString(body?.service_tier),
    ...(toolSearchOutputTools.length > 0 ? { toolSearchOutputTools } : {}),
  }
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readPngDataUrlWidth(value: string): number | null {
  const match = /^data:image\/png;base64,(.+)$/su.exec(value)
  if (!match?.[1]) {
    return null
  }
  const image = Buffer.from(match[1], 'base64')
  return image.length >= 24 && image.subarray(12, 16).toString('ascii') === 'IHDR'
    ? image.readUInt32BE(16)
    : null
}

function readProviderToolOutputText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return null
  }

  const textItems = value
    .map(readRecord)
    .map((item) => readString(item?.text))
    .filter((text): text is string => text !== null)
  return textItems.length > 0 ? textItems.join('\n') : null
}

function writeScriptedSseResponse(input: {
  outputItems: readonly Record<string, unknown>[]
  response: ServerResponse
  responseId: string
  usageInputTokens?: number
}): void {
  const inputTokens = input.usageInputTokens ?? 12
  const usage = {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: inputTokens + 7,
  }
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId,
    model: SCRIPTED_MODEL,
    output: input.outputItems,
    status: 'completed',
    usage,
  }

  input.response.statusCode = 200
  input.response.setHeader('cache-control', 'no-cache')
  input.response.setHeader('content-type', 'text/event-stream; charset=utf-8')
  writeScriptedSseEvent(input.response, 'response.created', {
    response: {
      ...completedResponse,
      output: [],
      status: 'in_progress',
    },
    type: 'response.created',
  })
  for (const [outputIndex, outputItem] of input.outputItems.entries()) {
    writeScriptedSseEvent(input.response, 'response.output_item.added', {
      item: {
        ...outputItem,
        status: 'in_progress',
      },
      output_index: outputIndex,
      type: 'response.output_item.added',
    })
    writeScriptedSseEvent(input.response, 'response.output_item.done', {
      item: outputItem,
      output_index: outputIndex,
      type: 'response.output_item.done',
    })
  }
  writeScriptedSseEvent(input.response, 'response.completed', {
    response: completedResponse,
    type: 'response.completed',
  })
  input.response.write('data: [DONE]\n\n')
  input.response.end()
}

function writeScriptedSseEvent(
  response: ServerResponse,
  event: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
