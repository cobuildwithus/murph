import * as z from '@murphai/contracts/zod-runtime'

import {
  assistantPersonalitySettingIds,
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingSchema,
  type AssistantPersonalitySettingId,
} from '@murphai/contracts'
import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  type HostedRuntimeAssistantPersonalitySettingSnapshot,
  type HostedRuntimeAssistantPersonalitySettings,
  type HostedRuntimeAssistantPersonalityUpdate,
  type HostedRuntimeAssistantPersonalityUpdateOutcomes,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
  type HostedRuntimeAssistantPersonalizationToolRequest,
  type HostedRuntimeAssistantPersonalizationToolResponse,
} from '@murphai/hosted-execution/assistant-personalization'
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
    'Read or update the current conversation runtime\'s Humor, Push, Detail, and Unhinged settings. In a private chat these belong to the member; in a group chat they belong to the synthetic room Murph and never to a participant. Use show to read scores and sources; set only for an explicit ongoing preference; reset one setting or all settings to product defaults. For a bare directional request ("more"/"less") show first, then set a bounded step from the reported score; otherwise set only the exact score the member stated or agreed to. Never silently clamp an out-of-range value.',
  inputSchema: z.toJSONSchema(assistantStyleArgumentsSchema, { io: 'input' }),
} as const

type AssistantStyleArguments = z.infer<typeof assistantStyleArgumentsSchema>

export type AssistantStyleDynamicToolRequest =
  | {
      args: AssistantStyleArguments
      kind: 'assistant-style'
      toolCallId?: string
    }
  | {
      kind: 'invalid-assistant-style-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export interface AssistantStyleTurnSettingsOverlay {
  settings: Partial<HostedRuntimeAssistantPersonalitySettings>
}

export function readAssistantStyleDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
  toolCallId?: string | null
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
    ? {
        args: parsed.args,
        kind: 'assistant-style',
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      }
    : {
        kind: 'invalid-assistant-style-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeAssistantStyleDynamicTool(input: {
  authority: HostedRuntimeAssistantPersonalizationToolAuthority | null
  available: boolean
  hosted: boolean
  hostedPersonalizationTool: {
    request(
      request: HostedRuntimeAssistantPersonalizationToolRequest,
      authority?: HostedRuntimeAssistantPersonalizationToolAuthority,
    ): Promise<HostedRuntimeAssistantPersonalizationToolResponse>
  } | null
  hostedSettingsOverlay?: AssistantStyleTurnSettingsOverlay | null
  request: Extract<AssistantStyleDynamicToolRequest, { kind: 'assistant-style' }>
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
      'assistant style settings are unavailable for this conversation',
    )
  }

  try {
    const { args } = input.request
    if (!input.vaultRoot) {
      return assistantStyleTextResult(
        false,
        'assistant style settings require a vault',
      )
    }
    const usecases = await import('@murphai/vault-usecases/preferences')
    if (input.hosted) {
      const personalizationTool = input.hostedPersonalizationTool
      const authority = input.authority
      if (args.action === 'show') {
        const canonical = await usecases.showAssistantPersonality(input.vaultRoot)
        return assistantStyleTextResult(true, JSON.stringify({
          ...canonical,
          settings: mergePersonalitySettings(
            canonical.settings,
            input.hostedSettingsOverlay?.settings ?? {},
          ),
        }))
      }
      if (!personalizationTool || !authority) {
        return assistantStyleTextResult(
          false,
          'assistant style settings could not be updated',
        )
      }

      const canonical = await usecases.showAssistantPersonality(input.vaultRoot)
      const settings = mergePersonalitySettings(
        canonical.settings,
        input.hostedSettingsOverlay?.settings ?? {},
      )

      const personality = args.action === 'set'
        ? { [args.setting]: args.value }
        : args.setting === 'all'
          ? Object.fromEntries(
              assistantPersonalitySettingIds.map((setting) => [setting, null]),
            )
          : { [args.setting]: null }
      const response = await personalizationTool.request(
        {
          action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
          personality,
        },
        input.request.toolCallId
          ? { ...authority, toolCallId: input.request.toolCallId }
          : authority,
      )
      if (response.action !== HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION) {
        throw new TypeError('Assistant style request returned the wrong response action.')
      }
      if (
        !haveSameKeys(personality, response.result.outcomes)
      ) {
        throw new TypeError('Assistant style response outcomes do not match the request.')
      }
      validateRequestedPersonalitySettings({
        outcomes: response.result.outcomes,
        personality,
        settings: response.result.settings,
      })
      const requestedSettings = pickRequestedPersonalitySettings(
        personality,
        response.result.settings,
      )
      const updated = hasSavedEffectivePersonalityChange({
        base: settings,
        outcomes: response.result.outcomes,
        personality,
        settings: response.result.settings,
      })
      if (input.hostedSettingsOverlay) {
        input.hostedSettingsOverlay.settings = {
          ...input.hostedSettingsOverlay.settings,
          ...requestedSettings,
        }
      }
      return assistantStyleTextResult(true, JSON.stringify({
        outcomes: response.result.outcomes,
        settings: mergePersonalitySettings(settings, requestedSettings),
        updated,
      }))
    }

    const result = args.action === 'show'
      ? await usecases.showAssistantPersonality(input.vaultRoot)
      : args.action === 'set'
        ? await usecases.setAssistantPersonalitySetting({
            setting: args.setting,
            value: args.value,
            vault: input.vaultRoot,
          })
        : args.setting === 'all'
          ? await usecases.resetAllAssistantPersonalitySettings({
              vault: input.vaultRoot,
            })
          : await usecases.resetAssistantPersonalitySetting({
              setting: args.setting,
              vault: input.vaultRoot,
            })

    return assistantStyleTextResult(true, JSON.stringify(result))
  } catch {
    return assistantStyleTextResult(false, 'assistant style settings could not be updated')
  }
}

function mergePersonalitySettings(
  base: HostedRuntimeAssistantPersonalitySettings,
  overlay: Partial<HostedRuntimeAssistantPersonalitySettings>,
): HostedRuntimeAssistantPersonalitySettings {
  return {
    detail: overlay.detail ?? base.detail,
    humor: overlay.humor ?? base.humor,
    push: overlay.push ?? base.push,
    unhinged: overlay.unhinged ?? base.unhinged,
  }
}

function pickRequestedPersonalitySettings(
  personality: HostedRuntimeAssistantPersonalityUpdate,
  settings: HostedRuntimeAssistantPersonalitySettings,
): Partial<HostedRuntimeAssistantPersonalitySettings> {
  const requested: Partial<HostedRuntimeAssistantPersonalitySettings> = {}
  for (const setting of assistantPersonalitySettingIds) {
    if (personality[setting] !== undefined) {
      requested[setting] = settings[setting]
    }
  }
  return requested
}

function validateRequestedPersonalitySettings(input: {
  outcomes: HostedRuntimeAssistantPersonalityUpdateOutcomes
  personality: HostedRuntimeAssistantPersonalityUpdate
  settings: HostedRuntimeAssistantPersonalitySettings
}): void {
  for (const setting of assistantPersonalitySettingIds) {
    const requested = input.personality[setting]
    if (requested === undefined || input.outcomes[setting] === 'superseded') {
      continue
    }
    const actual = input.settings[setting]
    if (
      requested === null
        ? !isDefaultPersonalitySetting(actual)
        : actual.source !== 'custom' || actual.value !== requested
    ) {
      throw new TypeError(
        `Assistant style response ${setting} setting does not match its outcome.`,
      )
    }
  }
}

function hasSavedEffectivePersonalityChange(input: {
  base: HostedRuntimeAssistantPersonalitySettings
  outcomes: HostedRuntimeAssistantPersonalityUpdateOutcomes
  personality: HostedRuntimeAssistantPersonalityUpdate
  settings: HostedRuntimeAssistantPersonalitySettings
}): boolean {
  return assistantPersonalitySettingIds.some((setting) => {
    if (
      input.personality[setting] === undefined ||
      input.outcomes[setting] !== 'saved'
    ) {
      return false
    }
    const before = input.base[setting]
    const after = input.settings[setting]
    return before.source !== after.source || before.value !== after.value
  })
}

function isDefaultPersonalitySetting(
  snapshot: HostedRuntimeAssistantPersonalitySettingSnapshot,
): boolean {
  return snapshot.source === 'default'
}

function haveSameKeys(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
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
