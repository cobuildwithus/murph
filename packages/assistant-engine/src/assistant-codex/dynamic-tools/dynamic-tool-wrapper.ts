import { z } from 'zod'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import type { GenerateVoiceMemoToolResult } from '../generate-voice-memo-tool.js'

export interface DynamicToolResult {
  responseMediaPatch?: {
    media: AssistantResponseMedia[]
    op: 'append'
  }
  rpcResult: {
    contentItems: { text: string; type: 'inputText' }[]
    success: boolean
  }
  usageDraft: null
}

export function wrapVoiceMemoToolResult(
  result: GenerateVoiceMemoToolResult,
): DynamicToolResult {
  return {
    ...(result.responseMedia && result.responseMedia.length > 0
      ? {
          responseMediaPatch: {
            media: result.responseMedia,
            op: 'append' as const,
          },
        }
      : {}),
    rpcResult: {
      success: result.rpcSuccess,
      contentItems: [
        {
          type: 'inputText',
          text: result.rpcText,
        },
      ],
    },
    usageDraft: null,
  }
}

export function parseDynamicToolArguments<T extends z.ZodTypeAny>(
  input: {
    schema: T
    schemaName?: string
    /**
     * Root-key list used in the validation digest. Required for schemas where
     * `Object.keys(schema.shape)` is not the natural key set (e.g.
     * discriminated unions). For plain ZodObject schemas this is derived from
     * `schema.shape` automatically.
     */
    schemaRootKeys?: readonly string[]
    toolName: string
    value: unknown
  },
):
  | { ok: true; args: z.infer<T> }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = input.schema.safeParse(input.value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildSafeToolCallValidationDigest({
        error: parsed.error,
        rawInput: input.value,
        requestedToolName: input.toolName,
        schemaName: input.schemaName ?? `${input.toolName}.input`,
        schemaRootKeys: input.schemaRootKeys ?? resolveSchemaRootKeys(input.schema, input.toolName),
        toolName: input.toolName,
      }),
    }
  }
  return { args: parsed.data, ok: true }
}

function resolveSchemaRootKeys(
  schema: z.ZodTypeAny,
  toolName: string,
): readonly string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape)
  }
  throw new TypeError(
    `parseDynamicToolArguments requires explicit schemaRootKeys for non-object schemas (${toolName}).`,
  )
}
