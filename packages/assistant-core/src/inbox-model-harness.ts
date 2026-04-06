import { mkdir, writeFile } from 'node:fs/promises'
import {
  resolveAssistantInboxArtifactPath,
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
  buildInboxModelAttachmentBundles,
  inferInboxMultimodalInputMode,
  prepareInboxMultimodalUserMessageContent,
} from './inbox-multimodal.js'
import { errorMessage, normalizeNullableString } from './text/shared.js'
import type { VaultServices } from './vault-services.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_MAX_ROUTING_CHARS = 24000

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
  const attachments = await buildInboxModelAttachmentBundles({
    attachments: shown.capture.attachments,
    captureId: shown.capture.captureId,
    vaultRoot: input.vault,
  })
  const preparedInputMode = inferInboxMultimodalInputMode(attachments)
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
    'Stored document attachments should normally end up preserved as canonical documents even when no stronger structured write is obvious.',
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
  const preparedMultimodalInput = await prepareInboxMultimodalUserMessageContent({
    attachmentSources: input.bundle.attachments.map((attachment) => ({
      attachment,
      captureId: input.bundle.captureId,
    })),
    fallbackContextLabel: 'routing',
    prompt,
    vaultRoot: input.vaultRoot,
  })

  if (preparedMultimodalInput.userMessageContent === null) {
    return {
      prompt,
      inputMode: 'text-only',
      fallbackError: preparedMultimodalInput.fallbackError,
    }
  }

  return {
    prompt,
    inputMode: 'multimodal',
    messages: [
      {
        role: 'user',
        content: preparedMultimodalInput.userMessageContent,
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
      const provenanceBits = [
        tool.provenance.origin,
        tool.provenance.localOnly ? 'local-only' : 'networked',
        tool.provenance.generatedFrom ? `generated:${tool.provenance.generatedFrom}` : null,
        tool.provenance.policyWrappers.length > 0
          ? `policies:${tool.provenance.policyWrappers.join(',')}`
          : null,
      ].filter((value): value is string => value !== null)

      return `${index + 1}. ${tool.name}\n   Description: ${tool.description}\n   Provenance: ${provenanceBits.join(' | ')}\n   Input example: ${example}`
    })
    .join('\n\n')
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
