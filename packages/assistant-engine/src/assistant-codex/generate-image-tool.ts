import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import type {
  AssistantHostedGeneratedImageUploader,
  AssistantWorkspaceArtifactMaterializer,
} from '../assistant/execution-context.js'
import { hashAssistantProviderStableJson } from '../assistant/providers/helpers.js'
import type {
  AssistantProviderUsageDraft,
} from '../assistant/providers/types.js'
import { normalizeNullableString } from '../assistant/shared.js'
import {
  resolveGenerateImageReferences,
  type ResolvedGenerateImageReference,
} from './image-reference-resolver.js'
import {
  generateOpenAiImage,
  OPENAI_IMAGE_GENERATION_MODEL,
  OPENAI_IMAGE_GENERATION_USAGE_EXTRACTION_VERSION,
  OPENAI_IMAGES_BASE_URL,
  type OpenAiImageGenerationUsage,
  type OpenAiImageOutputFormat,
  type OpenAiImageQuality,
  type OpenAiImageSize,
} from './openai-image-generation.js'

export interface GenerateImageToolArgs {
  alt: string | null
  outputFormat: OpenAiImageOutputFormat
  prompt: string
  quality: OpenAiImageQuality
  referenceImageRefs?: readonly string[]
  size: OpenAiImageSize
}

export interface GenerateImageToolResult {
  responseMedia?: AssistantResponseMedia[]
  rpcSuccess: boolean
  rpcText: string
  usageDraft?: AssistantProviderUsageDraft | null
}

type GenerateImageOperation =
  | 'image_generation'
  | 'image_generation_with_references'

type GenerateImageUsageExtractionSourcePath =
  | 'openai.images.generate'
  | 'openai.images.edit'

const LOCAL_GENERATED_IMAGES_DIR = 'generated_images'
const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024

export async function executeGenerateImageTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateImageToolArgs
  authorizedReferenceImageRefs?: ReadonlyMap<string, { sha256: string }> | null
  codexHome?: string | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  providerRequestOrdinal: number
  requireHostedGeneratedImageUploader?: boolean | null
  vaultRoot?: string | null
}): Promise<GenerateImageToolResult> {
  const apiKey = normalizeNullableString(input.env.OPENAI_API_KEY)
  if (!apiKey) {
    return {
      rpcSuccess: false,
      rpcText: 'OPENAI_API_KEY is required for image generation',
    }
  }

  if (
    input.requireHostedGeneratedImageUploader === true &&
    !input.hostedGeneratedImageUploader
  ) {
    return {
      rpcSuccess: false,
      rpcText: 'hosted image upload is not available for this turn',
    }
  }

  const referenceImageRefs = input.args.referenceImageRefs ?? []
  const vaultRoot = normalizeNullableString(input.vaultRoot)
  if (referenceImageRefs.length > 0 && !vaultRoot) {
    return {
      rpcSuccess: false,
      rpcText: 'image references are unavailable for this turn',
    }
  }

  let referenceImages: ResolvedGenerateImageReference[] = []
  try {
    referenceImages = referenceImageRefs.length > 0
      ? await resolveGenerateImageReferences({
          authorizedReferenceImageRefs:
            input.authorizedReferenceImageRefs ?? null,
          materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
          refs: referenceImageRefs,
          vaultRoot: vaultRoot ?? '',
        })
      : []
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'image references could not be loaded',
    }
  }

  const promptHash = hashGeneratedImagePrompt(input.args.prompt)
  const operation: GenerateImageOperation = referenceImages.length > 0
    ? 'image_generation_with_references'
    : 'image_generation'
  const usageExtractionSourcePath: GenerateImageUsageExtractionSourcePath =
    referenceImages.length > 0 ? 'openai.images.edit' : 'openai.images.generate'
  let openAiResult: Awaited<ReturnType<typeof generateOpenAiImage>>
  try {
    openAiResult = await generateOpenAiImage({
      abortSignal: input.abortSignal ?? null,
      apiKey,
      fetchImpl: input.fetchImpl,
      outputFormat: input.args.outputFormat,
      prompt: buildGenerateImagePromptWithReferences({
        prompt: input.args.prompt,
        referenceImageCount: referenceImages.length,
      }),
      quality: input.args.quality,
      referenceImages,
      size: input.args.size,
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'image generation failed',
    }
  }

  const usageDraft = buildGeneratedImageUsageDraft({
    args: input.args,
    operation,
    providerRequestId: openAiResult.providerRequestId,
    providerRequestOrdinal: input.providerRequestOrdinal,
    rawUsageJson: openAiResult.rawUsageJson,
    referenceImageCount: referenceImages.length,
    referenceImageSha256s: referenceImages.map((reference) => reference.sha256),
    referenceImageSourceRefSha256s: referenceImages.map(
      (reference) => reference.sourceRefSha256,
    ),
    referenceImageTotalBytes: sumReferenceImageBytes(referenceImages),
    usage: openAiResult.usage,
    usageExtractionSourcePath,
  })

  if (
    !isValidGeneratedImageBytes({
      bytes: openAiResult.imageBytes,
      outputFormat: input.args.outputFormat,
    })
  ) {
    return {
      rpcSuccess: false,
      rpcText: 'image generation returned invalid image data',
      usageDraft,
    }
  }

  try {
    if (input.hostedGeneratedImageUploader) {
      const media = await input.hostedGeneratedImageUploader.uploadGeneratedImage({
        alt: input.args.alt ?? 'Generated image',
        bytes: openAiResult.imageBytes,
        contentType: generatedImageContentType(input.args.outputFormat),
        filename: generatedImageFilename(input.args.outputFormat),
        metadata: {
          model: OPENAI_IMAGE_GENERATION_MODEL,
          promptHash,
          ...(referenceImages.length > 0
            ? {
                referenceImageCount: String(referenceImages.length),
                referenceImageSetHash: hashReferenceImageSet(referenceImages),
              }
            : {}),
          schema: 'murph.generated-image.v1',
        },
        source: OPENAI_IMAGE_GENERATION_MODEL,
      })
      return {
        responseMedia: [media],
        rpcSuccess: true,
        rpcText: 'generated image attached to the final response',
        usageDraft,
      }
    }

    const localPath = await writeLocalGeneratedImage({
      bytes: openAiResult.imageBytes,
      codexHome: input.codexHome ?? input.env.CODEX_HOME ?? null,
      outputFormat: input.args.outputFormat,
    })
    return {
      rpcSuccess: true,
      rpcText: `generated image saved at ${localPath.displayPath}`,
      usageDraft,
    }
  } catch {
    return {
      rpcSuccess: false,
      rpcText: input.hostedGeneratedImageUploader
        ? 'image generated but upload failed'
        : 'image generated but local save failed',
      usageDraft,
    }
  }
}

function buildGeneratedImageUsageDraft(input: {
  args: GenerateImageToolArgs
  operation: GenerateImageOperation
  providerRequestId: string | null
  providerRequestOrdinal: number
  rawUsageJson: Record<string, unknown> | null
  referenceImageCount: number
  referenceImageSha256s: readonly string[]
  referenceImageSourceRefSha256s: readonly string[]
  referenceImageTotalBytes: number
  usage: OpenAiImageGenerationUsage | null
  usageExtractionSourcePath: GenerateImageUsageExtractionSourcePath
}): AssistantProviderUsageDraft {
  return {
    provider: 'openai-images',
    providerRequestOrdinal: input.providerRequestOrdinal,
    providerRequestOutcome: 'succeeded',
    usage: {
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: OPENAI_IMAGES_BASE_URL,
      cacheWriteTokens: null,
      cachedInputTokens: input.usage?.input_tokens_details?.cached_tokens ?? null,
      inputTokens: input.usage?.input_tokens ?? null,
      outputTokens: input.usage?.output_tokens ?? null,
      providerMetadataJson: {
        imageOutputFormat: input.args.outputFormat,
        imageQuality: input.args.quality,
        imageSize: input.args.size,
        operation: input.operation,
        referenceImageCount: input.referenceImageCount,
        referenceImageSha256s: input.referenceImageSha256s,
        referenceImageSourceRefSha256s: input.referenceImageSourceRefSha256s,
        referenceImageTotalBytes: input.referenceImageTotalBytes,
      },
      providerName: 'OpenAI Images',
      providerRequestId: input.providerRequestId,
      rawUsageJson: input.rawUsageJson,
      rawUsageJsonHash: input.rawUsageJson
        ? hashAssistantProviderStableJson(input.rawUsageJson)
        : null,
      reasoningTokens: input.usage?.output_tokens_details?.reasoning_tokens ?? null,
      requestedModel: OPENAI_IMAGE_GENERATION_MODEL,
      servedModel: null,
      totalTokens: input.usage?.total_tokens ?? null,
      usageExtractionSourcePath: input.usageExtractionSourcePath,
      usageExtractionVersion: OPENAI_IMAGE_GENERATION_USAGE_EXTRACTION_VERSION,
    },
  }
}

async function writeLocalGeneratedImage(input: {
  bytes: Uint8Array
  codexHome: string | null
  outputFormat: OpenAiImageOutputFormat
}): Promise<{ displayPath: string }> {
  const explicitCodexHome = normalizeNullableString(input.codexHome)
  const codexHome = explicitCodexHome ?? path.join(process.cwd(), '.codex')
  const outputDir = path.join(codexHome, LOCAL_GENERATED_IMAGES_DIR)
  await mkdir(outputDir, { recursive: true })
  const filename = generatedImageFilename(input.outputFormat)
  const outputPath = path.join(outputDir, filename)
  await writeFile(outputPath, Buffer.from(input.bytes))
  return {
    displayPath: explicitCodexHome
      ? `CODEX_HOME/${LOCAL_GENERATED_IMAGES_DIR}/${filename}`
      : `.codex/${LOCAL_GENERATED_IMAGES_DIR}/${filename}`,
  }
}

function isValidGeneratedImageBytes(input: {
  bytes: Uint8Array
  outputFormat: OpenAiImageOutputFormat
}): boolean {
  return (
    input.bytes.byteLength > 0 &&
    input.bytes.byteLength <= MAX_GENERATED_IMAGE_BYTES &&
    generatedImageBytesMatchFormat(input.bytes, input.outputFormat)
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function generatedImageBytesMatchFormat(
  bytes: Uint8Array,
  outputFormat: OpenAiImageOutputFormat,
): boolean {
  switch (outputFormat) {
    case 'jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9
    case 'png':
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
        bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
        bytes[6] === 0x1a && bytes[7] === 0x0a
    case 'webp':
      return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
        bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
        bytes[10] === 0x42 && bytes[11] === 0x50
  }
}

function generatedImageFilename(outputFormat: OpenAiImageOutputFormat): string {
  return `generated-${randomUUID()}.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`
}

function generatedImageContentType(
  outputFormat: OpenAiImageOutputFormat,
): 'image/jpeg' | 'image/png' | 'image/webp' {
  switch (outputFormat) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
  }
}

function hashGeneratedImagePrompt(prompt: string): string {
  return createHash('sha256')
    .update('murph.generated-image.prompt.v1')
    .update('\0')
    .update(prompt)
    .digest('base64url')
    .slice(0, 32)
}

function buildGenerateImagePromptWithReferences(input: {
  prompt: string
  referenceImageCount: number
}): string {
  if (input.referenceImageCount === 0) {
    return input.prompt
  }

  return [
    `Use the attached reference image${input.referenceImageCount === 1 ? '' : 's'} in the provided order.`,
    'The user prompt may refer to them as image 1, image 2, etc.',
    '',
    input.prompt,
  ].join('\n')
}

function hashReferenceImageSet(
  referenceImages: readonly ResolvedGenerateImageReference[],
): string {
  const hash = createHash('sha256')
  hash.update('murph.generated-image.reference-set.v1')
  for (const reference of referenceImages) {
    hash.update('\0')
    hash.update(reference.sha256)
    hash.update('\0')
    hash.update(reference.sourceRefSha256)
  }
  return hash.digest('base64url').slice(0, 32)
}

function sumReferenceImageBytes(
  referenceImages: readonly ResolvedGenerateImageReference[],
): number {
  return referenceImages.reduce((sum, reference) => sum + reference.bytes.byteLength, 0)
}
