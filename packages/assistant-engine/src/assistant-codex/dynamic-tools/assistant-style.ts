import { z } from 'zod'

import {
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingSchema,
} from '@murphai/contracts'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const assistantStyleArgumentsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('show') }).strict(),
  z.object({
    action: z.literal('set'),
    setting: assistantPersonalitySettingSchema,
    value: assistantPersonalityScoreSchema,
  }).strict(),
  z.object({
    action: z.literal('reset'),
    setting: z.union([
      assistantPersonalitySettingSchema,
      z.literal('all'),
    ]),
  }).strict(),
])

export const MURPH_ASSISTANT_STYLE_TOOL = {
  namespace: 'murph',
  name: 'assistant_style',
  description:
    'Read or update the current member\'s private conversation-style settings. Use show to read Humor, Push, and Detail scores and sources; set only for an explicit ongoing preference; reset one setting or all settings to product defaults. Never guess or clamp a score. This tool is available only in a private direct conversation.',
  inputSchema: z.toJSONSchema(assistantStyleArgumentsSchema, { io: 'input' }),
} as const

type AssistantStyleArguments = z.infer<typeof assistantStyleArgumentsSchema>

export type AssistantStyleDynamicToolRequest =
  | {
      args: AssistantStyleArguments
      kind: 'assistant-style'
    }
  | {
      kind: 'invalid-assistant-style-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readAssistantStyleDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): AssistantStyleDynamicToolRequest | null {
  if (input.tool !== MURPH_ASSISTANT_STYLE_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: assistantStyleArgumentsSchema,
    schemaRootKeys: ['action', 'setting', 'value'],
    toolName: 'murph.assistant_style',
    value: input.arguments,
  })

  return parsed.ok
    ? { args: parsed.args, kind: 'assistant-style' }
    : {
        kind: 'invalid-assistant-style-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeAssistantStyleDynamicTool(input: {
  available: boolean
  causalSeqRequired: boolean
  request: Extract<AssistantStyleDynamicToolRequest, { kind: 'assistant-style' }>
  resolveCausalSeq: (() => Promise<string | null>) | null
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.available) {
    return assistantStyleTextResult(
      false,
      'assistant style settings are unavailable outside a private direct conversation',
    )
  }
  if (!input.vaultRoot) {
    return assistantStyleTextResult(false, 'assistant style settings require a vault')
  }

  try {
    const { args } = input.request
    const causalSeq = args.action === 'show'
      ? null
      : await input.resolveCausalSeq?.() ?? null
    if (args.action !== 'show' && input.causalSeqRequired && !causalSeq) {
      return assistantStyleTextResult(
        false,
        'assistant style settings could not be updated',
      )
    }
    const usecases = await import('@murphai/vault-usecases/preferences')
    const result = args.action === 'show'
      ? await usecases.showAssistantPersonality(input.vaultRoot)
      : args.action === 'set'
        ? await usecases.setAssistantPersonalitySetting({
            ...(causalSeq ? { causalSeq } : {}),
            setting: args.setting,
            value: args.value,
            vault: input.vaultRoot,
          })
        : args.setting === 'all'
          ? await usecases.resetAllAssistantPersonalitySettings({
              ...(causalSeq ? { causalSeq } : {}),
              vault: input.vaultRoot,
            })
          : await usecases.resetAssistantPersonalitySetting({
              ...(causalSeq ? { causalSeq } : {}),
              setting: args.setting,
              vault: input.vaultRoot,
            })

    return assistantStyleTextResult(true, JSON.stringify(result))
  } catch {
    return assistantStyleTextResult(false, 'assistant style settings could not be updated')
  }
}

function assistantStyleTextResult(success: boolean, text: string): {
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
