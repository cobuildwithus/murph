import * as z from '@murphai/contracts/zod-runtime'

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
    schemaPaths?: readonly string[]
    /**
     * Root-key list used in the validation digest. Auto-derived from
     * `schema.shape` for plain ZodObject schemas. Should be passed explicitly
     * for any non-ZodObject schema (e.g. discriminated unions) — omitting it
     * produces a digest with empty rootKeysPresent, inflated unsafeRootKeyCount,
     * and no nested-path diagnostics. Root-level diagnostics (path=`root`) and
     * the validation fingerprint still emit.
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
        schemaPaths: input.schemaPaths,
        schemaRootKeys: input.schemaRootKeys ?? resolveSchemaRootKeys(input.schema),
        toolName: input.toolName,
      }),
    }
  }
  return { args: parsed.data, ok: true }
}

function resolveSchemaRootKeys(schema: z.ZodTypeAny): readonly string[] {
  // Auto-derive only for ZodObject. For non-object schemas the caller should
  // pass `schemaRootKeys` explicitly; the empty fallback here lets the digest
  // still emit (just without root-key facts) rather than throwing during the
  // validation-failure path and replacing the real Zod error with a TypeError.
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : []
}
