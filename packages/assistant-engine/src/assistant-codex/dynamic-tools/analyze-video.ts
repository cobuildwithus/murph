import * as z from '@murphai/contracts/zod-runtime'
import {
  HOSTED_GEMINI_VIDEO_ANALYSIS_SAMPLING_MODES,
} from '@murphai/hosted-execution/assistant-capabilities'

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
    'Analyze one video attached to an accepted message when the user explicitly asks about it, requests rep counting, or requests visible exercise-form feedback. Pass the exact Message ref and a focused question containing only the task needed to answer the member. When the message has multiple videos, also pass its video attachment ordinal. Omit sampling_mode for general descriptions, persistent objects, speech, or slow action. Use detailed_motion when the answer depends on rapid movement, exercise phases, quick scene changes, or a possibly brief event. Make one analysis call and do not retry at another mode. Answer naturally from the returned observations; mention visibility, sampling, camera-angle, or health limits only when they materially affect the answer. A negative means not observed in sampled frames, and detailed motion is denser sampling rather than every source frame. Describe form without diagnosis, injury prediction, or treatment advice. The runtime owns the model, FPS mapping, credentials, file paths, and URLs.',
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
      sampling_mode: {
        type: 'string',
        enum: HOSTED_GEMINI_VIDEO_ANALYSIS_SAMPLING_MODES,
        description:
          'Omit for standard analysis. Use detailed_motion only when rapid movement, exercise phases, quick scene changes, or a brief event require denser temporal sampling.',
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
    sampling_mode: z.enum(HOSTED_GEMINI_VIDEO_ANALYSIS_SAMPLING_MODES).optional(),
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
      samplingMode: parsed.args.sampling_mode ?? 'standard',
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
    requiredFinalResponseFallback: result.rpcText,
    rpcResult: {
      success: result.rpcSuccess,
      contentItems: [{ type: 'inputText', text: result.rpcText }],
    },
    usageDraft: null,
  }
}
