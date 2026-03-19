import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import { resolveAssistantVaultPath } from './assistant-vault-paths.js'
import {
  createInboxRoutingAssistantToolCatalog,
} from './assistant-cli-tools.js'
import {
  generateAssistantObject,
  resolveAssistantLanguageModel,
  type AssistantModelMessage,
  type AssistantModelSpec,
} from './model-harness.js'
import type { InboxShowResult } from './inbox-cli-contracts.js'
import type { InboxCliServices } from './inbox-services.js'
import {
  assistantExecutionPlanSchema,
  inboxModelAttachmentBundleSchema,
  inboxModelBundleResultSchema,
  inboxModelBundleSchema,
  inboxModelRouteResultSchema,
  type InboxModelAttachmentBundle,
  type InboxModelBundle,
  type InboxModelBundleResult,
  type InboxModelInputMode,
  type InboxModelRouteResult,
} from './inbox-model-contracts.js'
import {
  getRoutingImageEligibility,
  type RoutingImageEligibility,
} from './inbox-routing-vision.js'
import type { VaultCliServices } from './vault-cli-services.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_MAX_FRAGMENT_CHARS = 6000
const DEFAULT_MAX_ROUTING_CHARS = 24000
const ASSISTANT_ARTIFACT_DIRECTORY = path.posix.join('derived', 'inbox')

const parserManifestSchema = z.object({
  schema: z.literal('healthybob.parser-manifest.v1'),
  paths: z.object({
    plainTextPath: z.string().min(1),
    markdownPath: z.string().min(1),
    tablesPath: z.string().min(1).nullable().optional(),
  }),
})

interface PreparedRoutingImage {
  ordinal: number
  fileName: string | null
  mediaType: string | null
  bytes: Buffer
}

interface PreparedInboxPlacementInput {
  prompt: string
  inputMode: InboxModelInputMode
  messages?: AssistantModelMessage[]
  fallbackError: string | null
}

export interface BuildInboxModelBundleInput {
  inboxServices: InboxCliServices
  requestId?: string | null
  captureId: string
  vault: string
  vaultServices?: VaultCliServices
}

export interface RouteInboxCaptureWithModelInput
  extends BuildInboxModelBundleInput {
  apply?: boolean
  modelSpec: AssistantModelSpec
}

export async function buildInboxModelBundle(
  input: BuildInboxModelBundleInput,
): Promise<InboxModelBundle> {
  return (await prepareInboxModelSession(input)).bundle
}

export async function materializeInboxModelBundle(
  input: BuildInboxModelBundleInput,
): Promise<InboxModelBundleResult> {
  const { bundle } = await prepareInboxModelSession(input)
  const bundlePath = await writeAssistantArtifact(
    input.vault,
    input.captureId,
    'bundle.json',
    bundle,
  )

  return inboxModelBundleResultSchema.parse({
    vault: input.vault,
    captureId: input.captureId,
    bundlePath,
    bundle,
  })
}

export async function routeInboxCaptureWithModel(
  input: RouteInboxCaptureWithModelInput,
): Promise<InboxModelRouteResult> {
  const { bundle, toolCatalog } = await prepareInboxModelSession(input)
  const bundlePath = await writeAssistantArtifact(
    input.vault,
    input.captureId,
    'bundle.json',
    bundle,
  )
  const model = resolveAssistantLanguageModel(input.modelSpec)
  const preparedInput = await prepareInboxPlacementInput({
    bundle,
    vaultRoot: input.vault,
  })

  let inputMode = preparedInput.inputMode
  let fallbackError = preparedInput.fallbackError
  let rawPlan: unknown

  try {
    rawPlan = await generateAssistantObject(
      buildInboxPlacementGenerationInput(model, preparedInput),
    )
  } catch (error) {
    if (inputMode === 'multimodal' && shouldRetryMultimodalAsTextOnly(error)) {
      inputMode = 'text-only'
      fallbackError = errorMessage(error)
      rawPlan = await generateAssistantObject({
        model,
        schema: assistantExecutionPlanSchema,
        schemaName: 'healthybob_assistant_plan',
        system: buildInboxPlacementSystemPrompt(),
        prompt: preparedInput.prompt,
      })
    } else {
      throw error
    }
  }

  const plan = validateAssistantPlan(rawPlan, toolCatalog)
  const planPath = await writeAssistantArtifact(
    input.vault,
    input.captureId,
    'plan.json',
    plan,
  )
  const results = await toolCatalog.executeCalls({
    calls: plan.actions,
    maxCalls: 4,
    mode: input.apply ? 'apply' : 'preview',
  })
  const resultPath = await writeAssistantArtifact(
    input.vault,
    input.captureId,
    'result.json',
    {
      schema: 'healthybob.assistant-plan-result.v1',
      apply: input.apply ?? false,
      preparedInputMode: bundle.preparedInputMode,
      inputMode,
      fallbackError,
      results,
    },
  )

  return inboxModelRouteResultSchema.parse({
    vault: input.vault,
    captureId: input.captureId,
    apply: input.apply ?? false,
    bundlePath,
    planPath,
    resultPath,
    preparedInputMode: bundle.preparedInputMode,
    inputMode,
    fallbackError,
    model: {
      model: input.modelSpec.model,
      providerMode: input.modelSpec.baseUrl ? 'openai-compatible' : 'gateway',
      baseUrl: input.modelSpec.baseUrl ?? null,
      providerName: input.modelSpec.providerName ?? null,
    },
    plan,
    results,
  })
}

async function prepareInboxModelSession(
  input: BuildInboxModelBundleInput,
): Promise<{
  bundle: InboxModelBundle
  toolCatalog: ReturnType<typeof createInboxRoutingAssistantToolCatalog>
}> {
  const shown = await input.inboxServices.show({
    vault: input.vault,
    requestId: input.requestId ?? null,
    captureId: input.captureId,
  })
  const toolCatalog = createInboxRoutingAssistantToolCatalog({
    inboxServices: input.inboxServices,
    requestId: input.requestId ?? null,
    captureId: input.captureId,
    vault: input.vault,
    vaultServices: input.vaultServices,
  })
  const tools = toolCatalog.listTools()
  const attachments = await Promise.all(
    shown.capture.attachments.map((attachment) =>
      buildAttachmentBundle({
        attachment,
        vaultRoot: input.vault,
      }),
    ),
  )
  const preparedInputMode = inferPreparedInputMode(attachments)
  const routingText = clampText(
    renderRoutingText(shown.capture, attachments, preparedInputMode),
    DEFAULT_MAX_ROUTING_CHARS,
  ).text

  return {
    toolCatalog,
    bundle: inboxModelBundleSchema.parse({
      schema: 'healthybob.inbox-model-bundle.v1',
      captureId: shown.capture.captureId,
      eventId: shown.capture.eventId,
      source: shown.capture.source,
      accountId: shown.capture.accountId ?? null,
      threadId: shown.capture.threadId,
      threadTitle: shown.capture.threadTitle ?? null,
      actorId: shown.capture.actorId ?? null,
      actorName: shown.capture.actorName ?? null,
      actorIsSelf: shown.capture.actorIsSelf,
      occurredAt: shown.capture.occurredAt,
      receivedAt: shown.capture.receivedAt ?? null,
      envelopePath: shown.capture.envelopePath,
      captureText: shown.capture.text ?? null,
      attachments,
      tools,
      preparedInputMode,
      routingText,
    }),
  }
}

function buildInboxPlacementSystemPrompt(): string {
  return [
    'You are the Healthy Bob assistant routing model.',
    'Choose the smallest safe set of CLI tool calls needed to place the capture into canonical storage.',
    'Prefer inbox.promote.* tools when a single capture-level promotion fits the evidence.',
    'Use broader vault.* tools only when the capture clearly contains structured data that should be written directly.',
    'When routing images are attached, treat them as raw evidence alongside the normalized text bundle.',
    'Do not invent facts that are not present in the normalized bundle or clearly visible in attached routing images.',
    'If the capture should not be written yet, return an empty actions array.',
    'Return JSON only.',
  ].join(' ')
}

function buildInboxPlacementPrompt(bundle: InboxModelBundle): string {
  const responseShape = {
    schema: 'healthybob.assistant-plan.v1',
    summary: 'one-sentence routing summary',
    rationale: 'brief explanation grounded in the bundle',
    actions: [
      {
        tool: 'inbox.promote.journal',
        input: {
          captureId: bundle.captureId,
        },
      },
    ],
  }

  return [
    'Choose zero to four tool calls from the catalog below.',
    'When a single inbox promotion tool safely captures the intent, prefer that over lower-level writes.',
    'If you choose a tool, copy the input field names exactly as shown in the example.',
    'If raw routing images are attached as additional message parts, use them as evidence. Otherwise rely only on the text bundle below.',
    '',
    'Available tools:',
    renderToolCatalog(bundle.tools),
    '',
    'Return JSON with exactly this shape:',
    JSON.stringify(responseShape, null, 2),
    '',
    'Normalized capture bundle:',
    bundle.routingText,
  ].join('\n')
}

function buildInboxPlacementGenerationInput(
  model: ReturnType<typeof resolveAssistantLanguageModel>,
  preparedInput: PreparedInboxPlacementInput,
) {
  return {
    model,
    schema: assistantExecutionPlanSchema,
    schemaName: 'healthybob_assistant_plan',
    system: buildInboxPlacementSystemPrompt(),
    ...(preparedInput.inputMode === 'multimodal' && preparedInput.messages
      ? {
          messages: preparedInput.messages,
        }
      : {
          prompt: preparedInput.prompt,
        }),
  }
}

async function prepareInboxPlacementInput(input: {
  bundle: InboxModelBundle
  vaultRoot: string
}): Promise<PreparedInboxPlacementInput> {
  const prompt = buildInboxPlacementPrompt(input.bundle)
  if (input.bundle.preparedInputMode === 'text-only') {
    return {
      prompt,
      inputMode: 'text-only',
      fallbackError: null,
    }
  }

  const routingImages = await readPreparedRoutingImages({
    attachments: input.bundle.attachments,
    vaultRoot: input.vaultRoot,
  })

  if (routingImages.images.length === 0) {
    return {
      prompt,
      inputMode: 'text-only',
      fallbackError:
        routingImages.error ??
        'Falling back to text-only routing because no eligible image evidence could be loaded.',
    }
  }

  const content: AssistantModelMessage['content'] = [
    {
      type: 'text',
      text: prompt,
    },
  ]

  for (const image of routingImages.images) {
    content.push({
      type: 'text',
      text: `Routing image ${image.ordinal}${image.fileName ? ` (${image.fileName})` : ''}.`,
    })
    content.push({
      type: 'image',
      image: image.bytes,
      ...(image.mediaType
        ? {
            mediaType: image.mediaType,
            mimeType: image.mediaType,
          }
        : {}),
    })
  }

  return {
    prompt,
    inputMode: 'multimodal',
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    fallbackError: null,
  }
}

function validateAssistantPlan(
  value: unknown,
  toolCatalog: ReturnType<typeof createInboxRoutingAssistantToolCatalog>,
) {
  const plan = assistantExecutionPlanSchema.parse(value)

  for (const action of plan.actions) {
    if (!toolCatalog.hasTool(action.tool)) {
      throw new VaultCliError(
        'ASSISTANT_PLAN_TOOL_UNKNOWN',
        `Assistant plan selected unknown tool "${action.tool}".`,
      )
    }
  }

  return plan
}

async function buildAttachmentBundle(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle> {
  const routingImage = getRoutingImageEligibility(input.attachment)
  const fragments = [
    buildMetadataFragment(input.attachment, routingImage),
    ...buildInlineTextFragments(input.attachment),
    ...(await buildDerivedTextFragments(input.vaultRoot, input.attachment.derivedPath)),
  ]
  const combinedText = fragments
    .map((fragment) => `[${fragment.label}]\n${fragment.text}`)
    .join('\n\n')

  return inboxModelAttachmentBundleSchema.parse({
    attachmentId:
      input.attachment.attachmentId ?? `attachment-${input.attachment.ordinal}`,
    ordinal: input.attachment.ordinal,
    kind: input.attachment.kind,
    mime: input.attachment.mime ?? null,
    fileName: input.attachment.fileName ?? null,
    storedPath: input.attachment.storedPath ?? null,
    parseState: input.attachment.parseState ?? null,
    routingImage,
    fragments,
    combinedText,
  })
}

function buildMetadataFragment(
  attachment: InboxShowResult['capture']['attachments'][number],
  routingImage: RoutingImageEligibility,
) {
  const metadataLines = [
    `attachmentId: ${attachment.attachmentId ?? `attachment-${attachment.ordinal}`}`,
    `ordinal: ${attachment.ordinal}`,
    `kind: ${attachment.kind}`,
    `mime: ${attachment.mime ?? 'unknown'}`,
    `fileName: ${attachment.fileName ?? 'unknown'}`,
    `storedPath: ${attachment.storedPath ?? 'missing'}`,
    `parseState: ${attachment.parseState ?? 'unknown'}`,
    `routingImageEligible: ${String(routingImage.eligible)}`,
    `routingImageReason: ${routingImage.reason}`,
    `routingImageMediaType: ${routingImage.mediaType ?? 'unknown'}`,
    `routingImageExtension: ${routingImage.extension ?? 'unknown'}`,
  ]
  const text = metadataLines.join('\n')
  return {
    kind: 'attachment_metadata' as const,
    label: `attachment-${attachment.ordinal}-metadata`,
    path: attachment.storedPath ?? null,
    text,
    truncated: false,
  }
}

function buildInlineTextFragments(
  attachment: InboxShowResult['capture']['attachments'][number],
) {
  const fragments: Array<{
    kind: 'attachment_extracted_text' | 'attachment_transcript'
    label: string
    path: string | null
    text: string
    truncated: boolean
  }> = []

  const extracted = normalizeNullableString(attachment.extractedText)
  if (extracted) {
    const clamped = clampText(extracted, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'attachment_extracted_text',
      label: `attachment-${attachment.ordinal}-extracted-text`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const transcript = normalizeNullableString(attachment.transcriptText)
  if (transcript) {
    const clamped = clampText(transcript, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'attachment_transcript',
      label: `attachment-${attachment.ordinal}-transcript`,
      path: attachment.derivedPath ?? attachment.storedPath ?? null,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  return fragments
}

async function buildDerivedTextFragments(
  vaultRoot: string,
  manifestPath: string | null | undefined,
) {
  const normalizedManifestPath = normalizeNullableString(manifestPath)
  if (!normalizedManifestPath) {
    return []
  }

  const manifest = await readParserManifest(vaultRoot, normalizedManifestPath)
  if (!manifest) {
    return []
  }

  const fragments: Array<{
    kind: 'derived_plain_text' | 'derived_markdown' | 'derived_tables'
    label: string
    path: string | null
    text: string
    truncated: boolean
  }> = []

  const plainText = await readRelativeTextFile(vaultRoot, manifest.paths.plainTextPath)
  if (plainText) {
    const clamped = clampText(plainText, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_plain_text',
      label: 'derived-plain-text',
      path: manifest.paths.plainTextPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const markdown = await readRelativeTextFile(vaultRoot, manifest.paths.markdownPath)
  if (markdown) {
    const clamped = clampText(markdown, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_markdown',
      label: 'derived-markdown',
      path: manifest.paths.markdownPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const tablesPath = normalizeNullableString(manifest.paths.tablesPath ?? null)
  if (tablesPath) {
    const tables = await readRelativeTextFile(vaultRoot, tablesPath)
    if (tables) {
      const clamped = clampText(tables, DEFAULT_MAX_FRAGMENT_CHARS)
      fragments.push({
        kind: 'derived_tables',
        label: 'derived-tables',
        path: tablesPath,
        text: clamped.text,
        truncated: clamped.truncated,
      })
    }
  }

  return fragments
}

function renderRoutingText(
  capture: InboxShowResult['capture'],
  attachments: InboxModelAttachmentBundle[],
  preparedInputMode: InboxModelInputMode,
): string {
  const lines: string[] = [
    `Capture id: ${capture.captureId}`,
    `Occurred at: ${capture.occurredAt}`,
    `Source: ${capture.source}`,
    `Thread: ${capture.threadId}${capture.threadTitle ? ` (${capture.threadTitle})` : ''}`,
    `Actor: ${capture.actorName ?? capture.actorId ?? 'unknown'} | self=${String(capture.actorIsSelf)}`,
    `Envelope path: ${capture.envelopePath}`,
    `Prepared input mode: ${preparedInputMode}`,
  ]

  const captureText = normalizeNullableString(capture.text)
  if (captureText) {
    lines.push('', 'Capture text:', captureText)
  }

  if (attachments.length > 0) {
    lines.push('', 'Attachment text bundle:')
    for (const attachment of attachments) {
      lines.push(
        '',
        `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`,
        attachment.combinedText.length > 0 ? attachment.combinedText : 'No attachment text available.',
      )
    }
  }

  return lines.join('\n')
}

function renderToolCatalog(tools: InboxModelBundle['tools']): string {
  return tools
    .map((tool, index) => {
      const example = tool.inputExample ? JSON.stringify(tool.inputExample) : '{}'
      return `${index + 1}. ${tool.name}\n   Description: ${tool.description}\n   Input example: ${example}`
    })
    .join('\n\n')
}

async function readParserManifest(
  vaultRoot: string,
  relativePath: string,
): Promise<z.infer<typeof parserManifestSchema> | null> {
  try {
    const raw = await readFile(await resolveAssistantVaultPath(vaultRoot, relativePath), 'utf8')
    return parserManifestSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

async function readRelativeTextFile(
  vaultRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return normalizeNullableString(
      await readFile(await resolveAssistantVaultPath(vaultRoot, relativePath), 'utf8'),
    )
  } catch {
    return null
  }
}

async function readPreparedRoutingImages(input: {
  attachments: InboxModelBundle['attachments']
  vaultRoot: string
}): Promise<{
  images: PreparedRoutingImage[]
  error: string | null
}> {
  const images: PreparedRoutingImage[] = []
  const errors: string[] = []

  for (const attachment of input.attachments) {
    if (!attachment.routingImage.eligible || !attachment.storedPath) {
      continue
    }

    try {
      const absolutePath = await resolveAssistantVaultPath(
        input.vaultRoot,
        attachment.storedPath,
        'file path',
      )
      images.push({
        ordinal: attachment.ordinal,
        fileName: attachment.fileName ?? null,
        mediaType: attachment.routingImage.mediaType ?? null,
        bytes: await readFile(absolutePath),
      })
    } catch (error) {
      errors.push(`attachment ${attachment.ordinal}: ${errorMessage(error)}`)
    }
  }

  return {
    images,
    error:
      images.length === 0 && errors.length > 0
        ? `Falling back to text-only routing because image evidence could not be loaded (${errors.join('; ')}).`
        : null,
  }
}

function inferPreparedInputMode(
  attachments: InboxModelAttachmentBundle[],
): InboxModelInputMode {
  return attachments.some((attachment) => attachment.routingImage.eligible)
    ? 'multimodal'
    : 'text-only'
}

function shouldRetryMultimodalAsTextOnly(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const mentionsImageInput = [
    'image',
    'vision',
    'multimodal',
    'multi-modal',
    'media type',
    'mime type',
    'input_image',
    'image_url',
  ].some((token) => message.includes(token))
  const signalsUnsupported = [
    'unsupported',
    'not support',
    'does not support',
    'invalid',
    'reject',
    'unknown',
  ].some((token) => message.includes(token))

  return mentionsImageInput && signalsUnsupported
}

async function writeAssistantArtifact(
  vaultRoot: string,
  captureId: string,
  fileName: string,
  value: unknown,
): Promise<string> {
  const relativeDirectory = path.posix.join(
    ASSISTANT_ARTIFACT_DIRECTORY,
    captureId,
    'assistant',
  )
  const relativePath = path.posix.join(relativeDirectory, fileName)
  const absoluteDirectory = path.join(vaultRoot, relativeDirectory)
  await mkdir(absoluteDirectory, { recursive: true })
  await writeFile(
    path.join(vaultRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
  return relativePath
}

function clampText(
  value: string,
  limit: number,
): {
  text: string
  truncated: boolean
} {
  const normalized = value.trim()
  if (normalized.length <= limit) {
    return {
      text: normalized,
      truncated: false,
    }
  }

  const suffix = `\n\n[truncated ${normalized.length - limit} characters]`
  const safeLimit = Math.max(0, limit - suffix.length)
  return {
    text: `${normalized.slice(0, safeLimit)}${suffix}`,
    truncated: true,
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}
