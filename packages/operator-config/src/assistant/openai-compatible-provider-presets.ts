import { normalizeNullableString } from './shared.js'

export const setupAssistantProviderPresetValues = [
  'openai',
  'vercel-ai-gateway',
  'openrouter',
  'venice',
  'deepseek',
  'groq',
  'together',
  'fireworks',
  'cerebras',
  'xai',
  'huggingface',
  'nvidia',
  'ollama',
  'lm-studio',
  'vllm',
  'litellm',
  'custom',
] as const

export type SetupAssistantProviderPreset =
  (typeof setupAssistantProviderPresetValues)[number]

export type OpenAICompatibleProviderPresetKind =
  | 'custom'
  | 'gateway'
  | 'hosted'
  | 'local'

export interface OpenAICompatibleProviderPreset {
  apiKeyEnv: string | null
  baseUrl: string | null
  description: string
  hostnames: readonly string[]
  id: SetupAssistantProviderPreset
  kind: OpenAICompatibleProviderPresetKind
  ports?: readonly string[]
  providerName: string | null
  title: string
  urlPrefixes: readonly string[]
  aliases: readonly string[]
  envAliases: readonly string[]
}

const OPENAI_COMPATIBLE_PROVIDER_PRESETS: readonly OpenAICompatibleProviderPreset[] = [
  {
    id: 'openai',
    title: 'OpenAI',
    description: 'Use OpenAI with an API key and discover available models.',
    kind: 'hosted',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    hostnames: ['api.openai.com'],
    urlPrefixes: ['https://api.openai.com', 'https://api.openai.com/v1'],
    aliases: ['openai'],
    envAliases: ['OPENAI_API_KEY'],
  },
  {
    id: 'vercel-ai-gateway',
    title: 'Vercel AI Gateway',
    description: 'Use Vercel AI Gateway with a single OpenAI-compatible endpoint.',
    kind: 'gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    apiKeyEnv: 'VERCEL_AI_API_KEY',
    providerName: 'vercel-ai-gateway',
    hostnames: ['ai-gateway.vercel.sh'],
    urlPrefixes: ['https://ai-gateway.vercel.sh/v1'],
    aliases: [
      'vercel-ai-gateway',
      'vercel-gateway',
      'vercel-ai',
      'ai-gateway',
    ],
    envAliases: ['VERCEL_AI_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'],
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    description: 'Use OpenRouter’s unified API for many upstream model families.',
    kind: 'gateway',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'openrouter',
    hostnames: ['openrouter.ai'],
    urlPrefixes: ['https://openrouter.ai/api', 'https://openrouter.ai/api/v1'],
    aliases: ['openrouter'],
    envAliases: ['OPENROUTER_API_KEY'],
  },
  {
    id: 'venice',
    title: 'Venice',
    description: 'Use Venice’s OpenAI-compatible endpoint and model catalog.',
    kind: 'hosted',
    baseUrl: 'https://api.venice.ai/api/v1',
    apiKeyEnv: 'VENICE_API_KEY',
    providerName: 'venice',
    hostnames: ['api.venice.ai'],
    urlPrefixes: ['https://api.venice.ai/api', 'https://api.venice.ai/api/v1'],
    aliases: ['venice', 'venice-ai'],
    envAliases: ['VENICE_API_KEY'],
  },
  {
    id: 'deepseek',
    title: 'DeepSeek',
    description: 'Use DeepSeek through its OpenAI-compatible API.',
    kind: 'hosted',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    providerName: 'deepseek',
    hostnames: ['api.deepseek.com'],
    urlPrefixes: ['https://api.deepseek.com', 'https://api.deepseek.com/v1'],
    aliases: ['deepseek'],
    envAliases: ['DEEPSEEK_API_KEY'],
  },
  {
    id: 'groq',
    title: 'Groq',
    description: 'Use Groq’s OpenAI-style endpoint for fast hosted inference.',
    kind: 'hosted',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    providerName: 'groq',
    hostnames: ['api.groq.com'],
    urlPrefixes: ['https://api.groq.com/openai', 'https://api.groq.com/openai/v1'],
    aliases: ['groq'],
    envAliases: ['GROQ_API_KEY'],
  },
  {
    id: 'together',
    title: 'Together AI',
    description: 'Use Together’s OpenAI-compatible API for open-source model hosting.',
    kind: 'hosted',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    providerName: 'together',
    hostnames: ['api.together.xyz', 'api.together.ai'],
    urlPrefixes: ['https://api.together.xyz', 'https://api.together.xyz/v1'],
    aliases: ['together', 'together-ai'],
    envAliases: ['TOGETHER_API_KEY'],
  },
  {
    id: 'fireworks',
    title: 'Fireworks AI',
    description: 'Use Fireworks’ OpenAI-compatible inference endpoint.',
    kind: 'hosted',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    providerName: 'fireworks',
    hostnames: ['api.fireworks.ai'],
    urlPrefixes: [
      'https://api.fireworks.ai/inference',
      'https://api.fireworks.ai/inference/v1',
    ],
    aliases: ['fireworks', 'fireworks-ai'],
    envAliases: ['FIREWORKS_API_KEY'],
  },
  {
    id: 'cerebras',
    title: 'Cerebras',
    description: 'Use Cerebras’ OpenAI-compatible endpoint and hosted model catalog.',
    kind: 'hosted',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    providerName: 'cerebras',
    hostnames: ['api.cerebras.ai'],
    urlPrefixes: ['https://api.cerebras.ai', 'https://api.cerebras.ai/v1'],
    aliases: ['cerebras'],
    envAliases: ['CEREBRAS_API_KEY'],
  },
  {
    id: 'xai',
    title: 'xAI',
    description: 'Use xAI’s OpenAI-compatible inference API.',
    kind: 'hosted',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    providerName: 'xai',
    hostnames: ['api.x.ai'],
    urlPrefixes: ['https://api.x.ai', 'https://api.x.ai/v1'],
    aliases: ['xai', 'x-ai'],
    envAliases: ['XAI_API_KEY'],
  },
  {
    id: 'huggingface',
    title: 'Hugging Face',
    description: 'Use the Hugging Face router’s OpenAI-compatible chat endpoint.',
    kind: 'gateway',
    baseUrl: 'https://router.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
    providerName: 'huggingface',
    hostnames: ['router.huggingface.co'],
    urlPrefixes: [
      'https://router.huggingface.co',
      'https://router.huggingface.co/v1',
    ],
    aliases: ['huggingface', 'hugging-face', 'hf'],
    envAliases: [
      'HF_TOKEN',
      'HUGGINGFACE_API_KEY',
      'HUGGING_FACE_HUB_TOKEN',
      'HUGGINGFACEHUB_API_TOKEN',
    ],
  },
  {
    id: 'nvidia',
    title: 'NVIDIA',
    description: 'Use NVIDIA’s OpenAI-compatible hosted API catalog.',
    kind: 'gateway',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    providerName: 'nvidia',
    hostnames: ['integrate.api.nvidia.com'],
    urlPrefixes: [
      'https://integrate.api.nvidia.com',
      'https://integrate.api.nvidia.com/v1',
    ],
    aliases: ['nvidia', 'nvidia-nim', 'nim'],
    envAliases: ['NVIDIA_API_KEY', 'NGC_API_KEY'],
  },
  {
    id: 'ollama',
    title: 'Ollama',
    description: 'Use a local Ollama server over its OpenAI-compatible endpoint.',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: null,
    providerName: 'ollama',
    hostnames: ['127.0.0.1', 'localhost'],
    ports: ['11434'],
    urlPrefixes: [
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434',
      'http://localhost:11434/v1',
    ],
    aliases: ['ollama'],
    envAliases: ['OLLAMA_API_KEY'],
  },
  {
    id: 'lm-studio',
    title: 'LM Studio',
    description: 'Use LM Studio’s local OpenAI-compatible server.',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeyEnv: null,
    providerName: 'lm-studio',
    hostnames: ['127.0.0.1', 'localhost'],
    ports: ['1234'],
    urlPrefixes: [
      'http://127.0.0.1:1234',
      'http://127.0.0.1:1234/v1',
      'http://localhost:1234',
      'http://localhost:1234/v1',
    ],
    aliases: ['lm-studio', 'lmstudio'],
    envAliases: ['LM_STUDIO_API_KEY'],
  },
  {
    id: 'vllm',
    title: 'vLLM',
    description: 'Use a self-hosted vLLM OpenAI-compatible server.',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:8000/v1',
    apiKeyEnv: null,
    providerName: 'vllm',
    hostnames: ['127.0.0.1', 'localhost'],
    ports: ['8000'],
    urlPrefixes: [
      'http://127.0.0.1:8000',
      'http://127.0.0.1:8000/v1',
      'http://localhost:8000',
      'http://localhost:8000/v1',
    ],
    aliases: ['vllm'],
    envAliases: ['VLLM_API_KEY'],
  },
  {
    id: 'litellm',
    title: 'LiteLLM',
    description: 'Use a local or remote LiteLLM proxy as an OpenAI-compatible gateway.',
    kind: 'gateway',
    baseUrl: 'http://127.0.0.1:4000',
    apiKeyEnv: 'LITELLM_PROXY_API_KEY',
    providerName: 'litellm',
    hostnames: ['127.0.0.1', 'localhost'],
    ports: ['4000'],
    urlPrefixes: [
      'http://127.0.0.1:4000',
      'http://localhost:4000',
    ],
    aliases: ['litellm', 'lite-llm'],
    envAliases: ['LITELLM_PROXY_API_KEY'],
  },
  {
    id: 'custom',
    title: 'Custom endpoint',
    description: 'Use any other OpenAI-compatible endpoint and enter the details manually.',
    kind: 'custom',
    baseUrl: null,
    apiKeyEnv: null,
    providerName: null,
    hostnames: [],
    urlPrefixes: [],
    aliases: ['custom', 'custom-endpoint', 'compatible', 'openai-compatible'],
    envAliases: [],
  },
] as const satisfies readonly OpenAICompatibleProviderPreset[]

const OPENAI_COMPATIBLE_PROVIDER_PRESET_MAP = new Map(
  OPENAI_COMPATIBLE_PROVIDER_PRESETS.map((preset) => [preset.id, preset] as const),
)

const OPENAI_COMPATIBLE_PROVIDER_ALIAS_MAP = new Map<string, SetupAssistantProviderPreset>()

for (const preset of OPENAI_COMPATIBLE_PROVIDER_PRESETS) {
  for (const alias of preset.aliases) {
    OPENAI_COMPATIBLE_PROVIDER_ALIAS_MAP.set(
      canonicalizeProviderToken(alias),
      preset.id,
    )
  }

  if (preset.providerName) {
    OPENAI_COMPATIBLE_PROVIDER_ALIAS_MAP.set(
      canonicalizeProviderToken(preset.providerName),
      preset.id,
    )
  }

  OPENAI_COMPATIBLE_PROVIDER_ALIAS_MAP.set(
    canonicalizeProviderToken(preset.title),
    preset.id,
  )
}

export function listOpenAICompatibleProviderPresets(): readonly OpenAICompatibleProviderPreset[] {
  return OPENAI_COMPATIBLE_PROVIDER_PRESETS
}

export function listNamedOpenAICompatibleProviderPresets(): readonly OpenAICompatibleProviderPreset[] {
  return OPENAI_COMPATIBLE_PROVIDER_PRESETS.filter((preset) => preset.id !== 'custom')
}

export function getOpenAICompatibleProviderPreset(
  presetId: SetupAssistantProviderPreset,
): OpenAICompatibleProviderPreset {
  return (
    OPENAI_COMPATIBLE_PROVIDER_PRESET_MAP.get(presetId) ??
    OPENAI_COMPATIBLE_PROVIDER_PRESET_MAP.get('custom')!
  )
}

export function isOpenAICompatibleProviderPresetId(
  value: string | null | undefined,
): value is SetupAssistantProviderPreset {
  const normalized = normalizeNullableString(value)
  return normalized !== null && OPENAI_COMPATIBLE_PROVIDER_PRESET_MAP.has(normalized as SetupAssistantProviderPreset)
}

export function resolveOpenAICompatibleProviderPreset(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  providerName?: string | null
}): OpenAICompatibleProviderPreset | null {
  const byBaseUrl = resolveOpenAICompatibleProviderPresetFromBaseUrl(input.baseUrl)
  if (byBaseUrl) {
    return byBaseUrl
  }

  const byProviderName = resolveOpenAICompatibleProviderPresetFromProviderName(
    input.providerName,
  )
  if (byProviderName) {
    return byProviderName
  }

  const byApiKeyEnv = resolveOpenAICompatibleProviderPresetFromApiKeyEnv(
    input.apiKeyEnv,
  )
  if (byApiKeyEnv) {
    return byApiKeyEnv
  }

  return null
}

export function resolveOpenAICompatibleProviderPresetFromId(
  presetId: string | null | undefined,
): OpenAICompatibleProviderPreset | null {
  if (!isOpenAICompatibleProviderPresetId(presetId)) {
    return null
  }

  return getOpenAICompatibleProviderPreset(presetId)
}

export function resolveOpenAICompatibleProviderPresetFromProviderName(
  providerName: string | null | undefined,
): OpenAICompatibleProviderPreset | null {
  const normalized = canonicalizeProviderToken(providerName)
  if (!normalized) {
    return null
  }

  const presetId = OPENAI_COMPATIBLE_PROVIDER_ALIAS_MAP.get(normalized)
  return presetId ? getOpenAICompatibleProviderPreset(presetId) : null
}

export function resolveOpenAICompatibleProviderPresetFromApiKeyEnv(
  apiKeyEnv: string | null | undefined,
): OpenAICompatibleProviderPreset | null {
  const normalized = normalizeNullableString(apiKeyEnv)?.toUpperCase() ?? null
  if (!normalized) {
    return null
  }

  return (
    OPENAI_COMPATIBLE_PROVIDER_PRESETS.find((preset) =>
      preset.envAliases.some((alias) => alias.toUpperCase() === normalized),
    ) ?? null
  )
}

export function resolveOpenAICompatibleProviderPresetFromBaseUrl(
  baseUrl: string | null | undefined,
): OpenAICompatibleProviderPreset | null {
  const normalizedBaseUrl = normalizeNullableString(baseUrl)
  if (!normalizedBaseUrl) {
    return null
  }

  const normalizedPrefix = normalizedBaseUrl.toLowerCase()
  for (const preset of OPENAI_COMPATIBLE_PROVIDER_PRESETS) {
    if (
      preset.urlPrefixes.some((prefix) =>
        normalizedPrefix.startsWith(prefix.toLowerCase()),
      )
    ) {
      return preset
    }
  }

  let parsedUrl: URL | null = null

  try {
    parsedUrl = new URL(normalizedBaseUrl)
  } catch {
    parsedUrl = null
  }

  if (!parsedUrl) {
    return null
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  const port = parsedUrl.port

  return (
    OPENAI_COMPATIBLE_PROVIDER_PRESETS.find((preset) => {
      if (!preset.hostnames.some((candidate) => candidate.toLowerCase() === hostname)) {
        return false
      }

      return preset.ports == null || preset.ports.length === 0 || preset.ports.includes(port)
    }) ?? null
  )
}

export function resolveOpenAICompatibleProviderTitle(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  providerName?: string | null
}): string | null {
  return resolveOpenAICompatibleProviderPreset(input)?.title ?? null
}

function canonicalizeProviderToken(value: string | null | undefined): string {
  return (
    normalizeNullableString(value)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ?? ''
  )
}
