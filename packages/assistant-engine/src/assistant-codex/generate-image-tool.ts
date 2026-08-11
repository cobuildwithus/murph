import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  addCaptureWithLookup,
  CAPTURE_LOOKUP_INDEX_PATH,
  deterministicContractId,
  findCaptureByLookup,
  GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA,
  GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS,
  GENERATED_IMAGE_CAPTURE_SOURCE,
  GENERATED_IMAGE_CAPTURE_TAGS,
  ID_PREFIXES,
  isVaultError,
} from '@murphai/core'
import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  describeVaultCliFailure,
} from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantGeneratedImageCapturePersistenceMetadata,
  AssistantWorkspaceArtifactMaterializer,
} from '../assistant/execution-context.js'
import { hashAssistantProviderStableJson } from '../assistant/providers/helpers.js'
import type {
  AssistantProviderUsageDraft,
} from '../assistant/providers/types.js'
import { normalizeNullableString } from '../assistant/shared.js'
import { resolveAssistantSkillsRoot } from '../assistant-skill-assets.js'
import {
  isVaultReferenceImageRef,
  normalizeGenerateImageReferenceRef,
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
  outputCompression?: number
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
  savedCaptureId?: string | null
  savedImageRef?: string | null
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

interface SavedGeneratedImageCapture {
  captureId: string
  imageRef: string
  manifestPath: string | null
}

interface GeneratedImageCaptureIdentity {
  filename: string
  lookupKey: string
  rawImportId: string
}

type ExistingGeneratedImageCapture =
  | {
      status: 'deleted'
    }
  | {
      status: 'live'
      bytes: Uint8Array
      capture: SavedGeneratedImageCapture
    }
  | {
      status: 'missing'
    }

export async function executeGenerateImageTool(input: {
  abortSignal?: AbortSignal | null
  args: GenerateImageToolArgs
  captureIdempotencyKey?: string | null
  codexHome?: string | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  persistGeneratedImageCapture?: (<T>(
    write: () => Promise<T>,
    metadata: AssistantGeneratedImageCapturePersistenceMetadata,
  ) => Promise<T>) | null
  providerRequestOrdinal: number
  requireHostedPrivateImageDelivery?: boolean | null
  validateResolvedReferenceImages?: (
    references: readonly ResolvedGenerateImageReference[],
  ) => Promise<string | null>
  vaultRoot?: string | null
}): Promise<GenerateImageToolResult> {
  const apiKey = normalizeNullableString(input.env.OPENAI_API_KEY)
  if (!apiKey) {
    return {
      rpcSuccess: false,
      rpcText: 'OPENAI_API_KEY is required for image generation',
    }
  }

  const referenceImageRefs = input.args.referenceImageRefs ?? []
  const vaultRoot = normalizeNullableString(input.vaultRoot)
  const requireHostedPrivateImageDelivery =
    input.requireHostedPrivateImageDelivery === true
  if (requireHostedPrivateImageDelivery && !vaultRoot) {
    return {
      rpcSuccess: false,
      rpcText: 'hosted private image delivery requires the owning vault',
    }
  }
  if (
    requireHostedPrivateImageDelivery &&
    !input.persistGeneratedImageCapture
  ) {
    return {
      rpcSuccess: false,
      rpcText: 'hosted private image delivery requires generated capture persistence',
    }
  }

  if (
    referenceImageRefs.length > 0 &&
    !vaultRoot &&
    hasVaultReferenceImageRef(referenceImageRefs)
  ) {
    return {
      rpcSuccess: false,
      rpcText: 'image references are unavailable for this turn',
    }
  }

  const promptHash = hashGeneratedImagePrompt(input.args.prompt)
  const captureIdentity = buildGeneratedImageCaptureIdentity({
    idempotencyKey: input.captureIdempotencyKey ?? null,
    outputFormat: input.args.outputFormat,
  })
  let existingCapture: ExistingGeneratedImageCapture = { status: 'missing' }
  if (vaultRoot) {
    try {
      await input.materializeWorkspaceArtifacts?.([CAPTURE_LOOKUP_INDEX_PATH])
      existingCapture = await findExistingGeneratedImageCapture({
        captureIdentity,
        outputFormat: input.args.outputFormat,
        vaultRoot,
      })
    } catch {
      return {
        rpcSuccess: false,
        rpcText: 'saved generated image lookup could not be loaded',
      }
    }
  }
  let generatedImageBytes: Uint8Array
  let referenceImages: ResolvedGenerateImageReference[] = []
  let savedCapture: SavedGeneratedImageCapture | null = null
  let usageDraft: AssistantProviderUsageDraft | null = null

  if (existingCapture.status === 'deleted') {
    return {
      rpcSuccess: false,
      rpcText: 'saved generated image was deleted; make a new image request',
    }
  }

  if (existingCapture.status === 'live') {
    generatedImageBytes = existingCapture.bytes
    savedCapture = existingCapture.capture
  } else {
    try {
      referenceImages = referenceImageRefs.length > 0
        ? await resolveGenerateImageReferences({
            materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
            refs: referenceImageRefs,
            skillsRoot: resolveAssistantSkillsRoot(),
            vaultRoot: vaultRoot ?? '',
          })
        : []
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      return {
        rpcSuccess: false,
        rpcText: describeGenerateImageFailure(
          'image references could not be loaded',
          error,
        ),
      }
    }

    const referenceValidationFailure =
      await input.validateResolvedReferenceImages?.(referenceImages) ?? null
    if (referenceValidationFailure) {
      return {
        rpcSuccess: false,
        rpcText: referenceValidationFailure,
      }
    }

    const operationLabel = referenceImages.length > 0
      ? 'image edit'
      : 'image generation'
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
        ...(input.args.outputCompression !== undefined
          ? { outputCompression: input.args.outputCompression }
          : {}),
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
        rpcText: describeGenerateImageFailure(
          `${operationLabel} failed`,
          error,
        ),
      }
    }

    const hasValidGeneratedImageBytes = isValidGeneratedImageBytes({
      bytes: openAiResult.imageBytes,
      outputFormat: input.args.outputFormat,
    })
    usageDraft = buildGeneratedImageUsageDraft({
      args: input.args,
      occurredAt: openAiResult.occurredAt,
      operation,
      providerRequestId: openAiResult.providerRequestId,
      providerRequestOrdinal: input.providerRequestOrdinal,
      providerRequestOutcome: hasValidGeneratedImageBytes ? 'succeeded' : 'partial',
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

    if (!hasValidGeneratedImageBytes) {
      return {
        rpcSuccess: false,
        rpcText: `${operationLabel} returned invalid image data`,
        usageDraft,
      }
    }

    generatedImageBytes = openAiResult.imageBytes

    if (vaultRoot) {
      try {
        const occurredAt = new Date().toISOString()
        const saveCapture = () => saveGeneratedImageCapture({
          args: input.args,
          bytes: generatedImageBytes,
          captureIdentity,
          occurredAt,
          promptHash,
          referenceImages,
          vaultRoot,
        })
        savedCapture = input.persistGeneratedImageCapture
          ? await input.persistGeneratedImageCapture(saveCapture, {
              retentionWakeAt: new Date(
                Date.parse(occurredAt) + GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS,
              ).toISOString(),
            })
          : await saveCapture()
      } catch (error) {
        if (
          isVaultError(error) &&
          error.code === 'CAPTURE_LOOKUP_EXISTS'
        ) {
          try {
            const resolvedCapture = await findExistingGeneratedImageCapture({
              captureIdentity,
              outputFormat: input.args.outputFormat,
              vaultRoot,
            })
            if (resolvedCapture.status === 'live') {
              generatedImageBytes = resolvedCapture.bytes
              savedCapture = resolvedCapture.capture
            } else if (resolvedCapture.status === 'deleted') {
              return {
                rpcSuccess: false,
                rpcText: 'saved generated image was deleted; make a new image request',
                usageDraft,
              }
            } else {
              return {
                rpcSuccess: false,
                rpcText: 'image generated but vault save failed',
                usageDraft,
              }
            }
          } catch {
            return {
              rpcSuccess: false,
              rpcText: 'image generated but vault save failed',
              usageDraft,
            }
          }
        } else {
          return {
            rpcSuccess: false,
            rpcText: 'image generated but vault save failed',
            usageDraft,
          }
        }
      }
    }
  }

  if (requireHostedPrivateImageDelivery) {
    if (!savedCapture) {
      return {
        rpcSuccess: false,
        rpcText: 'image generated but private vault capture failed',
        usageDraft,
      }
    }
    return {
      responseMedia: [
        {
          alt: input.args.alt ?? 'Generated image',
          contentType: generatedImageContentType(input.args.outputFormat),
          filename: path.posix.basename(savedCapture.imageRef),
          kind: 'vault_image',
          ref: savedCapture.imageRef,
          sha256: createHash('sha256').update(generatedImageBytes).digest('hex'),
          sizeBytes: generatedImageBytes.byteLength,
          source: OPENAI_IMAGE_GENERATION_MODEL,
        },
      ],
      rpcSuccess: true,
      rpcText:
        `generated image attached privately and saved to the vault as ${savedCapture.imageRef}`,
      savedCaptureId: savedCapture.captureId,
      savedImageRef: savedCapture.imageRef,
      usageDraft,
    }
  }

  try {
    const localPath = await writeLocalGeneratedImage({
      bytes: generatedImageBytes,
      codexHome: input.codexHome ?? input.env.CODEX_HOME ?? null,
      outputFormat: input.args.outputFormat,
    })
    return {
      rpcSuccess: true,
      rpcText: savedCapture
        ? `generated image saved at ${localPath.displayPath} and saved to the vault as ${savedCapture.imageRef}`
        : `generated image saved at ${localPath.displayPath}`,
      savedCaptureId: savedCapture?.captureId ?? null,
      savedImageRef: savedCapture?.imageRef ?? null,
      usageDraft,
    }
  } catch {
    return {
      rpcSuccess: false,
      rpcText: 'image generated but local save failed',
      usageDraft,
    }
  }
}

function hasVaultReferenceImageRef(refs: readonly string[]): boolean {
  try {
    return refs
      .map(normalizeGenerateImageReferenceRef)
      .some(isVaultReferenceImageRef)
  } catch {
    return false
  }
}

async function saveGeneratedImageCapture(input: {
  args: GenerateImageToolArgs
  bytes: Uint8Array
  captureIdentity: GeneratedImageCaptureIdentity
  occurredAt: string
  promptHash: string
  referenceImages: readonly ResolvedGenerateImageReference[]
  vaultRoot: string
}): Promise<SavedGeneratedImageCapture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-generated-image-'))
  try {
    const filename = input.captureIdentity.filename
    const sourcePath = path.join(tempRoot, filename)
    await writeFile(sourcePath, Buffer.from(input.bytes))

    const result = await addCaptureWithLookup({
      vaultRoot: input.vaultRoot,
      lookupAttachmentRole: 'media_1',
      lookupKey: input.captureIdentity.lookupKey,
      draft: {
        occurredAt: input.occurredAt,
        source: 'derived',
        tags: [...GENERATED_IMAGE_CAPTURE_TAGS],
        title: 'Generated image',
        note: 'Assistant-generated image saved for later visual reuse.',
      },
      attachments: [
        {
          kind: 'photo',
          role: 'media_1',
          sourcePath,
          targetName: filename,
        },
      ],
      rawImport: {
        importId: input.captureIdentity.rawImportId,
        importedAt: input.occurredAt,
        importKind: 'capture',
        source: GENERATED_IMAGE_CAPTURE_SOURCE,
        provenance: {
          family: 'capture',
          generatedImage: {
            model: OPENAI_IMAGE_GENERATION_MODEL,
            outputFormat: input.args.outputFormat,
            promptHash: input.promptHash,
            quality: input.args.quality,
            referenceImageCount: input.referenceImages.length,
            ...(input.referenceImages.length > 0
              ? { referenceImageSetHash: hashReferenceImageSet(input.referenceImages) }
              : {}),
            schema: GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA,
            size: input.args.size,
          },
          mediaCount: 1,
        },
      },
    })

    const imageRef = result.event.attachments?.find((attachment) =>
      attachment.role === 'media_1'
    )?.relativePath ?? null
    if (!imageRef) {
      throw new Error('Generated image capture did not produce a media ref.')
    }

    return {
      captureId: result.eventId,
      imageRef,
      manifestPath: result.manifestPath,
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
}

function buildGeneratedImageUsageDraft(input: {
  args: GenerateImageToolArgs
  occurredAt: string
  operation: GenerateImageOperation
  providerRequestId: string | null
  providerRequestOrdinal: number
  providerRequestOutcome: AssistantProviderUsageDraft['providerRequestOutcome']
  rawUsageJson: Record<string, unknown> | null
  referenceImageCount: number
  referenceImageSha256s: readonly string[]
  referenceImageSourceRefSha256s: readonly string[]
  referenceImageTotalBytes: number
  usage: OpenAiImageGenerationUsage | null
  usageExtractionSourcePath: GenerateImageUsageExtractionSourcePath
}): AssistantProviderUsageDraft {
  return {
    occurredAt: input.occurredAt,
    provider: 'openai-images',
    providerRequestOrdinal: input.providerRequestOrdinal,
    providerRequestOutcome: input.providerRequestOutcome,
    usage: {
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: OPENAI_IMAGES_BASE_URL,
      cacheWriteTokens: null,
      cachedInputTokens: input.usage?.input_tokens_details?.cached_tokens ?? null,
      inputTokens: input.usage?.input_tokens ?? null,
      outputTokens: input.usage?.output_tokens ?? null,
      providerMetadataJson: {
        ...(input.args.outputCompression !== undefined
          ? { imageOutputCompression: input.args.outputCompression }
          : {}),
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

function buildGeneratedImageCaptureIdentity(input: {
  idempotencyKey: string | null
  outputFormat: OpenAiImageOutputFormat
}): GeneratedImageCaptureIdentity {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey) ??
    `retention:${randomUUID()}`

  return {
    filename: generatedImageFilename(input.outputFormat, idempotencyKey),
    lookupKey: `murph.generated-image.capture.v1:${idempotencyKey}`,
    rawImportId: deterministicContractId(
      ID_PREFIXES.event,
      `murph.generated-image.raw-import.v1:${idempotencyKey}`,
    ),
  }
}

async function findExistingGeneratedImageCapture(input: {
  captureIdentity: GeneratedImageCaptureIdentity
  outputFormat: OpenAiImageOutputFormat
  vaultRoot: string
}): Promise<ExistingGeneratedImageCapture> {
  const found = await findCaptureByLookup({
    lookupKey: input.captureIdentity.lookupKey,
    vaultRoot: input.vaultRoot,
  })
  if (found.status === 'missing') {
    return { status: 'missing' }
  }
  if (found.status === 'deleted') {
    return { status: 'deleted' }
  }

  const imageRef = found.attachmentRef
  const bytes = new Uint8Array(await readFile(path.join(input.vaultRoot, imageRef)))
  if (!isValidGeneratedImageBytes({ bytes, outputFormat: input.outputFormat })) {
    throw new Error('Saved generated image bytes are invalid.')
  }

  return {
    status: 'live',
    bytes,
    capture: {
      captureId: found.eventId,
      imageRef,
      manifestPath: found.manifestPath,
    },
  }
}

function generatedImageFilename(
  outputFormat: OpenAiImageOutputFormat,
  idempotencyKey?: string | null,
): string {
  const stableKey = normalizeNullableString(idempotencyKey)
  const suffix = generatedImageFileExtension(outputFormat)
  if (!stableKey) {
    return `generated-${randomUUID()}.${suffix}`
  }

  return `generated-${hashGeneratedImageStableName(stableKey)}.${suffix}`
}

function generatedImageFileExtension(outputFormat: OpenAiImageOutputFormat): string {
  return outputFormat === 'jpeg' ? 'jpg' : outputFormat
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

function hashGeneratedImageStableName(idempotencyKey: string): string {
  return createHash('sha256')
    .update('murph.generated-image.filename.v1')
    .update('\0')
    .update(idempotencyKey)
    .digest('hex')
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

function describeGenerateImageFailure(
  fallback: string,
  error: unknown,
): string {
  const diagnostic = describeVaultCliFailure(error)
  return diagnostic ? `${fallback}: ${diagnostic}` : fallback
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
