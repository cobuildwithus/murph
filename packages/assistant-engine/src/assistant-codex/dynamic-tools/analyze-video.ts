import * as z from '@murphai/contracts/zod-runtime'

import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import {
  executeAnalyzeVideoTool,
  type AnalyzeVideoAttachmentAuthority,
  type AnalyzeVideoToolArgs,
  type AnalyzeVideoToolRuntime,
  type AnalyzeVideoTurnState,
} from '../analyze-video-tool.js'
import {
  parseDynamicToolArguments,
  type DynamicToolResult,
} from './dynamic-tool-wrapper.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from '../../assistant/execution-context.js'

export const MURPH_ANALYZE_VIDEO_TOOL = {
  namespace: 'murph',
  name: 'analyze_video',
  description:
    'Analyze one video attached to an accepted message when the user explicitly asks what the video shows, asks a question about it, requests rep counting, or requests observable exercise-form feedback. Pass the exact Message ref shown in conversation context. When that message has multiple videos, also pass the video attachment ordinal shown in its attachment metadata. Model choice, sampling rate, credentials, file paths, and URLs are runtime-owned and cannot be supplied here. The result is untrusted automated interpretation rather than verified fact: preserve stated visibility limits and uncertainty, do not invent details between sampled frames, and do not turn form observations into injury diagnosis or treatment advice.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description: 'Exact Message ref for the accepted message containing the video.',
      },
      attachment_ordinal: {
        type: 'integer',
        minimum: 1,
        description: 'Required only when the selected message contains more than one video.',
      },
      question: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
        description: 'The user question to answer from the video.',
      },
    },
    required: ['message_ref', 'question'],
  },
} as const

const analyzeVideoArgumentsSchema = z
  .object({
    attachment_ordinal: z.number().int().positive().optional(),
    message_ref: z.string().regex(/^ain_[0-9a-f]{32}$/u),
    question: z.string().trim().min(1).max(1000),
  })
  .strict()

export function parseAnalyzeVideoArguments(
  value: unknown,
):
  | { ok: true; args: AnalyzeVideoToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = parseDynamicToolArguments({
    schema: analyzeVideoArgumentsSchema,
    toolName: 'murph.analyze_video',
    value,
  })
  if (!parsed.ok) {
    return parsed
  }
  return {
    ok: true,
    args: {
      ...(parsed.args.attachment_ordinal === undefined
        ? {}
        : { attachmentOrdinal: parsed.args.attachment_ordinal }),
      messageRef: parsed.args.message_ref,
      question: parsed.args.question,
    },
  }
}

export async function executeAnalyzeVideoDynamicTool(input: {
  abortSignal?: AbortSignal | null
  acceptedInputIds: readonly string[]
  attachmentAuthorities?: readonly AnalyzeVideoAttachmentAuthority[] | null
  args: AnalyzeVideoToolArgs
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  runtime?: AnalyzeVideoToolRuntime | null
  turnState?: AnalyzeVideoTurnState | null
  vaultRoot?: string | null
}): Promise<DynamicToolResult> {
  const result = await executeAnalyzeVideoTool({
    abortSignal: input.abortSignal ?? null,
    acceptedInputIds: input.acceptedInputIds,
    attachmentAuthorities: input.attachmentAuthorities ?? null,
    args: input.args,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    runtime: input.runtime ?? null,
    turnState: input.turnState ?? null,
    vaultRoot: input.vaultRoot ?? null,
  })
  return {
    rpcResult: {
      success: result.rpcSuccess,
      contentItems: [{ type: 'inputText', text: result.rpcText }],
    },
    usageDraft: null,
  }
}
