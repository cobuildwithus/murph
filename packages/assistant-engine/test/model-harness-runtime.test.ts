import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Mock } from 'vitest'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxServices } from '@murphai/inbox-services'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { AssistantToolSpec } from '../src/inbox-model-contracts.ts'

const harnessMocks = vi.hoisted(() => ({
  OutputObject: vi.fn((input: { schema: z.ZodTypeAny }) => ({
    kind: 'output-object',
    schema: input.schema,
  })),
  createInboxRoutingAssistantToolCatalog: vi.fn(),
  createOpenAI: vi.fn(),
  createOpenAICompatible: vi.fn(),
  gateway: vi.fn((model: string) => ({
    provider: 'gateway',
    model,
  })),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  stepCountIs: vi.fn((count: number) => ({
    kind: 'step-count',
    count,
  })),
  tool: vi.fn((definition: unknown) => definition),
}))

vi.mock('ai', () => ({
  Output: {
    object: harnessMocks.OutputObject,
  },
  generateObject: harnessMocks.generateObject,
  generateText: harnessMocks.generateText,
  gateway: harnessMocks.gateway,
  stepCountIs: harnessMocks.stepCountIs,
  tool: harnessMocks.tool,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: harnessMocks.createOpenAI,
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: harnessMocks.createOpenAICompatible,
}))

vi.mock('../src/assistant-cli-tools.ts', () => ({
  createInboxRoutingAssistantToolCatalog:
    harnessMocks.createInboxRoutingAssistantToolCatalog,
}))

import {
  buildInboxModelBundle,
  materializeInboxModelBundle,
  routeInboxCaptureWithModel,
} from '../src/inbox-model-harness.ts'
import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  inferInboxMultimodalInputMode,
  prepareInboxMultimodalUserMessageContent,
} from '../src/inbox-multimodal.ts'
import {
  getRoutingImageEligibility,
  shouldBypassParserWaitForRouting,
} from '../src/inbox-routing-vision.ts'
import {
  CliBackedCapabilityHost,
  NativeLocalCapabilityHost,
  createAssistantCapabilityRegistry,
  createAssistantToolCatalogFromCapabilities,
  defineAssistantCapability,
  generateAssistantObject,
  resolveAssistantLanguageModel,
} from '../src/model-harness.ts'
import { createTempVaultContext, restoreEnvironmentVariable } from './test-helpers.js'

const originalAssistantApiKey = process.env.ASSISTANT_API_KEY
const tempRoots: string[] = []

beforeEach(() => {
  harnessMocks.generateObject.mockReset()
  harnessMocks.generateText.mockReset()
  harnessMocks.stepCountIs.mockClear()
  harnessMocks.OutputObject.mockClear()
  harnessMocks.tool.mockClear()
  harnessMocks.gateway.mockClear()
  harnessMocks.createInboxRoutingAssistantToolCatalog.mockReset()
  harnessMocks.createOpenAI.mockReset()
  harnessMocks.createOpenAICompatible.mockReset()
  harnessMocks.createOpenAI.mockImplementation((options) => ({
    responses: (model: string) => ({
      provider: 'openai-responses',
      model,
      options,
    }),
  }))
  harnessMocks.createOpenAICompatible.mockImplementation((options) => {
    return (model: string) => ({
      provider: 'openai-compatible',
      model,
      options,
    })
  })
})

afterEach(async () => {
  restoreEnvironmentVariable('ASSISTANT_API_KEY', originalAssistantApiKey)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await Promise.all(
    tempRoots.splice(0).map(async (parentRoot) => {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }),
  )
})

describe('model harness runtime helpers', () => {
  it('routes tool-driven object generation through generateText and falls back to output payloads', async () => {
    const schema = z.object({
      status: z.string(),
    })
    const model = resolveAssistantLanguageModel({
      executionDriver: 'gateway',
      model: 'murph-mini',
    })
    const previewTools = createAssistantToolCatalogFromCapabilities(
      [
        defineAssistantCapability({
          description: 'Echo input.',
          executionBindings: {
            'native-local': async ({ value }: { value: string }) => ({
              value,
            }),
          },
          inputSchema: z.object({
            value: z.string(),
          }),
          name: 'echo',
        }),
      ],
      [new NativeLocalCapabilityHost()],
    ).createAiSdkTools('preview')
    harnessMocks.generateText.mockResolvedValue({
      output: {
        status: 'ok',
      },
    })

    await expect(
      generateAssistantObject({
        maxSteps: 3,
        model,
        prompt: 'Summarize the bundle.',
        schema,
        tools: previewTools,
      }),
    ).resolves.toEqual({
      status: 'ok',
    })

    expect(harnessMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        prompt: 'Summarize the bundle.',
        stopWhen: {
          kind: 'step-count',
          count: 3,
        },
        tools: previewTools,
      }),
    )
    expect(harnessMocks.OutputObject).toHaveBeenCalledWith({
      schema,
    })
  })

  it('requires prompt or messages and resolves gateway plus provider-backed models', async () => {
    const schema = z.object({
      status: z.string(),
    })
    const gatewayModel = resolveAssistantLanguageModel({
      executionDriver: 'gateway',
      model: 'murph-gateway',
    })

    expect(gatewayModel).toEqual({
      model: 'murph-gateway',
      provider: 'gateway',
    })

    await expect(
      generateAssistantObject({
        model: gatewayModel,
        schema,
      }),
    ).rejects.toThrow(
      'Assistant generation requires either a prompt string or at least one message.',
    )

    process.env.ASSISTANT_API_KEY = 'env-secret'
    const compatibleModel = resolveAssistantLanguageModel({
      apiKeyEnv: 'ASSISTANT_API_KEY',
      baseUrl: 'https://router.example.com/v1',
      headers: {
        'x-test-header': '1',
      },
      model: 'router-model',
      providerName: '  ',
    })

    expect(compatibleModel).toEqual({
      model: 'router-model',
      options: {
        apiKey: 'env-secret',
        baseURL: 'https://router.example.com/v1',
        headers: {
          'x-test-header': '1',
        },
        name: 'murph-assistant',
      },
      provider: 'openai-compatible',
    })

    expect(harnessMocks.createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-secret',
        baseURL: 'https://router.example.com/v1',
        name: 'murph-assistant',
      }),
    )
  })

  it('injects OpenAI responses compaction metadata on compatible responses requests', async () => {
    const fetchMock: Mock<
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>
    > = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    process.env.ASSISTANT_API_KEY = 'openai-secret'

    const model = resolveAssistantLanguageModel({
      apiKeyEnv: 'ASSISTANT_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
      executionDriver: 'openai-responses',
      model: 'gpt-4.1-mini',
      providerName: ' Murph Hosted ',
    })

    expect(model).toEqual({
      model: 'gpt-4.1-mini',
      options: expect.objectContaining({
        apiKey: 'openai-secret',
        baseURL: 'https://api.openai.com/v1',
        name: 'Murph Hosted',
      }),
      provider: 'openai-responses',
    })

    const fetchWrapper = harnessMocks.createOpenAI.mock.calls[0]?.[0]?.fetch as
      | ((input: string, init?: RequestInit) => Promise<Response>)
      | undefined
    expect(fetchWrapper).toBeTypeOf('function')

    await fetchWrapper?.('https://api.openai.com/v1/responses', {
      body: JSON.stringify({
        input: 'hello',
      }),
      method: 'POST',
    })

    const firstFetchCall = fetchMock.mock.calls[0]
    expect(firstFetchCall).toBeTruthy()
    const injectedBody = JSON.parse(String(firstFetchCall?.[1]?.body))
    expect(injectedBody).toMatchObject({
      input: 'hello',
    })
    expect(injectedBody.context_management).toEqual([
      {
        compact_threshold: 200000,
        type: 'compaction',
      },
    ])
  })

  it('infers capability metadata, validates bindings, and rejects duplicate registrations', () => {
    const cliCapability = defineAssistantCapability({
      description: 'Run the CLI.',
      executionBindings: {
        'cli-backed': async ({ command }: { command: string }) => ({
          command,
        }),
      },
      inputSchema: z.object({
        command: z.string(),
      }),
      name: 'vault.cli.run',
    })
    const hostedCapability = defineAssistantCapability({
      description: 'Create a share link.',
      executionBindings: {
        'native-local': async ({ captureId }: { captureId: string }) => ({
          captureId,
        }),
      },
      inputSchema: z.object({
        captureId: z.string(),
      }),
      name: 'vault.share.createLink',
    })
    const webCapability = defineAssistantCapability({
      description: 'Read a web page.',
      executionBindings: {
        'native-local': async ({ url }: { url: string }) => ({
          url,
        }),
      },
      inputSchema: z.object({
        url: z.string(),
      }),
      name: 'web.fetch',
    })
    const fileCapability = defineAssistantCapability({
      description: 'Read a local file.',
      executionBindings: {
        'native-local': async ({ path }: { path: string }) => ({
          path,
        }),
      },
      inputSchema: z.object({
        path: z.string(),
      }),
      name: 'vault.fs.readText',
    })
    const inboxCapability = defineAssistantCapability({
      description: 'Promote a journal entry.',
      executionBindings: {
        'native-local': async ({ captureId }: { captureId: string }) => ({
          captureId,
        }),
      },
      inputSchema: z.object({
        captureId: z.string(),
      }),
      name: 'inbox.promote.journal',
    })
    const helperCapability = defineAssistantCapability({
      description: 'Peek a helper note.',
      executionBindings: {
        'native-local': async ({ noteId }: { noteId: string }) => ({
          noteId,
        }),
      },
      inputSchema: z.object({
        noteId: z.string(),
      }),
      name: 'assistant.note.peek',
    })

    expect(cliCapability).toMatchObject({
      backendKind: 'cli-wrapper',
      mutationSemantics: 'mixed',
      preferredHostKind: 'cli-backed',
      provenance: {
        generatedFrom: 'vault-cli',
        origin: 'cli-backed',
      },
      riskClass: 'high',
    })
    expect(hostedCapability).toMatchObject({
      backendKind: 'hosted-api',
      mutationSemantics: 'outward-side-effect',
      provenance: {
        localOnly: false,
        origin: 'hosted-api-backed',
      },
      riskClass: 'high',
    })
    expect(webCapability).toMatchObject({
      backendKind: 'configured-web-read',
      mutationSemantics: 'read-only',
      provenance: {
        origin: 'configured-web-read',
      },
      riskClass: 'low',
    })
    expect(fileCapability).toMatchObject({
      backendKind: 'native-file',
      mutationSemantics: 'read-only',
      provenance: {
        origin: 'native-local-only',
        policyWrappers: ['output-redaction'],
      },
    })
    expect(inboxCapability).toMatchObject({
      backendKind: 'local-service',
      mutationSemantics: 'canonical-write',
      provenance: {
        origin: 'vault-service-backed',
      },
    })
    expect(helperCapability).toMatchObject({
      backendKind: 'local-service',
      mutationSemantics: 'read-only',
      provenance: {
        origin: 'hand-authored-helper',
      },
      riskClass: 'low',
    })

    expect(() =>
      defineAssistantCapability({
        description: 'Missing bindings.',
        executionBindings: {},
        inputSchema: z.object({
          value: z.string(),
        }),
        name: 'assistant.invalid.empty',
      }),
    ).toThrow(
      'Assistant capability "assistant.invalid.empty" must declare at least one execution binding.',
    )

    expect(() =>
      defineAssistantCapability({
        description: 'Preferred host missing.',
        executionBindings: {
          'native-local': async ({ value }: { value: string }) => ({
            value,
          }),
        },
        inputSchema: z.object({
          value: z.string(),
        }),
        name: 'assistant.invalid.preferred-host',
        preferredHostKind: 'cli-backed',
      }),
    ).toThrow(
      'Assistant capability "assistant.invalid.preferred-host" prefers host "cli-backed" but does not declare a binding for it.',
    )

    expect(() =>
      createAssistantCapabilityRegistry([helperCapability, helperCapability]),
    ).toThrow(
      'Duplicate assistant capability "assistant.note.peek" cannot be registered.',
    )
  })

  it('binds tool catalogs across hosts and reports preview, failure, invalid-input, unknown-tool, and skipped results', async () => {
    const startedEvents: unknown[] = []
    const successEvents: unknown[] = []
    const failureEvents: unknown[] = []

    const previewCapabilities = [
      defineAssistantCapability({
        description: 'Execute via CLI first.',
        executionBindings: {
          'cli-backed': async ({ value }: { value: string }) => ({
            value,
          }),
          'native-local': async ({ value }: { value: string }) => ({
            value: `${value}-native`,
          }),
        },
        inputExample: {
          value: 'example',
        },
        inputSchema: z.object({
          value: z.string(),
        }),
        name: 'vault.cli.run',
        outputSchema: z.object({
          value: z.string(),
        }),
      }),
      defineAssistantCapability({
        description: 'Fallback to native binding when the preferred host is unavailable.',
        executionBindings: {
          'native-local': async ({ noteId }: { noteId: string }) => ({
            noteId,
          }),
        },
        inputSchema: z.object({
          noteId: z.string(),
        }),
        name: 'assistant.note.peek',
      }),
    ] as const
    const previewRegistry = createAssistantCapabilityRegistry(previewCapabilities)
    const previewCatalog = previewRegistry.createToolCatalog([
      new NativeLocalCapabilityHost(),
    ])

    expect(previewCatalog.hasTool('vault.cli.run')).toBe(true)
    expect(previewCatalog.hasTool('assistant.note.peek')).toBe(true)
    expect(previewRegistry.listCapabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputExample: {
            value: 'example',
          },
          name: 'vault.cli.run',
          preferredHostKind: 'cli-backed',
          supportedHostKinds: ['cli-backed', 'native-local'],
        }),
      ]),
    )
    expect(previewCatalog.listTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'vault.cli.run',
          selectedHostKind: 'native-local',
        }),
      ]),
    )

    const previewTools = previewCatalog.createAiSdkTools('preview', {
      onToolEvent(event) {
        if (event.kind === 'started') {
          startedEvents.push(event)
        } else {
          successEvents.push(event)
        }
      },
    })

    await expect(
      Reflect.apply(
        previewTools['vault.cli.run']!.execute!,
        previewTools['vault.cli.run'],
        [
          {
            value: 'hello',
          },
          {},
        ],
      ),
    ).resolves.toEqual({
      input: {
        value: 'hello',
      },
      preview: true,
      tool: 'vault.cli.run',
    })

    const applyCatalog = createAssistantToolCatalogFromCapabilities(
      [
        defineAssistantCapability({
          description: 'Succeed when input is valid.',
          executionBindings: {
            'native-local': async ({ value }: { value: string }) => ({
              ok: value,
            }),
          },
          inputSchema: z.object({
            value: z.string(),
          }),
          name: 'assistant.note.peek',
          outputSchema: z.object({
            ok: z.string(),
          }),
        }),
        defineAssistantCapability({
          description: 'Fail with an explicit error code.',
          executionBindings: {
            'native-local': async () => {
              throw new Error('tool exploded')
            },
          },
          inputSchema: z.object({
            value: z.string(),
          }),
          name: 'assistant.note.fail',
        }),
      ],
      [new CliBackedCapabilityHost(), new NativeLocalCapabilityHost()],
    )

    const applyTools = applyCatalog.createAiSdkTools('apply', {
      onToolEvent(event) {
        if (event.kind === 'failed') {
          failureEvents.push(event)
        } else {
          successEvents.push(event)
        }
      },
    })

    await expect(
      Reflect.apply(
        applyTools['assistant.note.fail']!.execute!,
        applyTools['assistant.note.fail'],
        [
          {
            value: 'boom',
          },
          {},
        ],
      ),
    ).rejects.toThrow('tool exploded')

    await expect(
      applyCatalog.executeCalls({
        calls: [
          {
            input: {
              value: 'ok',
            },
            tool: 'assistant.note.peek',
          },
          {
            input: {
              value: 7,
            },
            tool: 'assistant.note.peek',
          },
          {
            input: {
              value: 'missing',
            },
            tool: 'assistant.unknown',
          },
          {
            input: {
              value: 'skip',
            },
            tool: 'assistant.note.peek',
          },
        ],
        maxCalls: 3,
        mode: 'apply',
      }),
    ).resolves.toEqual([
      {
        errorCode: null,
        errorMessage: null,
        input: {
          value: 'ok',
        },
        result: {
          ok: 'ok',
        },
        status: 'succeeded',
        tool: 'assistant.note.peek',
      },
      {
        errorCode: 'ASSISTANT_TOOL_INPUT_INVALID',
        errorMessage: expect.stringContaining('Invalid input'),
        input: {
          value: 7,
        },
        result: null,
        status: 'failed',
        tool: 'assistant.note.peek',
      },
      {
        errorCode: 'ASSISTANT_TOOL_UNKNOWN',
        errorMessage: 'Unknown assistant tool "assistant.unknown".',
        input: {
          value: 'missing',
        },
        result: null,
        status: 'failed',
        tool: 'assistant.unknown',
      },
      {
        errorCode: null,
        errorMessage: 'Skipped because the plan exceeded the configured call limit.',
        input: {
          value: 'skip',
        },
        result: null,
        status: 'skipped',
        tool: 'assistant.note.peek',
      },
    ])

    expect(startedEvents).toEqual([
      {
        input: {
          value: 'hello',
        },
        kind: 'started',
        mode: 'preview',
        tool: 'vault.cli.run',
      },
    ])
    expect(successEvents).toEqual(
      expect.arrayContaining([
        {
          input: {
            value: 'hello',
          },
          kind: 'previewed',
          mode: 'preview',
          result: {
            input: {
              value: 'hello',
            },
            preview: true,
            tool: 'vault.cli.run',
          },
          tool: 'vault.cli.run',
        },
      ]),
    )
    expect(failureEvents).toEqual([
      {
        errorCode: 'ASSISTANT_TOOL_EXECUTION_FAILED',
        errorMessage: 'tool exploded',
        input: {
          value: 'boom',
        },
        kind: 'failed',
        mode: 'apply',
        tool: 'assistant.note.fail',
      },
    ])
  })
})

describe('inbox routing vision and multimodal helpers', () => {
  it('classifies image routing eligibility and parser bypass decisions across supported and unsupported attachments', () => {
    expect(
      getRoutingImageEligibility({
        fileName: 'notes.pdf',
        kind: 'document',
        mime: 'application/pdf',
        storedPath: 'raw/inbox/email/capture-1/attachments/notes.pdf',
      }),
    ).toEqual({
      eligible: false,
      extension: '.pdf',
      mediaType: 'application/pdf',
      reason: 'not-image',
    })

    expect(
      getRoutingImageEligibility({
        fileName: 'photo.PNG',
        kind: 'image',
        mime: ' image/x-png ',
        storedPath: 'raw/inbox/email/capture-1/attachments/photo.PNG',
      }),
    ).toEqual({
      eligible: true,
      extension: '.png',
      mediaType: 'image/png',
      reason: 'supported-format',
    })

    expect(
      getRoutingImageEligibility({
        fileName: 'vector.svg',
        kind: 'image',
        mime: 'image/svg+xml',
        storedPath: 'raw/inbox/email/capture-1/attachments/vector.svg',
      }),
    ).toEqual({
      eligible: false,
      extension: '.svg',
      mediaType: 'image/svg+xml',
      reason: 'unsupported-format',
    })

    expect(
      getRoutingImageEligibility({
        fileName: 'fallback.webp',
        kind: 'image',
        mime: null,
        storedPath: 'raw/inbox/email/capture-1/attachments/fallback.webp',
      }),
    ).toEqual({
      eligible: true,
      extension: '.webp',
      mediaType: 'image/webp',
      reason: 'supported-format',
    })

    expect(
      shouldBypassParserWaitForRouting({
        fileName: 'fallback.webp',
        kind: 'image',
        mime: null,
        storedPath: 'raw/inbox/email/capture-1/attachments/fallback.webp',
      }),
    ).toBe(true)
    expect(
      shouldBypassParserWaitForRouting({
        fileName: 'missing.png',
        kind: 'image',
        mime: 'image/png',
        storedPath: '   ',
      }),
    ).toBe(false)
    expect(
      getRoutingImageEligibility({
        fileName: 'missing.png',
        kind: 'image',
        mime: 'image/png',
        storedPath: null,
      }),
    ).toEqual({
      eligible: false,
      extension: '.png',
        mediaType: 'image/png',
        reason: 'stored-path-missing',
      })
    expect(
      getRoutingImageEligibility({
        fileName: 'photo.jpg',
        kind: 'image',
        mime: 'image/pjpeg',
        storedPath: 'raw/inbox/email/capture-1/attachments/photo.jpg',
      }),
    ).toEqual({
      eligible: true,
      extension: '.jpg',
      mediaType: 'image/jpeg',
      reason: 'supported-format',
    })
    expect(
      getRoutingImageEligibility({
        fileName: '   ',
        kind: 'image',
        mime: null,
        storedPath: 'raw/inbox/email/capture-1/attachments/image',
      }),
    ).toEqual({
      eligible: false,
      extension: null,
      mediaType: null,
      reason: 'unsupported-format',
    })
  })

  it('builds attachment bundles with inline and derived text fragments and prepares multimodal evidence', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-model-harness-',
    )
    tempRoots.push(parentRoot)

    const imageAttachment = createInboxAttachment({
      attachmentId: 'image-1',
      captureId: 'capture-1',
      derivedPath: 'derived/inbox/capture-1/attachments/image-1/manifest.json',
      extractedText: ' important extracted text '.repeat(400),
      fileName: 'meal.png',
      kind: 'image',
      mime: 'image/png',
      storedPath: 'raw/inbox/email/capture-1/attachments/meal.png',
      transcriptText: ' spoken notes ',
    })
    const pdfAttachment = createInboxAttachment({
      attachmentId: 'pdf-1',
      captureId: 'capture-1',
      fileName: 'statement.pdf',
      kind: 'document',
      mime: 'application/pdf',
      ordinal: 2,
      parseState: 'failed',
      storedPath: 'raw/inbox/email/capture-1/attachments/statement.pdf',
    })

    await writeVaultFile(vaultRoot, imageAttachment.storedPath ?? '', Buffer.from('png-bytes'))
    await writeVaultFile(vaultRoot, pdfAttachment.storedPath ?? '', Buffer.from('%PDF-1.7'))
    await writeVaultJson(vaultRoot, 'derived/inbox/capture-1/attachments/image-1/manifest.json', {
      paths: {
        markdownPath: 'derived/inbox/capture-1/attachments/image-1/markdown.md',
        plainTextPath: 'derived/inbox/capture-1/attachments/image-1/plain.txt',
        tablesPath: 'derived/inbox/capture-1/attachments/image-1/tables.txt',
      },
      schema: 'murph.parser-manifest.v1',
    })
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/image-1/plain.txt',
      ' plain text fragment ',
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/image-1/markdown.md',
      '# Markdown fragment',
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/image-1/tables.txt',
      '| a | b |',
    )

    const imageBundle = await buildInboxModelAttachmentBundle({
      attachment: imageAttachment,
      captureId: 'capture-1',
      vaultRoot,
    })
    const pdfBundle = await buildInboxModelAttachmentBundle({
      attachment: pdfAttachment,
      captureId: 'capture-1',
      vaultRoot,
    })

    expect(imageBundle.routingImage).toMatchObject({
      eligible: true,
      mediaType: 'image/png',
      reason: 'supported-format',
    })
    expect(imageBundle.fragments.map((fragment) => fragment.kind)).toEqual([
      'attachment_metadata',
      'attachment_extracted_text',
      'attachment_transcript',
      'derived_plain_text',
      'derived_markdown',
      'derived_tables',
    ])
    expect(imageBundle.fragments[1]).toMatchObject({
      kind: 'attachment_extracted_text',
      truncated: true,
    })
    expect(pdfBundle.fragments.map((fragment) => fragment.kind)).toEqual([
      'attachment_metadata',
    ])
    expect(inferInboxMultimodalInputMode([imageBundle, pdfBundle])).toBe('multimodal')
    expect(hasInboxMultimodalAttachmentEvidenceCandidate(imageAttachment)).toBe(true)
    expect(
      hasInboxMultimodalAttachmentEvidenceCandidate({
        kind: 'document',
        ordinal: 3,
        storedPath: null,
      }),
    ).toBe(false)

    const prepared = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: imageBundle,
          captureId: 'capture-1',
        },
        {
          attachment: pdfBundle,
          captureId: 'capture-1',
        },
      ],
      prompt: 'Inspect the capture.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('multimodal')
    expect(prepared.fallbackError).toBeNull()
    expect(prepared.userMessageContent).toEqual([
      {
        text: 'Inspect the capture.',
        type: 'text',
      },
      {
        text: 'Attachment image 1 (meal.png).',
        type: 'text',
      },
      {
        image: Buffer.from('png-bytes'),
        mediaType: 'image/png',
        mimeType: 'image/png',
        type: 'image',
      },
      {
        text: 'Attachment PDF 2 (statement.pdf).',
        type: 'text',
      },
      {
        data: Buffer.from('%PDF-1.7'),
        filename: 'statement.pdf',
        mediaType: 'application/pdf',
        type: 'file',
      },
    ])
  })

  it('falls back to text-only multimodal input when rich evidence cannot be loaded', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-model-harness-fallback-',
    )
    tempRoots.push(parentRoot)

    const fallback = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: {
            attachmentId: 'image-1',
            combinedText: 'metadata only',
            fileName: 'meal.png',
            fragments: [
              {
                kind: 'attachment_metadata',
                label: 'attachment-1-metadata',
                path: '../outside.png',
                text: 'outside path',
                truncated: false,
              },
            ],
            kind: 'image',
            mime: 'image/png',
            ordinal: 1,
            parseState: null,
            routingImage: {
              eligible: true,
              extension: '.png',
              mediaType: 'image/png',
              reason: 'supported-format',
            },
            storedPath: '../outside.png',
          },
          captureId: 'capture-1',
        },
      ],
      fallbackContextLabel: 'routing',
      prompt: 'Inspect the capture.',
      vaultRoot,
    })

    expect(fallback).toMatchObject({
      fallbackError: expect.stringContaining(
        'Falling back to text-only routing because rich evidence could not be loaded',
      ),
      inputMode: 'text-only',
      userMessageContent: null,
    })
  })

  it('returns text-only multimodal input for non-evidence attachments and keeps partial evidence when some candidates fail', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-model-harness-partial-',
    )
    tempRoots.push(parentRoot)

    const textOnlyAttachment = await buildInboxModelAttachmentBundle({
      attachment: createInboxAttachment({
        attachmentId: 'doc-1',
        captureId: 'capture-1',
        extractedText: 'already parsed text',
        fileName: 'note.txt',
        kind: 'document',
        mime: 'text/plain',
        storedPath: 'raw/inbox/email/capture-1/attachments/note.txt',
      }),
      captureId: 'capture-1',
      vaultRoot,
    })

    expect(inferInboxMultimodalInputMode([textOnlyAttachment])).toBe('text-only')
    await expect(
      prepareInboxMultimodalUserMessageContent({
        attachmentSources: [
          {
            attachment: textOnlyAttachment,
            captureId: 'capture-1',
          },
        ],
        prompt: 'Inspect the capture.',
        vaultRoot,
      }),
    ).resolves.toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })

    await writeVaultFile(
      vaultRoot,
      'raw/inbox/email/capture-1/attachments/meal.png',
      Buffer.from('png-bytes'),
    )
    const validImageAttachment = await buildInboxModelAttachmentBundle({
      attachment: createInboxAttachment({
        attachmentId: 'image-1',
        captureId: 'capture-1',
        fileName: 'meal.png',
        kind: 'image',
        mime: 'image/png',
        storedPath: 'raw/inbox/email/capture-1/attachments/meal.png',
      }),
      captureId: 'capture-1',
      vaultRoot,
    })

    const partial = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: validImageAttachment,
          captureId: 'capture-1',
        },
        {
          attachment: {
            ...validImageAttachment,
            attachmentId: 'image-2',
            ordinal: 2,
            storedPath: 'raw/inbox/email/capture-2/attachments/other.png',
          },
          captureId: 'capture-1',
        },
      ],
      prompt: 'Inspect the capture.',
      vaultRoot,
    })

    expect(partial.fallbackError).toBeNull()
    expect(partial.inputMode).toBe('multimodal')
    expect(partial.userMessageContent).toEqual([
      {
        text: 'Inspect the capture.',
        type: 'text',
      },
      {
        text: 'Attachment image 1 (meal.png).',
        type: 'text',
      },
      {
        image: Buffer.from('png-bytes'),
        mediaType: 'image/png',
        mimeType: 'image/png',
        type: 'image',
      },
    ])
  })

  it('handles invalid parser manifests, pending PDF fallbacks, and omitted multimodal metadata conservatively', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-model-harness-conservative-',
    )
    tempRoots.push(parentRoot)

    const pendingPdf = await buildInboxModelAttachmentBundle({
      attachment: createInboxAttachment({
        attachmentId: 'pdf-pending',
        captureId: 'capture-1',
        fileName: 'pending.pdf',
        kind: 'document',
        mime: 'application/pdf',
        parseState: 'pending',
        storedPath: 'raw/inbox/email/capture-1/attachments/pending.pdf',
      }),
      captureId: 'capture-1',
      vaultRoot,
    })

    expect(inferInboxMultimodalInputMode([pendingPdf])).toBe('text-only')
    await expect(
      prepareInboxMultimodalUserMessageContent({
        attachmentSources: [
          {
            attachment: pendingPdf,
            captureId: 'capture-1',
          },
        ],
        prompt: 'Inspect the capture.',
        vaultRoot,
      }),
    ).resolves.toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })

    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/audio-1/manifest.json',
      '{invalid json\n',
    )
    const invalidManifestBundle = await buildInboxModelAttachmentBundle({
      attachment: createInboxAttachment({
        attachmentId: 'audio-1',
        captureId: 'capture-1',
        derivedPath: 'derived/inbox/capture-1/attachments/audio-1/manifest.json',
        fileName: 'voice.m4a',
        kind: 'audio',
        mime: 'audio/m4a',
        storedPath: 'raw/inbox/email/capture-1/attachments/voice.m4a',
        transcriptText: 'spoken note',
      }),
      captureId: 'capture-1',
      vaultRoot,
    })
    expect(invalidManifestBundle.fragments.map((fragment) => fragment.kind)).toEqual([
      'attachment_metadata',
      'attachment_transcript',
    ])

    await writeVaultJson(
      vaultRoot,
      'derived/inbox/capture-1/attachment-3/manifest.json',
      {
        paths: {
          markdownPath: 'derived/inbox/capture-1/attachment-3/missing.md',
          plainTextPath: 'derived/inbox/capture-1/attachment-3/missing.txt',
          tablesPath: 'derived/inbox/capture-1/attachment-3/missing-tables.txt',
        },
        schema: 'murph.parser-manifest.v1',
      },
    )
    const missingDerivedFilesBundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: null,
        derivedPath: 'derived/inbox/capture-1/attachment-3/manifest.json',
        fileName: null,
        kind: 'other',
        mime: null,
        ordinal: 3,
        parseState: null,
        storedPath: 'raw/inbox/email/capture-1/attachments/unknown.bin',
      },
      captureId: 'capture-1',
      vaultRoot,
    })
    expect(
      missingDerivedFilesBundle.fragments.map((fragment) => fragment.kind),
    ).toEqual(['attachment_metadata'])

    await writeVaultFile(
      vaultRoot,
      'raw/inbox/email/capture-1/attachments/plain-image',
      Buffer.from('image-bytes'),
    )
    await writeVaultFile(
      vaultRoot,
      'raw/inbox/email/capture-1/attachments/plain-pdf',
      Buffer.from('%PDF-1.7'),
    )

    const omittedMetadata = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: {
            attachmentId: 'image-no-mime',
            combinedText: 'image metadata',
            fileName: null,
            fragments: [
              {
                kind: 'attachment_metadata',
                label: 'attachment-1-metadata',
                path: 'raw/inbox/email/capture-1/attachments/plain-image',
                text: 'image',
                truncated: false,
              },
            ],
            kind: 'image',
            mime: null,
            ordinal: 1,
            parseState: null,
            routingImage: {
              eligible: true,
              extension: null,
              mediaType: null,
              reason: 'supported-format',
            },
            storedPath: 'raw/inbox/email/capture-1/attachments/plain-image',
          },
          captureId: 'capture-1',
        },
        {
          attachment: {
            attachmentId: 'pdf-no-name',
            combinedText: 'pdf metadata',
            fileName: null,
            fragments: [
              {
                kind: 'attachment_metadata',
                label: 'attachment-2-metadata',
                path: 'raw/inbox/email/capture-1/attachments/plain-pdf',
                text: 'pdf',
                truncated: false,
              },
            ],
            kind: 'document',
            mime: 'application/pdf',
            ordinal: 2,
            parseState: 'failed',
            routingImage: {
              eligible: false,
              extension: null,
              mediaType: null,
              reason: 'not-image',
            },
            storedPath: 'raw/inbox/email/capture-1/attachments/plain-pdf',
          },
          captureId: 'capture-1',
        },
      ],
      prompt: 'Inspect the capture.',
      vaultRoot,
    })

    expect(omittedMetadata.userMessageContent).toEqual([
      {
        text: 'Inspect the capture.',
        type: 'text',
      },
      {
        text: 'Attachment image 1.',
        type: 'text',
      },
      {
        image: Buffer.from('image-bytes'),
        type: 'image',
      },
      {
        text: 'Attachment PDF 2.',
        type: 'text',
      },
      {
        data: Buffer.from('%PDF-1.7'),
        mediaType: 'application/pdf',
        type: 'file',
      },
    ])
  })
})

describe('inbox model harness', () => {
  it('builds and materializes routing bundles with clamped routing text and tool catalogs', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-inbox-harness-',
    )
    tempRoots.push(parentRoot)

    const toolCatalog = createToolCatalogStub()
    harnessMocks.createInboxRoutingAssistantToolCatalog.mockReturnValue(toolCatalog)

    const imageAttachment = createInboxAttachment({
      attachmentId: 'image-1',
      captureId: 'capture-1',
      fileName: 'meal.png',
      kind: 'image',
      mime: 'image/png',
      storedPath: 'raw/inbox/email/capture-1/attachments/meal.png',
    })
    await writeVaultFile(vaultRoot, imageAttachment.storedPath ?? '', Buffer.from('png-bytes'))

    const inboxServices = createInboxServicesStub(
      createShowResult(vaultRoot, {
        attachments: [imageAttachment],
        text: 'capture note '.repeat(2500),
      }),
    )

    const bundle = await buildInboxModelBundle({
      captureId: 'capture-1',
      inboxServices,
      requestId: 'req-1',
      vault: vaultRoot,
    })
    const materialized = await materializeInboxModelBundle({
      captureId: 'capture-1',
      inboxServices,
      requestId: 'req-1',
      vault: vaultRoot,
    })

    expect(toolCatalog.listTools).toHaveBeenCalledTimes(2)
    expect(bundle.preparedInputMode).toBe('multimodal')
    expect(bundle.tools).toEqual([createToolSpec()])
    expect(bundle.routingText).toContain('Prepared input mode: multimodal')
    expect(bundle.routingText).toContain('[truncated ')
    expect(materialized.bundlePath).toBe('derived/inbox/capture-1/assistant/bundle.json')
    expect(
      JSON.parse(
        await readFile(
          path.join(vaultRoot, 'derived/inbox/capture-1/assistant/bundle.json'),
          'utf8',
        ),
      ),
    ).toEqual(materialized.bundle)
  })

  it('retries multimodal routing as text-only when the model rejects rich inputs', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-inbox-route-',
    )
    tempRoots.push(parentRoot)

    const toolCatalog = createToolCatalogStub()
    harnessMocks.createInboxRoutingAssistantToolCatalog.mockReturnValue(toolCatalog)

    const imageAttachment = createInboxAttachment({
      attachmentId: 'image-1',
      captureId: 'capture-1',
      fileName: 'meal.png',
      kind: 'image',
      mime: 'image/png',
      storedPath: 'raw/inbox/email/capture-1/attachments/meal.png',
    })
    await writeVaultFile(vaultRoot, imageAttachment.storedPath ?? '', Buffer.from('png-bytes'))

    const inboxServices = createInboxServicesStub(
      createShowResult(vaultRoot, {
        attachments: [imageAttachment],
        text: 'Dinner receipt screenshot',
      }),
    )

    harnessMocks.generateText.mockRejectedValueOnce(
      new Error('This model does not support image_url multimodal input.'),
    )
    harnessMocks.generateObject.mockResolvedValueOnce({
      object: {
        actions: [
          {
            input: {
              captureId: 'capture-1',
            },
            tool: 'inbox.promote.journal',
          },
        ],
        rationale: 'Promote the capture to a journal entry.',
        schema: 'murph.assistant-plan.v1',
        summary: 'Route the capture as a journal entry.',
      },
    })

    const result = await routeInboxCaptureWithModel({
      apply: true,
      captureId: 'capture-1',
      inboxServices,
      modelSpec: {
        executionDriver: 'gateway',
        model: 'murph-mini',
      },
      requestId: 'req-1',
      vault: vaultRoot,
    })

    expect(result).toMatchObject({
      apply: true,
      fallbackError: 'This model does not support image_url multimodal input.',
      inputMode: 'text-only',
      model: {
        baseUrl: null,
        model: 'murph-mini',
        providerMode: 'gateway',
        providerName: null,
      },
      preparedInputMode: 'multimodal',
    })
    expect(harnessMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'user',
          }),
        ],
      }),
    )
    expect(harnessMocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Normalized capture bundle:'),
      }),
    )
    expect(toolCatalog.executeCalls).toHaveBeenCalledWith({
      calls: result.plan.actions,
      maxCalls: 4,
      mode: 'apply',
    })
    expect(
      JSON.parse(
        await readFile(
          path.join(vaultRoot, 'derived/inbox/capture-1/assistant/result.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      apply: true,
      fallbackError: 'This model does not support image_url multimodal input.',
      inputMode: 'text-only',
      preparedInputMode: 'multimodal',
    })
  })

  it('rejects plans that reference tools outside the routing catalog', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-inbox-invalid-plan-',
    )
    tempRoots.push(parentRoot)

    const toolCatalog = createToolCatalogStub({
      hasTool: vi.fn(() => false),
    })
    harnessMocks.createInboxRoutingAssistantToolCatalog.mockReturnValue(toolCatalog)

    const inboxServices = createInboxServicesStub(
      createShowResult(vaultRoot, {
        attachments: [],
        text: 'Plain text capture',
      }),
    )

    harnessMocks.generateObject.mockResolvedValueOnce({
      object: {
        actions: [
          {
            input: {
              captureId: 'capture-1',
            },
            tool: 'vault.write.unknown',
          },
        ],
        rationale: 'Write directly to a missing tool.',
        schema: 'murph.assistant-plan.v1',
        summary: 'Invalid plan',
      },
    })

    await expect(
      routeInboxCaptureWithModel({
        captureId: 'capture-1',
        inboxServices,
        modelSpec: {
          executionDriver: 'gateway',
          model: 'murph-mini',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PLAN_TOOL_UNKNOWN',
      message:
        'Assistant plan selected unknown tool "vault.write.unknown".',
    })
  })

  it('renders sparse text-only bundles and surfaces non-retry multimodal model failures', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-engine-inbox-sparse-',
    )
    tempRoots.push(parentRoot)

    const sparseCatalog = createToolCatalogStub({
      listTools: vi.fn(() => [
        {
          ...createToolSpec(),
          inputExample: null,
          provenance: {
            generatedFrom: 'catalog-profile',
            localOnly: false,
            origin: 'hosted-api-backed',
            policyWrappers: ['output-redaction'],
          },
        },
      ]),
    })
    harnessMocks.createInboxRoutingAssistantToolCatalog.mockReturnValue(sparseCatalog)

    const sparseServices = createInboxServicesStub({
      capture: {
        ...createShowResult(vaultRoot, {
          attachments: [],
          text: '',
        }).capture,
        actorId: null,
        actorName: null,
        text: null,
        threadTitle: null,
      },
      vault: vaultRoot,
    })

    const sparseBundle = await buildInboxModelBundle({
      captureId: 'capture-1',
      inboxServices: sparseServices,
      vault: vaultRoot,
    })

    expect(sparseBundle.routingText).toContain('Thread: thread-1')
    expect(sparseBundle.routingText).toContain('Actor: unknown | self=false')
    expect(sparseBundle.routingText).not.toContain('Capture text:')
    expect(sparseBundle.routingText).not.toContain('Attachment text bundle:')

    const multimodalCatalog = createToolCatalogStub()
    harnessMocks.createInboxRoutingAssistantToolCatalog.mockReturnValue(multimodalCatalog)

    const imageAttachment = createInboxAttachment({
      attachmentId: 'image-1',
      captureId: 'capture-1',
      fileName: 'meal.png',
      kind: 'image',
      mime: 'image/png',
      storedPath: 'raw/inbox/email/capture-1/attachments/meal.png',
    })
    await writeVaultFile(vaultRoot, imageAttachment.storedPath ?? '', Buffer.from('png-bytes'))

    const multimodalServices = createInboxServicesStub(
      createShowResult(vaultRoot, {
        attachments: [imageAttachment],
        text: 'Screenshot from dinner',
      }),
    )

    harnessMocks.generateText.mockRejectedValueOnce(
      new Error('The provider timed out before completing routing.'),
    )

    await expect(
      routeInboxCaptureWithModel({
        captureId: 'capture-1',
        inboxServices: multimodalServices,
        modelSpec: {
          baseUrl: 'https://router.example.com/v1',
          model: 'router-model',
          providerName: 'router',
        },
        vault: vaultRoot,
      }),
    ).rejects.toThrow('The provider timed out before completing routing.')
  })
})

function createInboxAttachment(input: {
  attachmentId: string
  captureId: string
  derivedPath?: string
  extractedText?: string
  fileName: string
  kind: InboxShowResult['capture']['attachments'][number]['kind']
  mime: string
  ordinal?: number
  parseState?: InboxShowResult['capture']['attachments'][number]['parseState']
  storedPath: string
  transcriptText?: string
}): InboxShowResult['capture']['attachments'][number] {
  return {
    attachmentId: input.attachmentId,
    derivedPath: input.derivedPath ?? null,
    extractedText: input.extractedText ?? null,
    fileName: input.fileName,
    kind: input.kind,
    mime: input.mime,
    ordinal: input.ordinal ?? 1,
    parseState: input.parseState ?? 'succeeded',
    storedPath: input.storedPath,
    transcriptText: input.transcriptText ?? null,
  }
}

function createShowResult(
  vaultRoot: string,
  input: {
    attachments: InboxShowResult['capture']['attachments']
    text: string
  },
): InboxShowResult {
  return {
    capture: {
      accountId: 'account-1',
      actorId: 'actor-1',
      actorIsSelf: false,
      actorName: 'Sender',
      attachmentCount: input.attachments.length,
      attachments: input.attachments,
      captureId: 'capture-1',
      createdAt: '2026-04-08T00:00:00.000Z',
      envelopePath: 'raw/inbox/email/capture-1/envelope.json',
      eventId: 'event-1',
      externalId: 'external-1',
      occurredAt: '2026-04-08T00:00:00.000Z',
      promotions: [],
      receivedAt: '2026-04-08T00:01:00.000Z',
      source: 'email',
      text: input.text,
      threadId: 'thread-1',
      threadIsDirect: true,
      threadTitle: 'Important thread',
    },
    vault: vaultRoot,
  }
}

function createInboxServicesStub(result: InboxShowResult): InboxServices {
  return assumeInboxServices({
    show: vi.fn(async () => result),
  })
}

function createToolCatalogStub(input?: {
  executeCalls?: ReturnType<typeof vi.fn>
  hasTool?: ReturnType<typeof vi.fn>
  listTools?: ReturnType<typeof vi.fn>
}) {
  return {
    executeCalls:
      input?.executeCalls ??
      vi.fn(async () => [
        {
          errorCode: null,
          errorMessage: null,
          input: {
            captureId: 'capture-1',
          },
          result: {
            status: 'queued',
          },
          status: 'succeeded',
          tool: 'inbox.promote.journal',
        },
      ]),
    hasTool:
      input?.hasTool ??
      vi.fn((toolName: string) => toolName === 'inbox.promote.journal'),
    listTools: input?.listTools ?? vi.fn(() => [createToolSpec()]),
  }
}

function createToolSpec(): AssistantToolSpec {
  return {
    backendKind: 'local-service',
    description: 'Promote the capture to a journal entry.',
    inputExample: {
      captureId: 'capture-1',
    },
    mutationSemantics: 'canonical-write',
    name: 'inbox.promote.journal',
    preferredHostKind: 'native-local',
    provenance: {
      generatedFrom: null,
      localOnly: true,
      origin: 'vault-service-backed',
      policyWrappers: [],
    },
    riskClass: 'high',
    selectedHostKind: 'native-local',
  }
}

function assumeInboxServices(value: Record<string, unknown>): InboxServices {
  return Object.assign({} as InboxServices, value)
}

async function writeVaultJson(
  vaultRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await writeVaultFile(vaultRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  value: Buffer | string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })
  await writeFile(absolutePath, value)
}
