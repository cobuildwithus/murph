import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as labsTextResult, type ToolFailureReason } from '../tool-failure-diagnostics.js'
import * as z from '@murphai/contracts/zod-runtime'

import {
  hostedRuntimeLabsToolRequestSchema,
  parseHostedRuntimeLabsToolResponse,
  type HostedRuntimeLabsToolRequest,
  type HostedRuntimeLabsToolResponse,
} from '@murphai/hosted-execution/labs'

import type {
  AssistantHostedLabsTool,
} from '../../assistant/execution-context.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const LABS_TOOL_RESULT_MAX_BYTES = 60_000

export const MURPH_LABS_TOOL = {
  namespace: 'murph',
  name: 'labs',
  description:
    'Read the live lab test catalog. This tool discovers available panels and biomarkers with display-ready details, and lists nearby collection sites from a user-provided 5-digit ZIP. It cannot order, book, pay for, reserve, start checkout, or promise a launch date. Catalog listings do not prove member eligibility, appointment availability, final price, or that a particular test can be collected at a listed site.',
  inputSchema: z.toJSONSchema(hostedRuntimeLabsToolRequestSchema, { io: 'input' }),
} as const

export type LabsDynamicToolRequest =
  | {
      kind: 'labs'
      request: HostedRuntimeLabsToolRequest
    }
  | {
      kind: 'invalid-labs-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readLabsDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): LabsDynamicToolRequest | null {
  if (input.tool !== MURPH_LABS_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: hostedRuntimeLabsToolRequestSchema,
    schemaRootKeys: [
      'action',
      'kind',
      'limit',
      'query',
      'radiusMiles',
      'zipCode',
    ],
    toolName: 'murph.labs',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'labs', request: parsed.args }
    : {
        kind: 'invalid-labs-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeLabsDynamicTool(input: {
  abortSignal?: AbortSignal | null
  labsTool: AssistantHostedLabsTool
  request: Extract<LabsDynamicToolRequest, { kind: 'labs' }>
}): Promise<MurphDynamicToolExecutionResult> {
  let failureReason: ToolFailureReason = 'handler_exception'
  try {
    const rawResponse = await input.labsTool.request(input.request.request, {
      signal: input.abortSignal ?? null,
    })
    failureReason = 'action_result_mismatch'
    const response = parseHostedRuntimeLabsToolResponse(rawResponse)
    failureReason = 'handler_exception'
    if (response.action !== input.request.request.action) {
      return labsTextResult(
        false,
        'lab catalog discovery returned an unexpected result',
        'action_result_mismatch',
      )
    }

    const text = serializeLabsToolResponse(response)
    return typeof text === 'string'
      ? labsTextResult(true, text)
      : labsTextResult(false, 'lab catalog result is too large', text.failureReason)
  } catch (error) {
    return labsTextResult(false, 'lab catalog discovery is temporarily unavailable', failureReason, error)
  }
}

function serializeLabsToolResponse(
  response: HostedRuntimeLabsToolResponse,
): string | { failureReason: 'oversized_result' | 'result_serialization_failed' } {
  try {
    const text = JSON.stringify(response) ?? 'null'
    return new TextEncoder().encode(text).byteLength <= LABS_TOOL_RESULT_MAX_BYTES
      ? text
      : { failureReason: 'oversized_result' }
  } catch {
    return { failureReason: 'result_serialization_failed' }
  }
}
