import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { FOOD_STATUSES, RECIPE_STATUSES } from '@murphai/contracts'
import { buildSharePackFromVault } from '@murphai/core'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { prepareAssistantDirectCliEnv } from './assistant-cli-access.js'
import {
  assistantCronScheduleInputSchema,
  assistantMemoryQueryScopeValues,
  assistantMemoryVisibleSectionValues,
} from './assistant-cli-contracts.js'
import {
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
} from './knowledge.js'
import {
  getAssistantMemory,
  redactAssistantMemoryRecord,
  redactAssistantMemorySearchHit,
  searchAssistantMemory,
} from './assistant/memory.js'
import {
  assistantWebFetchExtractModeValues,
  fetchAssistantWeb,
  resolveAssistantWebFetchEnabled,
} from './assistant/web-fetch.js'
import {
  assistantWebPdfReadMaxChars,
  assistantWebPdfReadMaxPages,
  readAssistantWebPdf,
} from './assistant/web-pdf-read.js'
import {
  assistantWebSearchFreshnessValues,
  assistantWebSearchProviderValues,
  resolveConfiguredAssistantWebSearchProvider,
  searchAssistantWeb,
} from './assistant/web-search.js'
import {
  isMissingFileError,
  normalizeNullableString,
} from './assistant/shared.js'
import {
  deleteAssistantStateDocument,
  getAssistantStateDocument,
  listAssistantStateDocuments,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  redactAssistantStateDocumentListEntry,
  redactAssistantStateDocumentSnapshot,
} from './assistant/state.js'
import { redactAssistantDisplayPath } from './assistant/store.js'
import {
  healthEntityDescriptors,
  hasHealthCommandDescriptor,
} from './health-cli-descriptors.js'
import { resolveAssistantVaultPath } from './assistant-vault-paths.js'
import type { InboxServices } from './inbox-services.js'
import {
  createAssistantToolCatalog,
  type AssistantToolCatalog,
  type AssistantToolDefinition,
  defineAssistantTool,
} from './model-harness.js'
import {
  applyDefaultVaultToArgs,
  hasExplicitVaultOption,
  listAssistantSelfDeliveryTargets,
  ROOT_OPTIONS_WITH_VALUES,
  resolveAssistantSelfDeliveryTarget,
} from './operator-config.js'
import { sanitizeChildProcessEnv } from './child-process-env.js'
import { redactSensitivePathSegments } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'
import type { VaultServices } from './vault-services.js'
import type { AssistantExecutionContext } from './assistant/execution-context.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

const isoTimestampSchema = z.string().min(1)
const vaultFilePathSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const optionalStringArraySchema = z.array(z.string().min(1)).optional()
const assistantWebFetchExtractModeSchema = z.enum(assistantWebFetchExtractModeValues)
const assistantWebSearchProviderSchema = z.enum(assistantWebSearchProviderValues)
const assistantWebSearchFreshnessSchema = z.enum(assistantWebSearchFreshnessValues)
const assistantWebSearchDomainFilterSchema = z.array(z.string().min(1)).max(20).optional()
const shareEntitySelectorSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.id || value.slug), {
    message: 'Provide either an id or slug.',
  })
const assistantMemoryQueryScopeSchema = z.enum(assistantMemoryQueryScopeValues)
const assistantMemoryVisibleSectionSchema = z.enum(assistantMemoryVisibleSectionValues)
const assistantCronDeliveryTargetSchema = z.object({
  channel: z.string().min(1).optional(),
  deliveryTarget: z.string().min(1).optional(),
  identityId: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  sourceThreadId: z.string().min(1).optional(),
})
const assistantCronTargetMutationSchema = assistantCronDeliveryTargetSchema.extend({
  dryRun: z.boolean().optional(),
  job: z.string().min(1),
  resetContinuity: z.boolean().optional(),
})
const knowledgeMetadataTagSchema = z.string().min(1)
const knowledgeSourcePathSchema = z.string().min(1)
const knowledgeSlugSchema = z.string().min(1)
const assistantToolTextReadDefaultMaxChars = 8_000
const assistantToolTextReadMaxChars = 20_000
const assistantToolTextReadChunkBytes = 4_096
const assistantCliExecutorToolName = 'murph.cli.run'
const assistantCliDefaultTimeoutMs = 10 * 60 * 1000
const assistantCliMaxTimeoutMs = 60 * 60 * 1000
const assistantCliRequire = createRequire(import.meta.url)
const workspaceCliBinPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../cli/src/bin.ts',
)
const workspaceTsxBinPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)
const assistantCliBlockedCommandPaths = new Set([
  'assistant ask',
  'assistant chat',
  'assistant run',
  'chat',
  'run',
])


interface AssistantToolContext {
  allowSensitiveHealthContext?: boolean
  captureId?: string
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: AssistantExecutionContext | null
  inboxServices?: InboxServices
  requestId?: string | null
  sessionId?: string | null
  vault: string
  vaultServices?: VaultServices
  workingDirectory?: string | null
}

export interface AssistantToolCatalogOptions {
  includeAssistantRuntimeTools?: boolean
  includeQueryTools?: boolean
  includeStatefulWriteTools?: boolean
  includeVaultTextReadTool?: boolean
  includeVaultWriteTools?: boolean
  includeWebSearchTools?: boolean
}

interface AssistantToolConcernDefinitions {
  assistantRuntimeTools: AssistantToolDefinition[]
  canonicalVaultWriteTools: AssistantToolDefinition[]
  outwardSideEffectTools: AssistantToolDefinition[]
  queryAndReadTools: AssistantToolDefinition[]
}

interface AssistantCliLauncher {
  argvPrefix: string[]
  command: string
}

export function createDefaultAssistantToolCatalog(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
): AssistantToolCatalog {
  const concerns = resolveAssistantToolConcernDefinitions(input, options)
  return createAssistantToolCatalog([
    ...concerns.assistantRuntimeTools,
    ...concerns.queryAndReadTools,
    ...concerns.canonicalVaultWriteTools,
    ...concerns.outwardSideEffectTools,
  ])
}

export function createInboxRoutingAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createDefaultAssistantToolCatalog(input, {
    includeAssistantRuntimeTools: false,
    includeQueryTools: false,
    includeStatefulWriteTools: false,
    includeVaultTextReadTool: false,
    includeVaultWriteTools: true,
    includeWebSearchTools: false,
  })
}

export function createProviderTurnAssistantToolCatalog(
  input: AssistantToolContext,
): AssistantToolCatalog {
  return createAssistantToolCatalog([
    ...createAssistantCliExecutorToolDefinitions(input),
    ...createVaultTextReadToolDefinitions(input),
    ...createOutwardSideEffectToolDefinitions(input),
    ...createWebSearchToolDefinitions(),
    ...createWebFetchToolDefinitions(),
    ...createWebPdfReadToolDefinitions(),
  ])
}

function resolveAssistantToolConcernDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions,
): AssistantToolConcernDefinitions {
  const includeAssistantRuntimeTools = options.includeAssistantRuntimeTools ?? true
  const includeVaultWriteTools = options.includeVaultWriteTools ?? true

  return {
    assistantRuntimeTools: includeAssistantRuntimeTools
      ? createAssistantRuntimeToolDefinitions(input, options)
      : [],
    canonicalVaultWriteTools: [
      ...createInboxPromotionToolDefinitions(input),
      ...(includeVaultWriteTools
        ? createCanonicalVaultWriteToolDefinitions(input, options)
        : []),
    ],
    outwardSideEffectTools: includeVaultWriteTools
      ? createOutwardSideEffectToolDefinitions(input)
      : [],
    queryAndReadTools: createQueryAndReadToolDefinitions(input, options),
  }
}

async function loadAssistantCronTools() {
  return await import('./assistant/cron.js')
}

function allowSensitiveHealthContextForAssistantTools(input: AssistantToolContext): boolean {
  return input.allowSensitiveHealthContext === true
}

function createAssistantCliExecutorToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineAssistantTool({
      name: assistantCliExecutorToolName,
      description:
        'Run the local `vault-cli` directly inside the active Murph workspace. This is the primary Murph runtime surface for provider turns. Pass only the tokens that come after `vault-cli`. The active vault is injected automatically when the command path normally needs `--vault`. Use `--help`, `--schema --format json`, `--llms`, and `--llms-full` for discovery.',
      inputSchema: z.object({
        args: z.array(z.string().min(1)).min(1),
        stdin: z.string().optional(),
        timeoutMs: z.number().int().positive().max(assistantCliMaxTimeoutMs).optional(),
      }),
      inputExample: {
        args: ['device', 'provider', 'list'],
      },
      execute: async ({ args, stdin, timeoutMs }) =>
        await executeAssistantCliCommand({
          args,
          stdin,
          timeoutMs,
          input,
        }),
    }),
  ]
}

function createVaultTextReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineAssistantTool({
      name: 'vault.fs.readText',
      description:
        'Read one UTF-8 text file inside the active vault with bounded truncation. Use this for targeted inspection of parser outputs, markdown notes, or attachment-derived text artifacts when canonical query tools are not enough.',
      inputSchema: z.object({
        path: vaultFilePathSchema,
        maxChars: z.number().int().positive().max(assistantToolTextReadMaxChars).optional(),
      }),
      inputExample: {
        path: 'raw/inbox/captures/cap_123/attachments/1/parser/plain-text.txt',
      },
      execute: ({ path: candidatePath, maxChars }) =>
        readAssistantTextFile(input.vault, candidatePath, maxChars),
    }),
  ]
}

async function executeAssistantCliCommand(input: {
  args: readonly string[]
  input: AssistantToolContext
  stdin?: string
  timeoutMs?: number
}): Promise<{
  argv: string[]
  exitCode: number
  json: unknown | null
  stderr: string
  stdout: string
}> {
  if (hasExplicitVaultOption(input.args)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_BLOCKED',
      'The provider-turn CLI executor does not allow an explicit `--vault` override.',
    )
  }

  const commandPath = readAssistantCliCommandPath(input.args)
  if (commandPath && assistantCliBlockedCommandPaths.has(commandPath)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_BLOCKED',
      `Command path \`${commandPath}\` is blocked from the provider-turn CLI executor.`,
      {
        commandPath,
      },
    )
  }

  const argvWithDefaults = applyDefaultVaultToArgs(
    normalizeAssistantCliRunArgs(input.args),
    input.input.vault,
  )
  const cliPayload = await materializeAssistantCliInputPayload(argvWithDefaults, input.stdin)
  const redactedArgv = redactAssistantCliArgv(cliPayload.args)
  const env = sanitizeChildProcessEnv(
    prepareAssistantDirectCliEnv({
      ...process.env,
      ...input.input.cliEnv,
    }),
  )
  const timeoutMs = input.timeoutMs ?? assistantCliDefaultTimeoutMs

  try {
    const launcher = await resolveAssistantCliLauncher(env)
    return await new Promise((resolve, reject) => {
      const child = spawn(launcher.command, [...launcher.argvPrefix, ...cliPayload.args], {
        cwd: normalizeNullableString(input.input.workingDirectory) ?? process.cwd(),
        env,
        stdio: 'pipe',
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      let forceKillTimer: NodeJS.Timeout | null = null
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        forceKillTimer = setTimeout(() => {
          child.kill('SIGKILL')
        }, 2_000)
        settle(() => {
          reject(
            new VaultCliError(
              'ASSISTANT_CLI_COMMAND_TIMEOUT',
              `vault-cli ${redactedArgv.join(' ')} timed out after ${timeoutMs}ms.`,
              {
                timeoutMs,
                argv: redactedArgv,
              },
            ),
          )
        })
      }, timeoutMs)

      const settle = (handler: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        handler()
      }

      child.on('error', (error) => {
        if (forceKillTimer !== null) {
          clearTimeout(forceKillTimer)
        }
        settle(() => {
          reject(
            new VaultCliError(
              'ASSISTANT_CLI_COMMAND_FAILED',
              `Could not start vault-cli: ${error instanceof Error ? error.message : String(error)}`,
              {
                argv: redactedArgv,
              },
            ),
          )
        })
      })

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.stdin.on('error', () => {
        // Ignore stdin teardown races after process exit.
      })
      child.stdin.end(cliPayload.stdinText)

      child.on('close', (code, signal) => {
        if (forceKillTimer !== null) {
          clearTimeout(forceKillTimer)
        }
        settle(() => {
          const redactedStdout = redactSensitivePathSegments(stdout.trim())
          const redactedStderr = redactSensitivePathSegments(stderr.trim())
          const exitCode = typeof code === 'number' ? code : signal ? 1 : 0

          if (signal || exitCode !== 0) {
            reject(
              new VaultCliError(
                'ASSISTANT_CLI_COMMAND_FAILED',
                [
                  `vault-cli ${redactedArgv.join(' ')} failed.`,
                  redactedStderr.length > 0 ? redactedStderr : redactedStdout,
                ]
                  .filter((value) => value.length > 0)
                  .join(' '),
                {
                  argv: redactedArgv,
                  exitCode,
                  signal,
                  stderr: redactedStderr,
                  stdout: redactedStdout,
                },
              ),
            )
            return
          }

          resolve({
            argv: ['vault-cli', ...redactedArgv],
            exitCode,
            json: tryParseAssistantCliJsonOutput(redactedStdout),
            stderr: redactedStderr,
            stdout: redactedStdout,
          })
        })
      })
    })
  } finally {
    if (cliPayload.cleanupPath !== null) {
      await rm(cliPayload.cleanupPath, { force: true, recursive: true })
    }
  }
}

async function resolveAssistantCliLauncher(
  env: NodeJS.ProcessEnv,
): Promise<AssistantCliLauncher> {
  const preparedEnv = prepareAssistantDirectCliEnv(env)
  const vaultCliBinary = await resolveExecutableOnPath(
    'vault-cli',
    preparedEnv,
  )
  if (vaultCliBinary) {
    return {
      argvPrefix: [],
      command: vaultCliBinary,
    }
  }

  const workspaceTsxCliPath = resolveWorkspaceTsxCliPath()
  if (workspaceTsxCliPath !== null) {
    return {
      argvPrefix: [workspaceTsxCliPath, workspaceCliBinPath],
      command: process.execPath,
    }
  }

  if (await isExecutable(workspaceTsxBinPath)) {
    return {
      argvPrefix: [workspaceCliBinPath],
      command: workspaceTsxBinPath,
    }
  }

  const pnpmBinary = await resolveExecutableOnPath(
    'pnpm',
    preparedEnv,
  )
  if (pnpmBinary) {
    return {
      argvPrefix: ['exec', 'tsx', workspaceCliBinPath],
      command: pnpmBinary,
    }
  }

  const npxBinary = await resolveExecutableOnPath(
    'npx',
    preparedEnv,
  )
  if (npxBinary) {
    return {
      argvPrefix: ['--yes', 'tsx', workspaceCliBinPath],
      command: npxBinary,
    }
  }

  throw new VaultCliError(
    'ASSISTANT_CLI_COMMAND_FAILED',
    'Could not resolve `vault-cli` on PATH and no workspace tsx fallback was available.',
  )
}

async function resolveExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (path.isAbsolute(command)) {
    return (await isExecutable(command)) ? command : null
  }

  const pathValue = env.PATH ?? process.env.PATH ?? ''
  const entries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const candidates = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command]

  for (const entry of entries) {
    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate)
      if (await isExecutable(candidatePath)) {
        return candidatePath
      }
    }
  }

  return null
}

async function isExecutable(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveWorkspaceTsxCliPath(): string | null {
  try {
    return assistantCliRequire.resolve('tsx/cli')
  } catch {
    return null
  }
}

async function materializeAssistantCliInputPayload(
  args: readonly string[],
  stdin: string | undefined,
): Promise<{
  args: string[]
  cleanupPath: string | null
  stdinText: string
}> {
  if (typeof stdin !== 'string') {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: '',
    }
  }

  const inputArgIndex = args.findIndex((token) => token === '--input')
  const inlineInputArgIndex = args.findIndex((token) => token === '--input=-')

  if (inputArgIndex === -1 && inlineInputArgIndex === -1) {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: stdin,
    }
  }

  const nextValue = inputArgIndex >= 0 ? args[inputArgIndex + 1] : null
  const usesStdinInput = nextValue === '-' || inlineInputArgIndex >= 0

  if (!usesStdinInput) {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: stdin,
    }
  }

  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-cli-input-'),
  )
  const tempPath = path.join(tempDirectory, 'payload.json')
  await writeFile(tempPath, stdin, {
    encoding: 'utf8',
    mode: 0o600,
  })

  const rewrittenArgs = [...args]
  if (inlineInputArgIndex >= 0) {
    rewrittenArgs[inlineInputArgIndex] = `--input=@${tempPath}`
  } else if (inputArgIndex >= 0) {
    rewrittenArgs[inputArgIndex + 1] = `@${tempPath}`
  }

  return {
    args: rewrittenArgs,
    cleanupPath: tempDirectory,
    stdinText: '',
  }
}

function normalizeAssistantCliRunArgs(args: readonly string[]): string[] {
  const normalized = [...args]

  if (hasAssistantCliBuiltinTextSurface(normalized) || hasExplicitFormatOption(normalized)) {
    return normalized
  }

  return [...normalized, '--format', 'json']
}

function redactAssistantCliArgv(args: readonly string[]): string[] {
  return args.map((token) => redactAssistantCliArg(token))
}

function redactAssistantCliArg(token: string): string {
  const redacted = redactSensitivePathSegments(token)

  if (redacted.startsWith('@/')) {
    return '@<REDACTED_PATH>'
  }

  if (redacted.startsWith('/')) {
    return '<REDACTED_PATH>'
  }

  return redacted.replace(/=(@)?\/[^\s]*/gu, (_match, atSign: string | undefined) =>
    atSign ? '=@<REDACTED_PATH>' : '=<REDACTED_PATH>',
  )
}

function hasExplicitFormatOption(args: readonly string[]): boolean {
  return args.some((token) => token === '--format' || token.startsWith('--format='))
}

function hasAssistantCliBuiltinTextSurface(args: readonly string[]): boolean {
  return args.some((token) =>
    token === '--help' ||
    token === '-h' ||
    token === '--llms' ||
    token === '--llms-full' ||
    token === '--version',
  )
}

function readAssistantCliCommandPath(args: readonly string[]): string | null {
  const tokens: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token || token === '--') {
      break
    }

    if (token.startsWith('-')) {
      const rootOptionToken = token.split('=', 1)[0] ?? token
      if (tokens.length === 0 && ROOT_OPTIONS_WITH_VALUES.has(rootOptionToken)) {
        if (!token.includes('=')) {
          index += 1
        }
        continue
      }

      break
    }

    tokens.push(token)
  }

  return tokens.length > 0 ? tokens.slice(0, 2).join(' ') : null
}

function tryParseAssistantCliJsonOutput(value: string): unknown | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function createWebSearchToolDefinitions() {
  if (resolveConfiguredAssistantWebSearchProvider() === null) {
    return []
  }

  return [
    defineAssistantTool({
      name: 'web.search',
      description:
        'Search the public web through the configured Murph search backend. Use this for current events, provider docs, product pages, release notes, and other information that is not available inside the active vault.',
      inputSchema: z.object({
        query: z.string().min(1),
        provider: assistantWebSearchProviderSchema.optional(),
        count: z.number().int().positive().max(10).optional(),
        country: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
        freshness: assistantWebSearchFreshnessSchema.optional(),
        dateAfter: localDateSchema.optional(),
        dateBefore: localDateSchema.optional(),
        domainFilter: assistantWebSearchDomainFilterSchema,
      }),
      inputExample: {
        query: 'OpenAI Responses API web search tool',
        provider: 'auto',
        count: 5,
        domainFilter: ['platform.openai.com', 'openai.com'],
      },
      execute: async ({
        count,
        country,
        dateAfter,
        dateBefore,
        domainFilter,
        freshness,
        language,
        provider,
        query,
      }) =>
        await searchAssistantWeb({
          query,
          provider,
          count,
          country,
          language,
          freshness,
          dateAfter,
          dateBefore,
          domainFilter,
        }),
    }),
  ]
}

function createWebFetchToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineAssistantTool({
      name: 'web.fetch',
      description:
        'Fetch one public webpage over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text for the assistant. Use this after discovery tools like web.search when you need the actual page contents of a docs page, menu, article, or product page. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        extractMode: assistantWebFetchExtractModeSchema.optional(),
        maxChars: z.number().int().positive().max(40_000).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu',
        extractMode: 'markdown',
        maxChars: 8_000,
      },
      execute: async ({ extractMode, maxChars, url }) =>
        await fetchAssistantWeb({
          url,
          extractMode,
          maxChars,
        }),
    }),
  ]
}

function createWebPdfReadToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineAssistantTool({
      name: 'web.pdf.read',
      description:
        'Fetch one public PDF over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text with bounded page and character limits. Use this for menus, manuals, reports, or docs that are published as PDFs. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().int().positive().max(assistantWebPdfReadMaxChars).optional(),
        maxPages: z.number().int().positive().max(assistantWebPdfReadMaxPages).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu.pdf',
        maxPages: 4,
        maxChars: 8_000,
      },
      execute: async ({ maxChars, maxPages, url }) =>
        await readAssistantWebPdf({
          url,
          maxChars,
          maxPages,
        }),
    }),
  ]
}

function createAssistantRuntimeToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  const readOnlyTools = [
    ...createAssistantKnowledgeReadToolDefinitions(input),
    defineAssistantTool({
      name: 'assistant.state.list',
      description:
        'List small non-canonical assistant scratch-state documents, optionally filtered by prefix.',
      inputSchema: z.object({
        prefix: z.string().min(1).optional(),
      }),
      inputExample: {
        prefix: 'cron/',
      },
      execute: async ({ prefix }) =>
        (await listAssistantStateDocuments({
          vault: input.vault,
          prefix,
        })).map((entry) => redactAssistantStateDocumentListEntry(entry)),
    }),
    defineAssistantTool({
      name: 'assistant.state.show',
      description:
        'Show one assistant scratch-state document by doc id.',
      inputSchema: z.object({
        docId: z.string().min(1),
      }),
      inputExample: {
        docId: 'cron/my-reminder',
      },
      execute: async ({ docId }) =>
        redactAssistantStateDocumentSnapshot(
          await getAssistantStateDocument({
            docId,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.memory.search',
      description:
        'Search assistant memory for prior preferences, naming, standing instructions, or durable health context.',
      inputSchema: z.object({
        text: z.string().min(1).optional(),
        scope: assistantMemoryQueryScopeSchema.optional(),
        section: assistantMemoryVisibleSectionSchema.optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      inputExample: {
        text: 'tone',
        limit: 5,
      },
      execute: async ({ text, scope, section, limit }) => {
        const result = await searchAssistantMemory({
          vault: input.vault,
          text,
          scope,
          section: section ?? null,
          limit,
          includeSensitiveHealthContext: allowSensitiveHealthContextForAssistantTools(input),
        })
        return {
          ...result,
          results: result.results.map(redactAssistantMemorySearchHit),
        }
      },
    }),
    defineAssistantTool({
      name: 'assistant.memory.get',
      description:
        'Show one assistant memory record by id.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'long-term:preferences%7Cslot%3Aassistant-style%3Atone',
      },
      execute: async ({ id }) =>
        redactAssistantMemoryRecord(
          await getAssistantMemory({
          id,
          vault: input.vault,
          includeSensitiveHealthContext: allowSensitiveHealthContextForAssistantTools(input),
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.cron.status',
      description:
        'Show the current assistant cron scheduler snapshot for the active vault.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).getAssistantCronStatus(input.vault),
    }),
    defineAssistantTool({
      name: 'assistant.cron.list',
      description:
        'List configured assistant cron jobs for the active vault.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).listAssistantCronJobs(input.vault),
    }),
    defineAssistantTool({
      name: 'assistant.cron.show',
      description:
        'Show one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).getAssistantCronJob(input.vault, job),
    }),
    defineAssistantTool({
      name: 'assistant.cron.target.show',
      description:
        'Show the outbound target currently configured for one assistant cron job.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) =>
        (await loadAssistantCronTools()).getAssistantCronJobTarget(input.vault, job),
    }),
    defineAssistantTool({
      name: 'assistant.cron.target.set',
      description:
        'Retarget one existing assistant cron job in place using an explicit outbound route or a saved self-target for the selected channel.',
      inputSchema: assistantCronTargetMutationSchema,
      inputExample: {
        job: 'weekly-digest',
        channel: 'telegram',
      },
      execute: async ({ channel, deliveryTarget, dryRun, identityId, job, participantId, resetContinuity, sourceThreadId }) =>
        (await loadAssistantCronTools()).setAssistantCronJobTarget({
          vault: input.vault,
          job,
          channel,
          deliveryTarget,
          dryRun,
          identityId,
          participantId,
          resetContinuity,
          sourceThreadId,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.runs',
      description:
        'List recent runs for one assistant cron job.',
      inputSchema: z.object({
        job: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      }),
      inputExample: {
        job: 'weekly-digest',
        limit: 10,
      },
      execute: async ({ job, limit }) =>
        (await loadAssistantCronTools()).listAssistantCronRuns({
          vault: input.vault,
          job,
          limit,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.list',
      description:
        'List built-in assistant cron presets.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () => (await loadAssistantCronTools()).listAssistantCronPresets(),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.show',
      description:
        'Show one built-in assistant cron preset definition.',
      inputSchema: z.object({
        presetId: z.string().min(1),
      }),
      inputExample: {
        presetId: 'weekly-summary',
      },
      execute: async ({ presetId }) => (await loadAssistantCronTools()).getAssistantCronPreset(presetId),
    }),
    defineAssistantTool({
      name: 'assistant.selfTarget.list',
      description:
        'List saved outbound self-target routes such as email, Telegram, or phone delivery settings.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: () => listAssistantSelfDeliveryTargets(),
    }),
    defineAssistantTool({
      name: 'assistant.selfTarget.show',
      description:
        'Show the saved outbound self-target route for one channel.',
      inputSchema: z.object({
        channel: z.string().min(1),
      }),
      inputExample: {
        channel: 'telegram',
      },
      execute: ({ channel }) => resolveAssistantSelfDeliveryTarget(channel),
    }),
  ]

  if (!(options.includeStatefulWriteTools ?? true)) {
    return readOnlyTools
  }

  return [
    ...readOnlyTools,
    ...createAssistantKnowledgeWriteToolDefinitions(input),
    defineAssistantTool({
      name: 'assistant.state.put',
      description:
        'Replace one assistant scratch-state document with the provided JSON object.',
      inputSchema: z.object({
        docId: z.string().min(1),
        value: jsonObjectSchema,
      }),
      inputExample: {
        docId: 'cron/my-reminder',
        value: {
          snoozedUntil: '2026-03-31',
        },
      },
      execute: async ({ docId, value }) =>
        redactAssistantStateDocumentSnapshot(
          await putAssistantStateDocument({
            docId,
            value,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.state.patch',
      description:
        'Merge one JSON object patch into an existing assistant scratch-state document.',
      inputSchema: z.object({
        docId: z.string().min(1),
        patch: jsonObjectSchema,
      }),
      inputExample: {
        docId: 'cron/my-reminder',
        patch: {
          snoozedUntil: '2026-03-31',
        },
      },
      execute: async ({ docId, patch }) =>
        redactAssistantStateDocumentSnapshot(
          await patchAssistantStateDocument({
            docId,
            patch,
            vault: input.vault,
          }),
        ),
    }),
    defineAssistantTool({
      name: 'assistant.state.delete',
      description:
        'Delete one assistant scratch-state document by doc id.',
      inputSchema: z.object({
        docId: z.string().min(1),
      }),
      inputExample: {
        docId: 'cron/my-reminder',
      },
      execute: async ({ docId }) => {
        const deleted = await deleteAssistantStateDocument({
          docId,
          vault: input.vault,
        })
        return {
          ...deleted,
          documentPath: redactAssistantDisplayPath(deleted.documentPath),
        }
      },
    }),
    defineAssistantTool({
      name: 'assistant.cron.add',
      description:
        'Create one assistant cron job with an explicit prompt, schedule, and outbound delivery target.',
      inputSchema: assistantCronDeliveryTargetSchema.extend({
        name: z.string().min(1),
        prompt: z.string().min(1),
        schedule: assistantCronScheduleInputSchema,
        enabled: z.boolean().optional(),
        keepAfterRun: z.boolean().optional(),
        bindState: z.boolean().optional(),
        stateDocId: z.string().min(1).nullable().optional(),
      }),
      inputExample: {
        name: 'weekly-digest',
        prompt: 'Summarize the past week and propose one small next step.',
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
          timeZone: 'America/Los_Angeles',
        },
        channel: 'telegram',
      },
      execute: async ({ bindState, channel, deliveryTarget, enabled, identityId, keepAfterRun, name, participantId, prompt, schedule, sourceThreadId, stateDocId }) =>
        (await loadAssistantCronTools()).addAssistantCronJob({
          vault: input.vault,
          name,
          prompt,
          schedule,
          channel,
          deliveryTarget,
          enabled,
          identityId,
          keepAfterRun,
          bindState,
          participantId,
          sourceThreadId,
          stateDocId: stateDocId ?? null,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.preset.install',
      description:
        'Install one built-in assistant cron preset into the active vault with optional schedule, routing, and variable overrides.',
      inputSchema: assistantCronDeliveryTargetSchema.extend({
        presetId: z.string().min(1),
        name: z.string().min(1).optional(),
        schedule: assistantCronScheduleInputSchema.optional(),
        enabled: z.boolean().optional(),
        bindState: z.boolean().optional(),
        stateDocId: z.string().min(1).nullable().optional(),
        additionalInstructions: z.string().min(1).optional(),
        variables: z.record(z.string(), z.string().nullable()).optional(),
      }),
      inputExample: {
        presetId: 'weekly-summary',
        channel: 'telegram',
      },
      execute: async ({
        additionalInstructions,
        bindState,
        channel,
        deliveryTarget,
        enabled,
        identityId,
        name,
        participantId,
        presetId,
        schedule,
        sourceThreadId,
        stateDocId,
        variables,
      }) =>
        (await loadAssistantCronTools()).installAssistantCronPreset({
          vault: input.vault,
          presetId,
          name: name ?? null,
          schedule: schedule ?? null,
          channel,
          deliveryTarget,
          enabled,
          identityId,
          bindState,
          participantId,
          sourceThreadId,
          stateDocId: stateDocId ?? null,
          additionalInstructions: additionalInstructions ?? null,
          variables: variables ?? null,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.cron.enable',
      description:
        'Enable one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).setAssistantCronJobEnabled(input.vault, job, true),
    }),
    defineAssistantTool({
      name: 'assistant.cron.disable',
      description:
        'Disable one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).setAssistantCronJobEnabled(input.vault, job, false),
    }),
    defineAssistantTool({
      name: 'assistant.cron.remove',
      description:
        'Remove one assistant cron job by job id or job name.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) => (await loadAssistantCronTools()).removeAssistantCronJob(input.vault, job),
    }),
    defineAssistantTool({
      name: 'assistant.cron.runNow',
      description:
        'Run one assistant cron job immediately.',
      inputSchema: z.object({
        job: z.string().min(1),
      }),
      inputExample: {
        job: 'weekly-digest',
      },
      execute: async ({ job }) =>
        (await loadAssistantCronTools()).runAssistantCronJobNow({
          vault: input.vault,
          job,
        }),
    }),
  ]
}

function createAssistantKnowledgeReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineAssistantTool({
      name: 'assistant.knowledge.list',
      description:
        'List derived knowledge pages from Murph\'s non-canonical local wiki, optionally filtered by page type or status.',
      inputSchema: z.object({
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        pageType: 'concept',
      },
      execute: async ({ pageType, status }) =>
        await listKnowledgePages({
          vault: input.vault,
          pageType,
          status,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.knowledge.search',
      description:
        'Search the derived knowledge wiki by lexical match across titles, summaries, narrative body text, related slugs, and source paths.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
      }),
      inputExample: {
        query: 'sleep magnesium',
        limit: 5,
      },
      execute: async ({ limit, pageType, query, status }) =>
        await searchKnowledgePages({
          vault: input.vault,
          query,
          limit,
          pageType,
          status,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.knowledge.get',
      description:
        'Show one derived knowledge page by slug, including the normalized markdown and canonical metadata.',
      inputSchema: z.object({
        slug: knowledgeSlugSchema,
      }),
      inputExample: {
        slug: 'sleep-quality',
      },
      execute: async ({ slug }) =>
        await getKnowledgePage({
          vault: input.vault,
          slug,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.knowledge.lint',
      description:
        'Run deterministic structural checks over derived knowledge pages, including parse failures, duplicate slugs, missing sources, and broken related links.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await lintKnowledgePages({
          vault: input.vault,
        }),
    }),
  ]
}

function createAssistantKnowledgeWriteToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineAssistantTool({
      name: 'assistant.knowledge.upsert',
      description:
        'Persist one assistant-authored derived knowledge page, normalize its frontmatter and generated sections, and rebuild the derived knowledge index.',
      inputSchema: z.object({
        body: z.string().min(1),
        title: z.string().min(1).optional(),
        slug: knowledgeSlugSchema.optional(),
        pageType: knowledgeMetadataTagSchema.optional(),
        status: knowledgeMetadataTagSchema.optional(),
        sourcePaths: z.array(knowledgeSourcePathSchema).optional(),
        relatedSlugs: z.array(knowledgeSlugSchema).optional(),
      }),
      inputExample: {
        title: 'Sleep quality',
        body: '# Sleep quality\n\nMagnesium may help sleep continuity.\n',
        sourcePaths: ['research/2026/04/sleep-note.md'],
      },
      execute: async ({
        body,
        pageType,
        relatedSlugs,
        slug,
        sourcePaths,
        status,
        title,
      }) =>
        await upsertKnowledgePage({
          vault: input.vault,
          body,
          title,
          slug,
          pageType,
          relatedSlugs,
          sourcePaths,
          status,
        }),
    }),
    defineAssistantTool({
      name: 'assistant.knowledge.rebuildIndex',
      description:
        'Rebuild the derived knowledge index markdown from the current saved pages.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: async () =>
        await rebuildKnowledgeIndex({
          vault: input.vault,
        }),
    }),
  ]
}

function createInboxPromotionToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.inboxServices || !input.captureId) {
    return []
  }

  const captureIdSchema = z.object({
    captureId: z.literal(input.captureId),
  })

  return [
    defineAssistantTool({
      name: 'inbox.promote.meal',
      description:
        'Promote the current inbox capture into canonical meal storage when the capture is primarily a meal, snack, or drink log anchored by an image.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.document',
      description:
        'Promote the current inbox capture into canonical document storage when the primary value is a PDF, report, scan, screenshot, form, or other stored document attachment.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteDocument({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.journal',
      description:
        'Promote the current inbox capture into the canonical journal day when it is best represented as a freeform note, workout note, symptom note, or reminder.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
    defineAssistantTool({
      name: 'inbox.promote.experimentNote',
      description:
        'Promote the current inbox capture into one matching experiment page when the capture is clearly an experiment checkpoint or experiment note.',
      inputSchema: captureIdSchema,
      inputExample: {
        captureId: input.captureId,
      },
      execute: ({ captureId }) =>
        input.inboxServices!.promoteExperimentNote({
          vault: input.vault,
          requestId: input.requestId ?? null,
          captureId,
        }),
    }),
  ]
}

function createVaultQueryToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return [
    defineAssistantTool({
      name: 'vault.show',
      description:
        'Show one canonical record or document by its lookup id. Use this to inspect an existing entity before deciding how to write related data.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'journal:2026-03-13',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.show({
          vault: input.vault,
          requestId: input.requestId ?? null,
          id,
        }),
    }),
    defineAssistantTool({
      name: 'vault.list',
      description:
        'List canonical records with query-layer filters. Use this to inspect existing records before choosing a write target.',
      inputSchema: z.object({
        recordType: optionalStringArraySchema,
        kind: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
        stream: optionalStringArraySchema,
        experiment: z.string().min(1).optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        tag: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        kind: 'goal',
        limit: 10,
      },
      execute: (filters) =>
        input.vaultServices!.query.list(
          {
            vault: input.vault,
            requestId: input.requestId ?? null,
            ...filters,
          } as Parameters<VaultServices['query']['list']>[0],
        ),
    }),
    defineAssistantTool({
      name: 'vault.wearables.day',
      description:
        'Show one semantic daily wearable mirror with deduplicated sleep, activity, and recovery summaries plus source-confidence details for that day.',
      inputSchema: z.object({
        date: localDateSchema,
        providers: optionalStringArraySchema,
      }),
      inputExample: {
        date: '2026-03-31',
      },
      execute: ({ date, providers }) =>
        input.vaultServices!.query.showWearableDay({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          providers,
        }),
    }),
    defineAssistantTool({
      name: 'vault.wearables.sleep',
      description:
        'List semantic daily sleep summaries with deduplicated provider selection and source-confidence details. Prefer this over raw sample reads when interpreting wearable sleep data.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        from: '2026-03-25',
        limit: 7,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableSleep({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineAssistantTool({
      name: 'vault.wearables.activity',
      description:
        'List semantic daily activity summaries with deduplicated workouts, steps, and source-confidence details across connected wearables.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        date: '2026-03-31',
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableActivity({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineAssistantTool({
      name: 'vault.wearables.body',
      description:
        'List semantic daily body-state summaries with deduplicated weight, body-fat, BMI, temperature, and source-confidence details.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        limit: 14,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableBodyState({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineAssistantTool({
      name: 'vault.wearables.recovery',
      description:
        'List semantic daily recovery summaries with deduplicated readiness, recovery, HRV, and temperature signals plus source-confidence details.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        from: '2026-03-25',
        limit: 7,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableRecovery({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 14,
        }),
    }),
    defineAssistantTool({
      name: 'vault.wearables.sources',
      description:
        'List wearable-source health, coverage, and freshness so the assistant can explain which providers are present and how much evidence each source contributes.',
      inputSchema: z.object({
        date: localDateSchema.optional(),
        from: localDateSchema.optional(),
        to: localDateSchema.optional(),
        providers: optionalStringArraySchema,
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        limit: 10,
      },
      execute: ({ date, from, to, providers, limit }) =>
        input.vaultServices!.query.listWearableSources({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          from,
          to,
          providers,
          limit: limit ?? 10,
        }),
    }),
    defineAssistantTool({
      name: 'vault.recipe.show',
      description:
        'Show one remembered recipe by canonical recipe id or slug.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'sheet-pan-salmon-bowls',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.showRecipe({
          vault: input.vault,
          requestId: input.requestId ?? null,
          lookup: id,
        }),
    }),
    defineAssistantTool({
      name: 'vault.recipe.list',
      description:
        'List remembered recipe records with an optional recipe status filter.',
      inputSchema: z.object({
        status: z.enum(RECIPE_STATUSES).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        status: 'saved',
        limit: 10,
      },
      execute: ({ status, limit }) =>
        input.vaultServices!.query.listRecipes({
          vault: input.vault,
          requestId: input.requestId ?? null,
          status,
          limit: limit ?? 10,
        }),
    }),
    defineAssistantTool({
      name: 'vault.food.show',
      description:
        'Show one remembered food by canonical food id or slug.',
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      inputExample: {
        id: 'regular-acai-bowl',
      },
      execute: ({ id }) =>
        input.vaultServices!.query.showFood({
          vault: input.vault,
          requestId: input.requestId ?? null,
          lookup: id,
        }),
    }),
    defineAssistantTool({
      name: 'vault.food.list',
      description:
        'List remembered regular foods with an optional status filter.',
      inputSchema: z.object({
        status: z.enum(FOOD_STATUSES).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      inputExample: {
        status: 'active',
        limit: 10,
      },
      execute: ({ status, limit }) =>
        input.vaultServices!.query.listFoods({
          vault: input.vault,
          requestId: input.requestId ?? null,
          status,
          limit: limit ?? 10,
        }),
    }),
  ]
}

function createQueryAndReadToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  return [
    ...(options.includeVaultTextReadTool ?? true
      ? createVaultTextReadToolDefinitions(input)
      : []),
    ...(options.includeQueryTools ?? true
      ? createVaultQueryToolDefinitions(input)
      : []),
    ...(options.includeWebSearchTools ?? true
      ? [
          ...createWebFetchToolDefinitions(),
          ...createWebPdfReadToolDefinitions(),
          ...createWebSearchToolDefinitions(),
        ]
      : []),
  ]
}

function createCanonicalVaultWriteToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  if (!input.vaultServices) {
    return []
  }

  const tools = [
    defineAssistantTool({
      name: 'vault.document.import',
      description:
        'Import one file into canonical document storage. Pass an absolute path or a vault-relative path copied into the vault.',
      inputSchema: z.object({
        file: vaultFilePathSchema,
        title: z.string().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
        note: z.string().min(1).optional(),
        source: z.enum(['manual', 'import', 'device', 'derived']).optional(),
      }),
      inputExample: {
        file: 'raw/inbox/captures/cap_123/attachments/1/report.pdf',
        source: 'import',
      },
      execute: async ({ file, title, occurredAt, note, source }) =>
        input.vaultServices!.importers.importDocument({
          vault: input.vault,
          requestId: input.requestId ?? null,
          file: await resolveAssistantVaultPath(input.vault, file, 'file path'),
          title,
          occurredAt,
          note,
          source,
        }),
    }),
    defineAssistantTool({
      name: 'vault.meal.add',
      description:
        'Create one canonical meal record from a photo plus an optional audio note and optional text note. Use this for meals, snacks, and drink logs, preserving snack/drink context in the note when helpful.',
      inputSchema: z.object({
        photo: vaultFilePathSchema,
        audio: vaultFilePathSchema.optional(),
        note: z.string().min(1).optional(),
        occurredAt: isoTimestampSchema.optional(),
      }),
      inputExample: {
        photo: 'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
        note: 'Post-workout meal',
      },
      execute: async ({ photo, audio, note, occurredAt }) =>
        input.vaultServices!.core.addMeal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          photo: await resolveAssistantVaultPath(input.vault, photo, 'file path'),
          audio: audio
            ? await resolveAssistantVaultPath(input.vault, audio, 'file path')
            : undefined,
          note,
          occurredAt,
        }),
    }),
    defineAssistantTool({
      name: 'vault.journal.ensure',
      description:
        'Ensure the canonical journal page for one date exists.',
      inputSchema: z.object({
        date: localDateSchema,
      }),
      inputExample: {
        date: '2026-03-13',
      },
      execute: ({ date }) =>
        input.vaultServices!.core.ensureJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
        }),
    }),
    defineAssistantTool({
      name: 'vault.journal.append',
      description:
        'Append one freeform markdown note block to the canonical journal page for a date.',
      inputSchema: z.object({
        date: localDateSchema,
        text: z.string().min(1),
      }),
      inputExample: {
        date: '2026-03-13',
        text: 'Workout: 30 minute zone 2 ride.',
      },
      execute: ({ date, text }) =>
        input.vaultServices!.core.appendJournal({
          vault: input.vault,
          requestId: input.requestId ?? null,
          date,
          text,
        }),
    }),
    defineAssistantTool({
      name: 'vault.experiment.create',
      description:
        'Create or reuse a canonical experiment page.',
      inputSchema: z.object({
        slug: z.string().min(1),
        title: z.string().min(1).optional(),
        hypothesis: z.string().min(1).optional(),
        startedOn: localDateSchema.optional(),
        status: z.string().min(1).optional(),
      }),
      inputExample: {
        slug: 'creatine-trial',
        title: 'Creatine Trial',
      },
      execute: ({ slug, title, hypothesis, startedOn, status }) =>
        input.vaultServices!.core.createExperiment({
          vault: input.vault,
          requestId: input.requestId ?? null,
          slug,
          title,
          hypothesis,
          startedOn,
          status,
        }),
    }),
    defineAssistantTool({
      name: 'vault.provider.upsert',
      description:
        'Upsert one provider record from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          providerId: 'prov_example',
          title: 'Example Provider',
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.provider.upsert', payload)
        return input.vaultServices!.core.upsertProvider({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.recipe.upsert',
      description:
        'Upsert one recipe record from a JSON payload object so the vault can remember dishes, ingredients, and prep notes.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          title: 'Sheet Pan Salmon Bowls',
          status: 'saved',
          ingredients: ['2 salmon fillets', '2 cups cooked rice'],
          steps: ['Roast the salmon.', 'Serve over rice.'],
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.recipe.upsert', payload)
        return input.vaultServices!.core.upsertRecipe({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.food.upsert',
      description:
        'Upsert one regular food record from a JSON payload object so the vault can remember recurring meals, snacks, bowls, smoothies, and grocery staples.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          title: 'Regular Acai Bowl',
          status: 'active',
          vendor: 'Neighborhood Acai Bar',
          ingredients: ['acai base', 'banana', 'granola'],
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.food.upsert', payload)
        return input.vaultServices!.core.upsertFood({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.event.upsert',
      description:
        'Upsert one canonical event record from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          kind: 'note',
          occurredAt: '2026-03-13T10:00:00-07:00',
          title: 'Example event',
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.event.upsert', payload)
        return input.vaultServices!.core.upsertEvent({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.samples.add',
      description:
        'Append one or more sample records from a JSON payload object.',
      inputSchema: z.object({
        payload: jsonObjectSchema,
      }),
      inputExample: {
        payload: {
          stream: 'body_weight',
          source: 'manual',
          quality: 'curated',
          samples: [],
        },
      },
      execute: async ({ payload }) => {
        const inputFile = await writeAssistantPayloadFile(input.vault, 'vault.samples.add', payload)
        return input.vaultServices!.core.addSamples({
          vault: input.vault,
          requestId: input.requestId ?? null,
          inputFile,
        })
      },
    }),
    defineAssistantTool({
      name: 'vault.intake.import',
      description:
        'Import one assessment response file into canonical intake storage.',
      inputSchema: z.object({
        file: vaultFilePathSchema,
      }),
      inputExample: {
        file: 'raw/inbox/captures/cap_123/attachments/1/assessment.json',
      },
      execute: async ({ file }) =>
        input.vaultServices!.importers.importAssessmentResponse({
          vault: input.vault,
          requestId: input.requestId ?? null,
          file: await resolveAssistantVaultPath(input.vault, file, 'file path'),
        }),
    }),
    ...createHealthUpsertToolDefinitions(input),
  ]

  if (options.includeStatefulWriteTools ?? true) {
    return [
      ...tools,
      defineAssistantTool({
        name: 'vault.intake.project',
        description:
          'Project one imported intake assessment into a typed proposal object without directly mutating the health registries.',
        inputSchema: z.object({
          assessmentId: z.string().min(1),
        }),
        inputExample: {
          assessmentId: 'asmt_example',
        },
        execute: ({ assessmentId }) =>
          input.vaultServices!.core.projectAssessment({
            vault: input.vault,
            requestId: input.requestId ?? null,
            assessmentId,
          }),
      }),
      defineAssistantTool({
        name: 'vault.profile.rebuildCurrent',
        description:
          'Rebuild the derived current profile page from the latest accepted profile snapshot.',
        inputSchema: z.object({}),
        inputExample: {},
        execute: () =>
          input.vaultServices!.core.rebuildCurrentProfile({
            vault: input.vault,
            requestId: input.requestId ?? null,
          }),
      }),
      defineAssistantTool({
        name: 'vault.protocol.stop',
        description:
          'Stop an existing protocol while preserving its canonical id.',
        inputSchema: z.object({
          protocolId: z.string().min(1),
          stoppedOn: localDateSchema.optional(),
        }),
        inputExample: {
          protocolId: 'prot_example',
          stoppedOn: '2026-03-13',
        },
        execute: ({ protocolId, stoppedOn }) =>
          input.vaultServices!.core.stopProtocol({
            vault: input.vault,
            requestId: input.requestId ?? null,
            protocolId,
            stoppedOn,
          }),
      }),
    ]
  }

  return tools
}

function createOutwardSideEffectToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineAssistantTool({
      name: 'vault.share.createLink',
      description:
        'Create a one-time hosted share link for remembered foods, recipes, and protocols. When a food has attached protocol ids, keep includeAttachedProtocols=true so the recipient gets the full smoothie + supplement bundle.',
      inputSchema: z.object({
        title: z.string().min(1).optional(),
        foods: z.array(shareEntitySelectorSchema).optional(),
        protocols: z.array(shareEntitySelectorSchema).optional(),
        recipes: z.array(shareEntitySelectorSchema).optional(),
        includeAttachedProtocols: z.boolean().optional(),
        logMeal: z.object({
          food: shareEntitySelectorSchema,
          note: z.string().min(1).optional(),
          occurredAt: isoTimestampSchema.optional(),
        }).optional(),
        recipientPhoneNumber: z.string().min(1).optional(),
        inviteCode: z.string().min(1).optional(),
        expiresInHours: z.number().int().positive().max(24 * 30).optional(),
      }),
      inputExample: {
        foods: [
          {
            slug: 'morning-smoothie',
          },
        ],
        includeAttachedProtocols: true,
        logMeal: {
          food: {
            slug: 'morning-smoothie',
          },
        },
      },
      execute: async ({ expiresInHours, foods, includeAttachedProtocols, inviteCode, logMeal, protocols, recipientPhoneNumber, recipes, title }) => {
        const pack = await buildSharePackFromVault({
          vaultRoot: input.vault,
          title,
          foods,
          protocols,
          recipes,
          includeAttachedProtocols,
          logMeal,
        })

        return issueHostedShareLink({
          pack,
          expiresInHours,
          inviteCode,
          recipientPhoneNumber,
          senderMemberId: input.executionContext?.hosted?.memberId ?? null,
        })
      },
    }),
  ]
}

function createHealthUpsertToolDefinitions(
  input: AssistantToolContext,
) {
  if (!input.vaultServices) {
    return []
  }

  return healthEntityDescriptors
    .filter(hasHealthCommandDescriptor)
    .map((descriptor) =>
      defineAssistantTool({
        name: `vault.${descriptor.command.commandName}.upsert`,
        description: `${descriptor.command.descriptions.upsert} The payload should follow the scaffold template for ${descriptor.command.commandName}.`,
        inputSchema: z.object({
          payload: jsonObjectSchema,
        }),
        inputExample: {
          payload: descriptor.core.payloadTemplate,
        },
        execute: async ({ payload }) => {
          const inputFile = await writeAssistantPayloadFile(
            input.vault,
            `vault.${descriptor.command.commandName}.upsert`,
            payload,
          )
          const method = input.vaultServices!.core[
            descriptor.core.upsertServiceMethod
          ] as unknown as (input: {
            vault: string
            requestId: string | null
            input: string
          }) => Promise<unknown>

          return method({
            vault: input.vault,
            requestId: input.requestId ?? null,
            input: inputFile,
          })
        },
      }),
    )
}

async function readAssistantTextFile(
  vaultRoot: string,
  candidatePath: string,
  maxChars?: number,
): Promise<{
  path: string
  text: string
  totalChars: number
  truncated: boolean
}> {
  const resolvedPath = await resolveAssistantVaultPath(vaultRoot, candidatePath, 'file path')
  const limit = maxChars ?? assistantToolTextReadDefaultMaxChars
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const fileHandle = await open(resolvedPath, 'r')
  const buffer = Buffer.allocUnsafe(assistantToolTextReadChunkBytes)
  let text = ''
  let totalChars = 0

  try {
    while (true) {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }

      const chunk = buffer.subarray(0, bytesRead)
      if (chunk.includes(0)) {
        throw createAssistantToolFileNotTextError(candidatePath)
      }

      const chunkText = decodeAssistantTextChunk(decoder, chunk, candidatePath)
      totalChars += chunkText.length
      if (text.length < limit) {
        text += chunkText.slice(0, limit - text.length)
      }
    }

    const trailingText = decodeAssistantTextChunk(decoder, undefined, candidatePath)
    totalChars += trailingText.length
    if (text.length < limit) {
      text += trailingText.slice(0, limit - text.length)
    }
  } finally {
    await fileHandle.close()
  }

  const truncated = totalChars > limit
  const relativePath = path.relative(vaultRoot, resolvedPath).split(path.sep).join('/')

  return {
    path: relativePath,
    text:
      truncated
        ? `${text.slice(0, limit)}

[truncated ${totalChars - limit} characters]`
        : text,
    totalChars,
    truncated,
  }
}

function createAssistantToolFileNotTextError(candidatePath: string) {
  return new VaultCliError(
    'ASSISTANT_TOOL_FILE_NOT_TEXT',
    `Assistant file path "${candidatePath}" must reference a UTF-8 text file inside the vault.`,
  )
}

function decodeAssistantTextChunk(
  decoder: TextDecoder,
  chunk: Buffer | undefined,
  candidatePath: string,
): string {
  try {
    return chunk
      ? decoder.decode(chunk, { stream: true })
      : decoder.decode()
  } catch {
    throw createAssistantToolFileNotTextError(candidatePath)
  }
}

async function issueHostedShareLink(input: {
  pack: Awaited<ReturnType<typeof buildSharePackFromVault>>
  expiresInHours?: number
  inviteCode?: string
  recipientPhoneNumber?: string
  senderMemberId?: string | null
}) {
  const baseUrl = normalizeHostedShareApiBaseUrl(
    process.env.HOSTED_SHARE_API_BASE_URL
      ?? process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL
      ?? null,
  )
  const token = readHostedShareApiToken(process.env.HOSTED_SHARE_INTERNAL_TOKENS ?? null)

  if (!baseUrl || !token) {
    throw new Error(
      'Hosted share link creation requires HOSTED_SHARE_API_BASE_URL or HOSTED_ONBOARDING_PUBLIC_BASE_URL plus HOSTED_SHARE_INTERNAL_TOKENS in the assistant environment.',
    )
  }

  const response = await fetch(`${baseUrl}/api/hosted-share/internal/create`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      pack: input.pack,
      expiresInHours: input.expiresInHours,
      inviteCode: input.inviteCode,
      recipientPhoneNumber: input.recipientPhoneNumber,
      senderMemberId: input.senderMemberId,
    }),
  })
  const payload = (await response.json()) as
    | ({
        error?: {
          message?: string
        }
      } & Record<string, unknown>)
    | null

  if (!response.ok) {
    throw new Error(
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : 'Hosted share link creation failed.',
    )
  }

  return payload
}

function normalizeHostedShareApiBaseUrl(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const url = new URL(normalized)
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/u, '')
}

function readHostedShareApiToken(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? null
}

async function writeAssistantPayloadFile(
  vaultRoot: string,
  toolName: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`
  const directory = path.join(
    vaultRoot,
    'derived',
    'assistant',
    'payloads',
    sanitizeToolName(toolName),
  )
  const absolutePath = path.join(directory, fileName)
  await mkdir(directory, { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return absolutePath
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/[.]+/gu, '-')
}
