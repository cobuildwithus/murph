import {
  prepareAssistantDirectCliEnv,
} from '../../assistant-cli-access.js'
import {
  executeCodexAppServerTurn,
} from '../../assistant-codex.js'
import {
  isAssistantCodexTargetConfig,
  resolveAssistantChatProviderFromConfig,
} from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_CODEX_MODELS,
} from './catalog.js'
import {
  extractCodexAssistantProviderUsage,
  mergeCodexConfigOverrides,
  resolveAssistantProviderPrompt,
} from './helpers.js'
import {
  supportsAnyAssistantRichUserMessageContent,
  type AssistantProviderDefinition,
} from './types.js'
import type {
  AssistantModelImagePart,
  AssistantUserMessageContentPart,
} from '../../model-harness.js'
import type { CodexAppServerImageInput } from '../../assistant-codex.js'
import { fileURLToPath } from 'node:url'

export const codexCliProviderDefinition: AssistantProviderDefinition = {
  capabilities: {
    murphCommandSurface: 'direct-cli',
    requestFormat: 'flat-prompt',
    supportedUserMessageContentTypes: ['text', 'image'],
    supportsModelDiscovery: false,
    supportsNativeResume: true,
    supportsReasoningEffort: true,
    supportsRichUserMessageContent: supportsAnyAssistantRichUserMessageContent([
      'text',
      'image',
    ]),
    supportsZeroDataRetention: false,
    supportsToolRuntime: false,
  },
  async discoverModels() {
    return {
      models: [],
      status: 'unsupported',
      message: 'Codex app-server model discovery is not wired into Murph yet.',
    }
  },
  async executeTurn(input) {
    const providerConfig = input.providerConfig
    if (!isAssistantCodexTargetConfig(providerConfig)) {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_UNSUPPORTED',
        'Codex app-server execution requires a Codex provider config.',
      )
    }

    const baseAppServerInput = {
      abortSignal: input.abortSignal,
      approvalPolicy: providerConfig.policy.approvalPolicy ?? undefined,
      codexCommand: providerConfig.target.codexCommand ?? undefined,
      codexHome: providerConfig.target.codexHome ?? undefined,
      configOverrides: mergeCodexConfigOverrides({
        showThinkingTraces: input.showThinkingTraces ?? false,
      }),
      env: prepareAssistantDirectCliEnv(input.env),
      model: providerConfig.target.model ?? undefined,
      onProgress: input.onEvent ?? undefined,
      onTraceEvent: input.onTraceEvent,
      oss: providerConfig.target.oss,
      profile: providerConfig.target.profile ?? undefined,
      images: extractCodexAppServerUserMessageImages(input.userMessageContent),
      reasoningEffort: providerConfig.policy.reasoningEffort ?? undefined,
      sandbox: providerConfig.policy.sandbox ?? undefined,
      workingDirectory: input.workingDirectory,
    } as const

    let result
    try {
      result = await executeCodexAppServerTurn({
        ...baseAppServerInput,
        prompt: resolveAssistantProviderPrompt(input),
        resumeSessionId: input.resumeProviderSessionId,
      })
    } catch (error) {
      if (
        input.resumeProviderSessionId &&
        error instanceof VaultCliError &&
        error.code === 'ASSISTANT_CODEX_RESUME_STALE'
      ) {
        result = await executeCodexAppServerTurn({
          ...baseAppServerInput,
          prompt: resolveAssistantProviderPrompt({
            ...input,
            resumeProviderSessionId: null,
          }),
          resumeSessionId: undefined,
        })
      } else {
        throw error
      }
    }

    return {
      metadata: {
        activityLabels: [],
        executedToolCount: 0,
        providerActionCount: result.providerActionCount,
        rawToolEvents: [],
      },
      ok: true,
      result: {
        provider: resolveAssistantChatProviderFromConfig(providerConfig),
        providerSessionId: result.sessionId,
        response: result.finalMessage,
        stderr: result.stderr,
        stdout: result.stdout,
        rawEvents: result.jsonEvents,
        usage: extractCodexAssistantProviderUsage({
          providerConfig,
          rawEvents: result.jsonEvents,
        }),
      },
    }
  },
  resolveLabel(config) {
    return config.target.kind === 'codex-cli' && config.target.oss
      ? 'Codex OSS app-server'
      : 'Codex app-server'
  },
  resolveStaticModels() {
    return DEFAULT_CODEX_MODELS
  },
}

function extractCodexAppServerUserMessageImages(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): readonly CodexAppServerImageInput[] | undefined {
  const images: CodexAppServerImageInput[] = []

  for (const part of userMessageContent ?? []) {
    if (part.type !== 'image') {
      continue
    }

    images.push(
      toCodexAppServerImageInput({
        image: part.image,
        mimeType: part.mimeType ?? part.mediaType ?? null,
      }),
    )
  }

  return images.length > 0 ? images : undefined
}

function toCodexAppServerImageInput(input: {
  image: AssistantModelImagePart['image']
  mimeType: string | null
}): CodexAppServerImageInput {
  if (typeof input.image === 'string') {
    if (input.image.startsWith('data:')) {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image),
        mimeType: input.mimeType,
      }
    }

    return {
      path: input.image,
      mimeType: input.mimeType,
    }
  }

  if (input.image instanceof URL) {
    if (input.image.protocol === 'data:') {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image.href),
        mimeType: input.mimeType,
      }
    }

    if (input.image.protocol === 'file:') {
      return {
        path: fileURLToPath(input.image),
        mimeType: input.mimeType,
      }
    }

    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      `Codex app-server image input does not support URL scheme "${input.image.protocol}".`,
    )
  }

  if (input.image instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(input.image),
      mimeType: input.mimeType,
    }
  }

  return {
    bytes: input.image,
    mimeType: input.mimeType,
  }
}

function decodeCodexDataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:([^,]*?),(.*)$/su.exec(dataUrl)
  if (!match) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      'Codex app-server image input data URL is malformed.',
    )
  }

  const metadata = match[1] ?? ''
  const payload = match[2] ?? ''
  const metadataParts = metadata
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (metadataParts.includes('base64')) {
    return Uint8Array.from(Buffer.from(payload, 'base64'))
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_IMAGE_INVALID',
    'Codex app-server image input data URLs must use base64 encoding.',
  )
}
