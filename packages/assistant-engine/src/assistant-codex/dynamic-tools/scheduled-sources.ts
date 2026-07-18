import { z } from 'zod'

import { MURPH_PRODUCT_ORIGIN, researchScoutBatchInputSchema } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { fetchExaResearchScoutBatchCandidates } from '../../research-scout.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
  type AssistantScheduledTaskSourceCurrentAssertion,
} from '../../assistant/scheduled-task-authority.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const TOOL_RESULT_MAX_BYTES = 256_000
const PRODUCT_SOURCE_FETCH_TIMEOUT_MS = 30_000
const CHANGELOG_SOURCE_PATH = '/api/changelog?days=14&featureLimit=70&improvementLimit=10'
const FEATURE_CATALOG_SOURCE_PATH = '/api/feature-catalog'
const CHANGELOG_FEED_SCHEMA = 'murph.changelog-feed.v1'
const FEATURE_CATALOG_FEED_SCHEMA = 'murph.feature-catalog-feed.v1'

export const ASSISTANT_SCHEDULED_PRODUCT_SOURCES = [
  'changelog',
  'feature_catalog',
] as const

export type AssistantScheduledProductSource =
  (typeof ASSISTANT_SCHEDULED_PRODUCT_SOURCES)[number]

export const MURPH_RESEARCH_SCOUT_BATCH_TOOL = {
  namespace: 'murph',
  name: 'research_scout_batch',
  description:
    'Run the bounded Exa research-scout batch from compact, non-identifying profile tags. The trusted parent supplies the credential and performs the exact Exa request; the tool accepts no URL, token, headers, or raw vault content.',
  inputSchema: z.toJSONSchema(researchScoutBatchInputSchema, { io: 'input' }),
} as const

const productSourceArgumentsSchema = z.object({
  source: z.enum(ASSISTANT_SCHEDULED_PRODUCT_SOURCES),
}).strict()

export const MURPH_PRODUCT_SOURCE_TOOL = {
  namespace: 'murph',
  name: 'product_source',
  description:
    'Read exactly one canonical public Murph product source. changelog fetches the fixed 14-day product-note feed; feature_catalog fetches the canonical capability catalog. The trusted parent fixes the origin, path, query, method, and response bound.',
  inputSchema: z.toJSONSchema(productSourceArgumentsSchema, { io: 'input' }),
} as const

export type ScheduledSourceDynamicToolRequest =
  | {
      kind: 'research-scout-batch'
      request: z.infer<typeof researchScoutBatchInputSchema>
    }
  | {
      kind: 'product-source'
      request: z.infer<typeof productSourceArgumentsSchema>
    }
  | {
      kind: 'invalid-research-scout-batch-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-product-source-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledSourceDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledSourceDynamicToolRequest | null {
  if (input.tool === MURPH_RESEARCH_SCOUT_BATCH_TOOL.name) {
    const parsed = parseDynamicToolArguments({
      schema: researchScoutBatchInputSchema,
      schemaRootKeys: ['lanes', 'maxCandidatesPerLane', 'since', 'until'],
      toolName: 'murph.research_scout_batch',
      value: input.arguments,
    })
    return parsed.ok
      ? { kind: 'research-scout-batch', request: parsed.args }
      : {
          kind: 'invalid-research-scout-batch-arguments',
          validationDigest: parsed.validationDigest,
        }
  }

  if (input.tool === MURPH_PRODUCT_SOURCE_TOOL.name) {
    const parsed = parseDynamicToolArguments({
      schema: productSourceArgumentsSchema,
      schemaRootKeys: ['source'],
      toolName: 'murph.product_source',
      value: input.arguments,
    })
    return parsed.ok
      ? { kind: 'product-source', request: parsed.args }
      : {
          kind: 'invalid-product-source-arguments',
          validationDigest: parsed.validationDigest,
        }
  }

  return null
}

export async function executeScheduledSourceDynamicTool(input: {
  abortSignal?: AbortSignal | null
  assertSourceCurrent: AssistantScheduledTaskSourceCurrentAssertion
  authority: AssistantScheduledTaskAuthority | null
  claimProductSource?: ((source: AssistantScheduledProductSource) => boolean) | null
  claimResearchScoutBatch?: (() => boolean) | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  publicFetchImpl?: typeof fetch | null
  request: Extract<ScheduledSourceDynamicToolRequest, {
    kind: 'product-source' | 'research-scout-batch'
  }>
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  const authorized = input.request.kind === 'research-scout-batch'
    ? authority.kind === 'research_ledger'
    : authority.kind === 'product_notes'
  if (!authorized) {
    return sourceTextResult(false, JSON.stringify({
      code: 'scheduled_source_unauthorized',
    }))
  }
  if (
    input.request.kind === 'research-scout-batch' &&
    input.claimResearchScoutBatch?.() !== true
  ) {
    return sourceTextResult(false, JSON.stringify({
      code: 'scheduled_research_batch_already_used',
    }))
  }
  if (
    input.request.kind === 'product-source' &&
    input.claimProductSource?.(input.request.request.source) !== true
  ) {
    return sourceTextResult(false, JSON.stringify({
      code: 'scheduled_product_source_already_used',
    }))
  }
  try {
    let payload: unknown
    if (input.request.kind === 'research-scout-batch') {
      payload = await fetchExaResearchScoutBatchCandidates(input.request.request, {
        abortSignal: input.abortSignal ?? null,
        beforeRequest: async () => {
          await input.assertSourceCurrent(input.authority)
        },
        env: input.env,
        fetchImpl: input.fetchImpl,
      })
    } else {
      await input.assertSourceCurrent(input.authority)
      payload = await fetchProductSource({
        abortSignal: input.abortSignal ?? null,
        fetchImpl: input.publicFetchImpl ?? null,
        source: input.request.request.source,
      })
    }
    const text = serializeBounded(payload)
    return text === null
      ? sourceTextResult(false, JSON.stringify({ code: 'scheduled_source_result_too_large' }))
      : sourceTextResult(true, text)
  } catch (error) {
    return sourceTextResult(false, JSON.stringify({
      code: error instanceof VaultCliError
        ? error.code
        : 'scheduled_source_unavailable',
    }))
  }
}

async function fetchProductSource(input: {
  abortSignal: AbortSignal | null
  fetchImpl: typeof fetch | null
  source: z.infer<typeof productSourceArgumentsSchema>['source']
}): Promise<unknown> {
  if (!input.fetchImpl) {
    throw new Error('Public fetch is unavailable.')
  }

  const path = input.source === 'changelog'
    ? CHANGELOG_SOURCE_PATH
    : FEATURE_CATALOG_SOURCE_PATH
  const deadlineSignal = AbortSignal.timeout(PRODUCT_SOURCE_FETCH_TIMEOUT_MS)
  const signal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, deadlineSignal])
    : deadlineSignal
  const response = await input.fetchImpl(new URL(path, MURPH_PRODUCT_ORIGIN), {
    headers: { accept: 'application/json' },
    method: 'GET',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Product source returned HTTP ${response.status}.`)
  }

  const payload = await readBoundedJson(response, TOOL_RESULT_MAX_BYTES)
  const schema = input.source === 'changelog'
    ? CHANGELOG_FEED_SCHEMA
    : FEATURE_CATALOG_FEED_SCHEMA
  const parsed = z.object({
    items: z.array(z.object({ id: z.string().trim().min(1).max(120) }).passthrough()).max(100),
    schema: z.literal(schema),
  }).passthrough().safeParse(payload)
  if (!parsed.success) {
    throw new Error('Product source response is invalid.')
  }
  return parsed.data
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('Product source response is too large.')
    }
    return JSON.parse(text) as unknown
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error('Product source response is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}

function serializeBounded(value: unknown): string | null {
  try {
    const text = JSON.stringify(value) ?? 'null'
    return new TextEncoder().encode(text).byteLength <= TOOL_RESULT_MAX_BYTES
      ? text
      : null
  } catch {
    return null
  }
}

function sourceTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
