import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import { normalizeOpaquePathSegment, normalizeRelativeVaultPath } from '@murphai/core'
import {
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from './assistant-vault-paths.js'
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
import type { InboxServices } from './inbox-services.js'
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
import { errorMessage, normalizeNullableString } from './text/shared.js'
import type { VaultServices } from './vault-services.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_MAX_FRAGMENT_CHARS = 6000
const DEFAULT_MAX_ROUTING_CHARS = 24000

const parserManifestSchema = z.object({
  schema: z.literal('murph.parser-manifest.v1'),
  paths: z.object({
    plainTextPath: z.string().min(1),
    markdownPath: z.string().min(1),
    tablesPath: z.string().min(1).nullable().optional(),
  }),
})

interface PreparedRoutingImage {
  kind: 'image'
  ordinal: number
  fileName: string | null
  mediaType: string | null
  bytes: Buffer
}

interface PreparedRoutingPdf {
  kind: 'pdf'
  ordinal: number
  fileName: string | null
  bytes: Buffer
}

type PreparedRoutingEvidence = PreparedRoutingImage | PreparedRoutingPdf

interface PreparedInboxPlacementInput {
  prompt: string
  inputMode: InboxModelInputMode
  messages?: AssistantModelMessage[]
  fallbackError: string | null
}

export interface BuildInboxModelBundleInput {
  inboxServices: InboxServices
  requestId?: string | null
  captureId: string
  vault: string
  vaultServices?: VaultServices
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
        schemaName: 'murph_assistant_plan',
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
      schema: 'murph.assistant-plan-result.v1',
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
        captureId: shown.capture.captureId,
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
      schema: 'murph.inbox-model-bundle.v1',
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
    'You are the Murph assistant routing model.',
    'Choose the smallest safe set of CLI tool calls needed to place the capture into canonical storage.',
    'Prefer inbox.promote.* tools when a single capture-level promotion fits the evidence.',
    'Use broader vault.* tools only when the capture clearly contains structured data that should be written directly.',
    'When routing images or fallback PDF files are attached, treat them as raw evidence alongside the normalized text bundle.',
    'Do not invent facts that are not present in the normalized bundle or clearly visible in attached routing images or PDFs.',
    'If the capture should not be written yet, return an empty actions array.',
    'Return JSON only.',
  ].join(' ')
}

function buildInboxPlacementPrompt(bundle: InboxModelBundle): string {
  const responseShape = {
    schema: 'murph.assistant-plan.v1',
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
    'If raw routing images or fallback PDFs are attached as additional message parts, use them as evidence. Otherwise rely only on the text bundle below.',
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
    schemaName: 'murph_assistant_plan',
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

  const routingEvidence = await readPreparedRoutingEvidence({
    attachments: input.bundle.attachments,
    captureId: input.bundle.captureId,
    vaultRoot: input.vaultRoot,
  })

  if (routingEvidence.evidence.length === 0) {
    return {
      prompt,
      inputMode: 'text-only',
      fallbackError:
        routingEvidence.error ??
        'Falling back to text-only routing because rich evidence could not be loaded.',
    }
  }

  const content: AssistantModelMessage['content'] = [
    {
      type: 'text',
      text: prompt,
    },
  ]

  for (const item of routingEvidence.evidence) {
    if (item.kind === 'image') {
      content.push({
        type: 'text',
        text: `Routing image ${item.ordinal}${item.fileName ? ` (${item.fileName})` : ''}.`,
      })
      content.push({
        type: 'image',
        image: item.bytes,
        ...(item.mediaType
          ? {
              mediaType: item.mediaType,
              mimeType: item.mediaType,
            }
          : {}),
      })
      continue
    }

    content.push({
      type: 'text',
      text: `Routing PDF ${item.ordinal}${item.fileName ? ` (${item.fileName})` : ''}.`,
    })
    content.push({
      type: 'file',
      data: item.bytes,
      mediaType: 'application/pdf',
      ...(item.fileName ? { filename: item.fileName } : {}),
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
  captureId: string
  vaultRoot: string
}): Promise<InboxModelAttachmentBundle> {
  const routingImage = getRoutingImageEligibility(input.attachment)
  const fragments = [
    buildMetadataFragment(input.attachment, routingImage),
    ...buildInlineTextFragments(input.attachment),
    ...(await buildDerivedTextFragments({
      attachment: input.attachment,
      captureId: input.captureId,
      vaultRoot: input.vaultRoot,
    })),
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

async function buildDerivedTextFragments(input: {
  attachment: InboxShowResult['capture']['attachments'][number]
  captureId: string
  vaultRoot: string
}) {
  const allowedDerivedPrefixes = buildAllowedDerivedPrefixes(
    input.captureId,
    input.attachment,
  )
  const normalizedManifestPath = normalizeAnchoredVaultRelativePath(
    input.attachment.derivedPath,
    allowedDerivedPrefixes,
  )
  if (!normalizedManifestPath) {
    return []
  }

  const manifest = await readParserManifest(input.vaultRoot, normalizedManifestPath)
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

  const plainTextPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.plainTextPath,
    allowedDerivedPrefixes,
  )
  const plainText = plainTextPath
    ? await readRelativeTextFile(input.vaultRoot, plainTextPath)
    : null
  if (plainText) {
    const clamped = clampText(plainText, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_plain_text',
      label: 'derived-plain-text',
      path: plainTextPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const markdownPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.markdownPath,
    allowedDerivedPrefixes,
  )
  const markdown = markdownPath
    ? await readRelativeTextFile(input.vaultRoot, markdownPath)
    : null
  if (markdown) {
    const clamped = clampText(markdown, DEFAULT_MAX_FRAGMENT_CHARS)
    fragments.push({
      kind: 'derived_markdown',
      label: 'derived-markdown',
      path: markdownPath,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  const tablesPath = normalizeAnchoredVaultRelativePath(
    manifest.paths.tablesPath ?? null,
    allowedDerivedPrefixes,
  )
  if (tablesPath) {
    const tables = await readRelativeTextFile(input.vaultRoot, tablesPath)
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

async function readPreparedRoutingEvidence(input: {
  attachments: InboxModelBundle['attachments']
  captureId: string
  vaultRoot: string
}): Promise<{
  evidence: PreparedRoutingEvidence[]
  error: string | null
}> {
  const evidence: PreparedRoutingEvidence[] = []
  const errors: string[] = []

  for (const attachment of input.attachments) {
    const storedPath = normalizeCaptureStoredAttachmentPath(
      attachment.storedPath ?? null,
      input.captureId,
    )
    const shouldLoadImage = attachment.routingImage.eligible
    const shouldLoadPdf = isRoutingPdfFallbackCandidate(attachment)
    if ((!shouldLoadImage && !shouldLoadPdf) || !attachment.storedPath) {
      continue
    }

    try {
      if (!storedPath) {
        throw new Error('attachment stored path is outside the capture attachment subtree')
      }
      const absolutePath = await resolveAssistantVaultPath(
        input.vaultRoot,
        storedPath,
        'file path',
      )
      const bytes = await readFile(absolutePath)

      if (shouldLoadImage) {
        evidence.push({
          kind: 'image',
          ordinal: attachment.ordinal,
          fileName: attachment.fileName ?? null,
          mediaType: attachment.routingImage.mediaType ?? null,
          bytes,
        })
      } else {
        evidence.push({
          kind: 'pdf',
          ordinal: attachment.ordinal,
          fileName: attachment.fileName ?? null,
          bytes,
        })
      }
    } catch (error) {
      errors.push(
        `attachment ${attachment.ordinal} (${shouldLoadPdf ? 'pdf' : 'image'}): ${errorMessage(error)}`,
      )
    }
  }

  return {
    evidence,
    error:
      evidence.length === 0 && errors.length > 0
        ? `Falling back to text-only routing because rich evidence could not be loaded (${errors.join('; ')}).`
        : null,
  }
}

function buildAllowedDerivedPrefixes(
  captureId: string,
  attachment: InboxShowResult['capture']['attachments'][number],
): string[] {
  const normalizedCaptureId = normalizeOpaquePathSegment(captureId, 'Capture id')
  const prefixes = [
    normalizeRelativeVaultPath(
      path.posix.join(
        'derived',
        'inbox',
        normalizedCaptureId,
        `attachment-${attachment.ordinal}`,
      ),
    ),
  ]
  const attachmentId = normalizeNullableString(attachment.attachmentId)
  if (attachmentId) {
    prefixes.push(
      normalizeRelativeVaultPath(
        path.posix.join(
          'derived',
          'inbox',
          normalizedCaptureId,
          'attachments',
          normalizeOpaquePathSegment(attachmentId, 'Attachment id'),
        ),
      ),
    )
  }
  return prefixes.map((prefix) => `${prefix}/`)
}

function normalizeCaptureStoredAttachmentPath(
  candidatePath: string | null | undefined,
  captureId: string,
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(normalizedCandidate)
    return isCaptureStoredAttachmentPath(normalized, captureId) ? normalized : null
  } catch {
    return null
  }
}

function isCaptureStoredAttachmentPath(
  normalizedStoredPath: string,
  captureId: string,
): boolean {
  const normalizedCaptureId = normalizeOpaquePathSegment(captureId, 'Capture id')
  const segments = normalizedStoredPath.split('/')
  const attachmentsIndex = segments.indexOf('attachments')
  return (
    segments[0] === 'raw' &&
    segments[1] === 'inbox' &&
    attachmentsIndex >= 3 &&
    attachmentsIndex < segments.length - 1 &&
    segments[attachmentsIndex - 1] === normalizedCaptureId
  )
}

function normalizeAnchoredVaultRelativePath(
  candidatePath: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  const normalizedCandidate = normalizeNullableString(candidatePath)
  if (!normalizedCandidate) {
    return null
  }

  try {
    const normalized = normalizeRelativeVaultPath(normalizedCandidate)
    return allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
      ? normalized
      : null
  } catch {
    return null
  }
}

function inferPreparedInputMode(
  attachments: InboxModelAttachmentBundle[],
): InboxModelInputMode {
  return attachments.some(
    (attachment) =>
      attachment.routingImage.eligible || isRoutingPdfFallbackCandidate(attachment),
  )
    ? 'multimodal'
    : 'text-only'
}

function shouldRetryMultimodalAsTextOnly(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const mentionsImageInput = [
    'image',
    'file',
    'pdf',
    'document',
    'vision',
    'multimodal',
    'multi-modal',
    'media type',
    'mime type',
    'input_image',
    'image_url',
    'input_file',
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

function isRoutingPdfFallbackCandidate(
  attachment: InboxModelAttachmentBundle,
): boolean {
  return (
    attachment.kind === 'document' &&
    isPdfAttachment({
      fileName: attachment.fileName,
      mime: attachment.mime,
    }) &&
    typeof attachment.storedPath === 'string' &&
    attachment.storedPath.length > 0 &&
    attachment.parseState !== 'pending' &&
    attachment.parseState !== 'running' &&
    !attachment.fragments.some((fragment) => fragment.kind !== 'attachment_metadata')
  )
}

function isPdfAttachment(input: {
  fileName: string | null
  mime: string | null
}): boolean {
  const fileName = input.fileName?.toLowerCase() ?? ''
  const mime = input.mime?.toLowerCase() ?? ''
  return fileName.endsWith('.pdf') || mime === 'application/pdf'
}

async function writeAssistantArtifact(
  vaultRoot: string,
  captureId: string,
  fileName: string,
  value: unknown,
): Promise<string> {
  const artifactPath = await resolveAssistantInboxArtifactPath(
    vaultRoot,
    captureId,
    fileName,
  )
  await mkdir(artifactPath.absoluteDirectory, { recursive: true })
  await writeFile(
    artifactPath.absolutePath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
  return artifactPath.relativePath
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
