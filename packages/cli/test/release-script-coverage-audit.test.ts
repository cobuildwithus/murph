import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  detectWorkspacePackageCycles,
  formatWorkspacePackageCycles,
} from '../../../scripts/check-workspace-package-cycles.mjs'
import { withoutNodeV8Coverage } from './cli-test-helpers.js'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const rootPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as {
  name?: string
  scripts?: Record<string, string>
}
const cliPackageJson = JSON.parse(
  readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
) as {
  bin?: Record<string, string>
  bundleDependencies?: string[]
  dependencies?: Record<string, string>
  files?: string[]
  name?: string
  scripts?: Record<string, string>
  version?: string
}
const hostedWebPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps', 'web', 'package.json'), 'utf8'),
) as {
  scripts?: Record<string, string>
}
const auditZipEntryListMaxBufferBytes = 16 * 1024 * 1024

type BrowserCommand = {
  listPollCount: number
  method: string
  params: Record<string, unknown>
}

type ReviewGptHarnessOptions = {
  closeBrowserSocketBeforeOpen?: boolean
  closeBrowserSocketAfterCreate?: boolean
  closeCommandFailuresBeforeSuccess?: number
  closeCommandReturnsFalse?: boolean
  closeCommandFails?: boolean
  closeCommandHangsAfterClosingAtAttempt?: number
  createCommandOmitsTargetId?: boolean
  draftTimeoutMs?: number
  failBrowserSocketOpen?: boolean
  failListAfterClose?: boolean
  failPageCommand?: boolean
  failPageCommandAtMethod?: string
  firstTargetPageCommandsHangThenFail?: boolean
  failPageSocketOpen?: boolean
  failPageSocketOpenAttempts?: number
  hangBrowserSocketAfterCreate?: boolean
  hangCloseCommandAtAttempt?: number
  hangListAfterClose?: boolean
  hangPageSocketOpenAttempts?: number
  hangVersionAtCall?: number
  prompt?: string
  remotePort?: string
  responseFile?: string
  shouldSend?: boolean
  shouldWaitForResponse?: boolean
  targetPresentAfterClose?: boolean
  throwCreateSendSynchronouslyOnce?: boolean
}

type ReviewGptAssistantSnapshot = {
  afterLastUserMessage?: boolean
  hasCopyButton?: boolean
  modelConfirmationText?: string
  modelSlug?: string
  precedingUserMessageSignature?: string
  signature: string
  text: string
}

type ModelVerificationEvidence = {
  schemaVersion: number
  requestedModel: string
  responseModelSlug: string
  responseSha256: string
}

type ModelAttestationResult = {
  evidence: ModelVerificationEvidence | null
  failure: string
}

type MockSocketEvent = {
  data?: string
  error?: Error
}

// The package keeps this lifecycle function private, so expose it only inside
// an in-memory test wrapper around the exact installed driver.
function loadReviewGptOpenTargetHarness(
  targetReadyAfterPoll: number,
  listFailureAtPoll?: number,
  options: ReviewGptHarnessOptions = {},
) {
  const driverPath = path.join(
    repoRoot,
    'node_modules',
    '@cobuild',
    'review-gpt',
    'src',
    'prepare-chatgpt-draft.js',
  )
  const driverSource = [
    readFileSync(driverPath, 'utf8'),
    'module.exports.__browserTransportTimeoutMsTest = browserTransportTimeoutMs;',
    'module.exports.__pageCommandTimeoutMsTest = pageCommandTimeoutMs;',
    'module.exports.__openTargetTest = openNewTarget;',
    'module.exports.__connectTargetTest = connectTargetWebSocket;',
    'module.exports.__draftPromptTest = draftPrompt;',
    'module.exports.__isRetryableSocketErrorTest = isRetryableSocketError;',
    'module.exports.__mainTest = main;',
    'module.exports.__mainWithRetryTest = mainWithRetry;',
    'module.exports.__markedResponseDurationFailureTest = markedResponseDurationFailure;',
    'module.exports.__modelAttestationTurnNonceTest = modelAttestationTurnNonce;',
    'module.exports.__modelAttestationForSnapshotTest = modelAttestationForSnapshot;',
    'module.exports.__prepareRuntimeConfigTest = prepareRuntimeConfig;',
    'module.exports.__removeModelVerificationEvidenceFileTest = removeModelVerificationEvidenceFile;',
    'module.exports.__writeCompletedResponseArtifactsTest = writeCompletedResponseArtifacts;',
    'module.exports.__withTimeoutTest = withTimeout;',
  ].join('\n')
  const commands: BrowserCommand[] = []
  let closeCommandAttemptCount = 0
  let createSendAttemptCount = 0
  let createdTargetCount = 0
  let latestTargetId = ''
  let latestTargetUrl = ''
  let listPollCount = 0
  let now = 0
  let pageSocketCount = 0
  let targetClosed = false
  let versionFetchCount = 0

  class MockWebSocket {
    readonly listeners = new Map<string, Array<(event: MockSocketEvent) => void>>()
    readonly readyState = 1
    private readonly pageSocketOrdinal: number | null

    constructor(private readonly url: string) {
      if (url === 'ws://page') {
        pageSocketCount += 1
        this.pageSocketOrdinal = pageSocketCount
      } else {
        this.pageSocketOrdinal = null
      }
    }

    addEventListener(
      type: string,
      listener: (event: MockSocketEvent) => void,
    ) {
      const listeners = this.listeners.get(type) ?? []
      listeners.push(listener)
      this.listeners.set(type, listeners)

      if (type === 'open') {
        if (this.url === 'ws://browser' && options.closeBrowserSocketBeforeOpen) {
          queueMicrotask(() => this.emit('close', {}))
          return
        }
        if (this.url === 'ws://browser' && options.failBrowserSocketOpen) {
          queueMicrotask(() => this.emit('error', {
            error: new Error('Injected browser WebSocket error'),
          }))
          return
        }
        const shouldHangPageSocket = this.url === 'ws://page' && (
          this.pageSocketOrdinal !== null &&
          this.pageSocketOrdinal <= (options.hangPageSocketOpenAttempts ?? 0)
        )
        if (shouldHangPageSocket) return
        const shouldFailPageSocket = this.url === 'ws://page' && (
          options.failPageSocketOpen ||
          (
            this.pageSocketOrdinal !== null &&
            this.pageSocketOrdinal <= (options.failPageSocketOpenAttempts ?? 0)
          )
        )
        if (shouldFailPageSocket) {
          queueMicrotask(() => this.emit('error', {
            error: new Error('Injected page WebSocket error'),
          }))
        } else {
          queueMicrotask(() => this.emit('open', {}))
        }
      }
    }

    send(payload: string) {
      const command = JSON.parse(payload) as {
        id: number
        method: string
        params?: Record<string, unknown>
      }
      const isCreateCommand = command.method === 'Target.createTarget'
      if (isCreateCommand) {
        createSendAttemptCount += 1
        if (options.throwCreateSendSynchronouslyOnce && createSendAttemptCount === 1) {
          throw new Error('Injected synchronous create send failure')
        }
      }
      commands.push({
        listPollCount,
        method: command.method,
        params: command.params ?? {},
      })

      const isCloseCommand = command.method === 'Target.closeTarget'
      if (isCloseCommand) {
        closeCommandAttemptCount += 1
      }
      if (isCreateCommand) {
        createdTargetCount += 1
        latestTargetId = `target-${createdTargetCount}`
        latestTargetUrl = String(command.params?.url ?? '')
        targetClosed = false
      }

      queueMicrotask(() => {
        if (this.url === 'ws://page' && options.firstTargetPageCommandsHangThenFail) {
          if (this.pageSocketOrdinal === 1) return
          this.emit('message', {
            data: JSON.stringify({
              error: { message: 'Injected terminal command failure' },
              id: command.id,
            }),
          })
          return
        }
        if (this.url === 'ws://page' && options.failPageCommand) {
          this.emit('message', {
            data: JSON.stringify({
              error: { message: 'Injected CDP socket error' },
              id: command.id,
            }),
          })
          return
        }
        if (
          this.url === 'ws://page' &&
          command.method === options.failPageCommandAtMethod
        ) {
          this.emit('message', {
            data: JSON.stringify({
              error: { message: 'Injected CDP socket error' },
              id: command.id,
            }),
          })
          return
        }
        if (
          isCreateCommand &&
          options.closeBrowserSocketAfterCreate
        ) {
          this.emit('close', {})
          return
        }
        if (
          isCreateCommand &&
          options.hangBrowserSocketAfterCreate
        ) {
          return
        }
        const closeCommandShouldFail = isCloseCommand && (
          options.closeCommandFails ||
          closeCommandAttemptCount <= (options.closeCommandFailuresBeforeSuccess ?? 0)
        )
        if (closeCommandShouldFail) {
          this.emit('message', {
            data: JSON.stringify({
              error: { message: 'Injected target close failure' },
              id: command.id,
            }),
          })
          return
        }
        if (isCloseCommand && options.hangCloseCommandAtAttempt === closeCommandAttemptCount) {
          return
        }
        if (
          isCloseCommand &&
          options.closeCommandHangsAfterClosingAtAttempt === closeCommandAttemptCount
        ) {
          targetClosed = true
          return
        }
        if (isCloseCommand && !options.targetPresentAfterClose) {
          targetClosed = true
        }
        if (command.method === 'Page.navigate') {
          latestTargetUrl = String(command.params?.url ?? '')
        }
        const result = isCreateCommand
          ? (options.createCommandOmitsTargetId ? {} : { targetId: latestTargetId })
          : { success: isCloseCommand ? !options.closeCommandReturnsFalse : true }
        this.emit('message', {
          data: JSON.stringify({ id: command.id, result }),
        })
      })
    }

    close() {}

    private emit(type: string, event: MockSocketEvent) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event)
      }
    }
  }

  class MockDate extends Date {
    static override now() {
      return now
    }
  }

  let nextTimerId = 0
  const pendingTimers = new Map<number, NodeJS.Immediate>()
  const mockSetTimeout = (callback: () => void, delay = 0) => {
    const timerId = ++nextTimerId
    const handle = setImmediate(() => {
      pendingTimers.delete(timerId)
      now += Number(delay)
      callback()
    })
    pendingTimers.set(timerId, handle)
    return timerId
  }
  const mockClearTimeout = (timerId: number) => {
    const handle = pendingTimers.get(Number(timerId))
    if (!handle) return
    pendingTimers.delete(Number(timerId))
    clearImmediate(handle)
  }
  const mockFetch = async (url: string) => {
    const pathname = new URL(url).pathname
    if (pathname === '/json/version') {
      versionFetchCount += 1
      if (versionFetchCount === options.hangVersionAtCall) {
        return new Promise<never>(() => {})
      }
      return {
        json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }),
        ok: true,
        status: 200,
      }
    }
    if (pathname === '/json/list') {
      listPollCount += 1
      if (closeCommandAttemptCount > 0 && options.hangListAfterClose) {
        return new Promise<never>(() => {})
      }
      if (closeCommandAttemptCount > 0 && options.failListAfterClose) {
        throw new Error('Mock post-close target-list failure')
      }
      if (listPollCount === listFailureAtPoll) {
        throw new Error('Mock target-list failure')
      }
      const targetReady = listPollCount >= targetReadyAfterPoll
      const targetVisible = !targetClosed && (
        targetReady ||
        (closeCommandAttemptCount > 0 && Boolean(options.targetPresentAfterClose))
      )
      const targets = [
        {
          id: 'unrelated-user-target',
          type: 'page',
          url: 'https://chatgpt.com/',
          webSocketDebuggerUrl: 'ws://user-page',
        },
        ...(targetVisible
          ? [{
              id: latestTargetId,
              type: 'page',
              url: latestTargetUrl,
              ...(targetReady ? { webSocketDebuggerUrl: 'ws://page' } : {}),
            }]
          : []),
      ]
      return {
        json: async () => targets,
        ok: true,
        status: 200,
      }
    }
    throw new Error(`Unexpected mock browser endpoint: ${pathname}`)
  }

  const processForDriver = Object.create(process) as NodeJS.Process
  Object.defineProperty(processForDriver, 'env', {
    value: {
      ...process.env,
      ORACLE_DRAFT_FILES: '',
      ORACLE_DRAFT_MODEL: 'gpt-5.6-sol',
      ORACLE_DRAFT_PROMPT: options.prompt ?? 'Review the requested changes.',
      ORACLE_DRAFT_REMOTE_PORT: options.remotePort ?? '9999',
      ORACLE_DRAFT_RESPONSE_FILE: options.responseFile ?? '',
      ORACLE_DRAFT_SEND: options.shouldSend ? '1' : '0',
      ORACLE_DRAFT_TIMEOUT_MS: String(options.draftTimeoutMs ?? 10000),
      ORACLE_DRAFT_URL: 'https://chatgpt.com/',
      ORACLE_DRAFT_WAIT_RESPONSE: options.shouldWaitForResponse ? '1' : '0',
    },
  })
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} }
  const compiledDriver = new Script(
    `(function (require, module, exports, __filename, __dirname, process, console, setTimeout, clearTimeout, Date, fetch, WebSocket) {\n${driverSource}\n})`,
    { filename: driverPath },
  ).runInThisContext()
  if (typeof compiledDriver !== 'function') {
    throw new Error('ReviewGPT driver test wrapper did not compile to a function')
  }
  Reflect.apply(compiledDriver, undefined, [
    createRequire(driverPath),
    moduleRecord,
    moduleRecord.exports,
    driverPath,
    path.dirname(driverPath),
    processForDriver,
    console,
    mockSetTimeout,
    mockClearTimeout,
    MockDate,
    mockFetch,
    MockWebSocket,
  ])
  const browserTransportTimeoutMs = moduleRecord.exports.__browserTransportTimeoutMsTest
  const pageCommandTimeoutMs = moduleRecord.exports.__pageCommandTimeoutMsTest
  const openNewTarget = moduleRecord.exports.__openTargetTest
  const connectTarget = moduleRecord.exports.__connectTargetTest
  const draftPrompt = moduleRecord.exports.__draftPromptTest
  const isRetryableSocketError = moduleRecord.exports.__isRetryableSocketErrorTest
  const main = moduleRecord.exports.__mainTest
  const mainWithRetry = moduleRecord.exports.__mainWithRetryTest
  const markedResponseDurationFailure = moduleRecord.exports.__markedResponseDurationFailureTest
  const modelAttestationTurnNonce = moduleRecord.exports.__modelAttestationTurnNonceTest
  const modelAttestationForSnapshot = moduleRecord.exports.__modelAttestationForSnapshotTest
  const modelConfirmationFailure = moduleRecord.exports.modelConfirmationFailure
  const prepareRuntimeConfig = moduleRecord.exports.__prepareRuntimeConfigTest
  const removeModelVerificationEvidenceFile = moduleRecord.exports.__removeModelVerificationEvidenceFileTest
  const selectAssistantResponseCandidate = moduleRecord.exports.selectAssistantResponseCandidate
  const withTimeout = moduleRecord.exports.__withTimeoutTest
  const writeCompletedResponseArtifacts = moduleRecord.exports.__writeCompletedResponseArtifactsTest
  if (
    typeof browserTransportTimeoutMs !== 'number' ||
    typeof pageCommandTimeoutMs !== 'number' ||
    typeof openNewTarget !== 'function' ||
    typeof connectTarget !== 'function' ||
    typeof draftPrompt !== 'string' ||
    typeof isRetryableSocketError !== 'function' ||
    typeof main !== 'function' ||
    typeof mainWithRetry !== 'function' ||
    typeof markedResponseDurationFailure !== 'function' ||
    typeof modelAttestationTurnNonce !== 'string' ||
    typeof modelAttestationForSnapshot !== 'function' ||
    typeof modelConfirmationFailure !== 'function' ||
    typeof prepareRuntimeConfig !== 'function' ||
    typeof removeModelVerificationEvidenceFile !== 'function' ||
    typeof selectAssistantResponseCandidate !== 'function' ||
    typeof withTimeout !== 'function' ||
    typeof writeCompletedResponseArtifacts !== 'function'
  ) {
    throw new Error('ReviewGPT lifecycle functions were not available to the test harness')
  }

  return {
    commands,
    connectTarget: async (desiredUrl: string) => {
      return Reflect.apply(connectTarget, undefined, [desiredUrl])
    },
    getCloseCommandAttemptCount: () => closeCommandAttemptCount,
    getCreateSendAttemptCount: () => createSendAttemptCount,
    getDraftPrompt: () => draftPrompt,
    getListPollCount: () => listPollCount,
    getLatestTargetUrl: () => latestTargetUrl,
    getNow: () => now,
    getModelAttestationTurnNonce: () => modelAttestationTurnNonce,
    getBrowserTransportTimeoutMs: () => browserTransportTimeoutMs,
    getPageCommandTimeoutMs: () => pageCommandTimeoutMs,
    isRetryableSocketError: (error: Error) => {
      return Boolean(Reflect.apply(isRetryableSocketError, undefined, [error]))
    },
    main: async () => {
      await Reflect.apply(main, undefined, [])
    },
    mainWithRetry: async () => {
      await Reflect.apply(mainWithRetry, undefined, [])
    },
    markedResponseDurationFailure: (
      targetModel: string,
      responseMarker: string,
      responseElapsedMs: number,
    ) => String(Reflect.apply(markedResponseDurationFailure, undefined, [{
      responseElapsedMs,
      responseMarker,
      targetModel,
    }])),
    modelAttestationForSnapshot: (
      targetModel: string,
      snapshot: ReviewGptAssistantSnapshot,
      includeEvidence = false,
      committedUserTurnSignature = '',
      generationElapsedMs = 0,
    ) => Reflect.apply(modelAttestationForSnapshot, undefined, [
      targetModel,
      snapshot,
      includeEvidence,
      committedUserTurnSignature,
      generationElapsedMs,
    ]) as ModelAttestationResult,
    modelConfirmationFailure: (
      targetModel: string,
      responseText: string,
      responseModelSlug = '',
      generationElapsedMs = 0,
    ) => String(Reflect.apply(modelConfirmationFailure, undefined, [
      targetModel,
      responseText,
      responseModelSlug,
      generationElapsedMs,
    ])),
    prepareRuntimeConfig: () => {
      Reflect.apply(prepareRuntimeConfig, undefined, [])
    },
    removeModelVerificationEvidenceFile: (responseFilePath: string) => String(
      Reflect.apply(removeModelVerificationEvidenceFile, undefined, [responseFilePath]),
    ),
    selectAssistantResponseCandidate: (
      snapshots: ReviewGptAssistantSnapshot[],
      baselineAssistantSignatures: string[],
      requireAfterLastUserMessage = false,
      requiredPrecedingUserMessageSignature = '',
    ) => Reflect.apply(selectAssistantResponseCandidate, undefined, [
      { assistantSnapshots: snapshots },
      baselineAssistantSignatures,
      [],
      requireAfterLastUserMessage,
      requiredPrecedingUserMessageSignature,
    ]) as {
      freshSnapshots: ReviewGptAssistantSnapshot[]
      snapshot: ReviewGptAssistantSnapshot | null
    },
    openNewTarget: async (desiredUrl: string) => {
      const target: unknown = await Reflect.apply(openNewTarget, undefined, [desiredUrl])
      if (
        !target ||
        typeof target !== 'object' ||
        !('id' in target) ||
        typeof target.id !== 'string'
      ) {
        throw new Error('ReviewGPT openNewTarget did not return a target')
      }
      return target
    },
    waitWithinTransport: async (durationMs: number) => {
      const operation = new Promise((resolve) => {
        mockSetTimeout(() => resolve('completed'), durationMs)
      })
      return Reflect.apply(withTimeout, undefined, [
        operation,
        browserTransportTimeoutMs,
        'Injected transport timeout',
      ])
    },
    waitWithinPageCommand: async (durationMs: number) => {
      const operation = new Promise((resolve) => {
        mockSetTimeout(() => resolve('completed'), durationMs)
      })
      return Reflect.apply(withTimeout, undefined, [
        operation,
        pageCommandTimeoutMs,
        'Injected page command timeout',
      ])
    },
    writeCompletedResponseArtifacts: (
      responseFilePath: string,
      responseText: string,
      evidence: ModelVerificationEvidence | null,
    ) => Reflect.apply(writeCompletedResponseArtifacts, undefined, [
      responseFilePath,
      responseText,
      evidence,
    ]) as { evidencePath: string; evidenceWarning: string; responseFilePath: string },
  }
}

type ReviewGptDomTestNode = {
  childNodes: ReviewGptDomTestNode[]
  computedStyle?: { display?: string; visibility?: string }
  getAttribute?: (name: string) => string | null
  hidden?: boolean
  nodeType: number
  nodeValue?: string
  tagName?: string
}

type ReviewGptModelPickerTarget = {
  desiredVersion: string
  wantsInstant: boolean
  wantsPro: boolean
  wantsSol: boolean
  wantsThinking: boolean
}

type ReviewGptModelPickerSummary = {
  label: string
  opensSubmenu: boolean
  testId?: string
  unavailable: boolean
  visible: boolean
}

const reviewGptModelPickerModule = createRequire(import.meta.url)(
  path.join(
    repoRoot,
    'node_modules',
    '@cobuild',
    'review-gpt',
    'src',
    'prepare-chatgpt-draft.js',
  ),
) as {
  modelPickerOptionCanTraverseTarget: (
    label: string,
    testId: string,
    target: ReviewGptModelPickerTarget,
    opensSubmenu?: boolean,
  ) => boolean
  modelPickerOptionMatchesTarget: (
    label: string,
    testId: string,
    target: ReviewGptModelPickerTarget,
  ) => boolean
  modelPickerSummarySelectionProof: (
    summary: ReviewGptModelPickerSummary,
    target: ReviewGptModelPickerTarget,
  ) => boolean
}

const reviewGptDomSnapshotModule = createRequire(import.meta.url)(
  path.join(
    repoRoot,
    'node_modules',
    '@cobuild',
    'review-gpt',
    'src',
    'chatgpt-dom-snapshot-shared.js',
  ),
) as {
  buildChatGptCaptureStateExpression: (input?: {
    desiredChatId?: string
    desiredOrigin?: string
  }) => string
  extractModelConfirmationText: (
    node: ReviewGptDomTestNode,
    getComputedStyleValue?: (
      node: ReviewGptDomTestNode,
    ) => { display?: string; visibility?: string } | undefined,
  ) => string
}

function reviewGptDomText(value: string): ReviewGptDomTestNode {
  return {
    childNodes: [],
    nodeType: 3,
    nodeValue: value,
  }
}

function reviewGptDomElement(
  tagName: string,
  childNodes: ReviewGptDomTestNode[],
  options: {
    attributes?: Record<string, string>
    display?: string
    hidden?: boolean
    visibility?: string
  } = {},
): ReviewGptDomTestNode {
  const attributes = options.attributes ?? {}
  return {
    childNodes,
    computedStyle: {
      display: options.display ?? 'inline',
      visibility: options.visibility ?? 'visible',
    },
    getAttribute: (name) => attributes[name] ?? null,
    hidden: options.hidden,
    nodeType: 1,
    tagName,
  }
}

function extractReviewGptModelConfirmationText(node: ReviewGptDomTestNode) {
  return reviewGptDomSnapshotModule.extractModelConfirmationText(
    node,
    (current) => current.computedStyle,
  )
}

function runNodeScript(...args: string[]) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
  })
}

function isSandboxedTsxPipeFailure(result: { stderr: string; stdout: string }) {
  return (
    result.stderr.includes('listen EPERM: operation not permitted') &&
    result.stderr.includes('/tsx-') &&
    result.stderr.includes('.pipe')
  )
}

function runAuditToolDirectly(scriptName: string, outDir: string, prefix: string) {
  const fullBundle = scriptName === 'package-audit-context-full.sh'
  const bootstrap = fullBundle
    ? `
source scripts/repo-tools.config.sh
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="$COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "config" \
  "packages" \
  "src" \
  "app" \
  "apps" \
  "contracts" \
  "scripts" \
  "docs"
`
    : 'source scripts/repo-tools.config.sh'

  return spawnSync(
    'bash',
    [
      '-lc',
      `set -euo pipefail
${bootstrap}
exec "$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"`,
      'audit-context',
      '--zip',
      '--out-dir',
      outDir,
      '--name',
      prefix,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
}

function createAuditZip(scriptName: string, prefix: string) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const initialResult = spawnSync(
    'bash',
    [path.join(repoRoot, 'scripts', scriptName), '--zip', '--out-dir', outDir, '--name', prefix],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
  const result =
    initialResult.status !== 0 && isSandboxedTsxPipeFailure(initialResult)
      ? runAuditToolDirectly(scriptName, outDir, prefix)
      : initialResult

  if (result.status !== 0) {
    throw new Error(
      `Failed to create audit zip via ${scriptName}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }

  const zipName = readdirSync(outDir).find((entry) => entry.endsWith('.zip'))
  expect(zipName, `missing zip output in ${outDir}`).toBeTruthy()
  return {
    outDir,
    zipPath: path.join(outDir, zipName!),
  }
}

function listZipEntries(zipPath: string) {
  return execFileSync('unzip', ['-Z1', zipPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
    maxBuffer: auditZipEntryListMaxBufferBytes,
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function readWorkspaceDiffScope(...changedFiles: string[]) {
  const result = runNodeScript('scripts/workspace-diff-scope.mjs', '--format', 'json', ...changedFiles)

  if (result.status !== 0) {
    throw new Error(
      `workspace-diff-scope failed for ${changedFiles.join(', ')}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }

  return JSON.parse(result.stdout) as {
    affectedWorkspaceDirs: string[]
    repoInternalFastPath: boolean
    runRepoToolsTests: boolean
    runVerifyCli: boolean
    testDirs: string[]
    typecheckDirs: string[]
  }
}

function parseCoordinationLedgerRows(ledgerText: string) {
  const lines = ledgerText.split(/\r?\n/u)
  const headerIndex = lines.findIndex((line) => line.startsWith('| Agent |'))

  if (headerIndex === -1) {
    throw new Error('Coordination ledger header not found.')
  }

  const headerColumns = lines[headerIndex]
    .split('|')
    .slice(1, -1)
    .map((part) => part.trim())
  const planColumnIndex = headerColumns.indexOf('Plan')
  const statusColumnIndex = headerColumns.indexOf('Status')

  if (planColumnIndex === -1 || statusColumnIndex === -1) {
    throw new Error('Coordination ledger is missing the Plan or Status column.')
  }

  return lines
    .slice(headerIndex + 2)
    .filter((line) => line.startsWith('|') && !line.startsWith('| ---'))
    .map((line) => {
      const columns = line
        .split('|')
        .slice(1, -1)
        .map((part) => part.trim().replace(/^`([^`]+)`$/u, '$1'))

      return {
        plan: columns[planColumnIndex] ?? '',
        status: columns[statusColumnIndex] ?? '',
      }
    })
}

function writeHarnessFile(
  harnessRoot: string,
  relativePath: string,
  contents: string,
  executable = false,
) {
  const targetPath = path.join(harnessRoot, relativePath)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, contents, 'utf8')
  if (executable) {
    chmodSync(targetPath, 0o755)
  }
}

describe('monorepo release flow coverage audit', () => {
  it('exposes root-owned release scripts', () => {
    expect(rootPackageJson.name).toBe('murph-workspace')
    expect(rootPackageJson.scripts?.build).toContain('pnpm -r --sort')
    expect(rootPackageJson.scripts?.build).toContain('--workspace-concurrency=${MURPH_BUILD_WORKSPACE_CONCURRENCY:-4}')
    expect(rootPackageJson.scripts?.build).toContain("--filter './packages/**' build")
    expect(rootPackageJson.scripts?.['changelog:update']).toBe('bash scripts/update-changelog.sh')
    expect(rootPackageJson.scripts?.['release:notes']).toBe('bash scripts/generate-release-notes.sh')
    expect(rootPackageJson.scripts?.['release:check']).toBe('bash scripts/release-check.sh')
    expect(rootPackageJson.scripts?.['release:trust:github']).toBe(
      'node scripts/configure-trusted-publishing.mjs',
    )
    expect(rootPackageJson.scripts?.['release:patch']).toBe('bash scripts/release.sh patch')
    expect(rootPackageJson.scripts?.['release:minor']).toBe('bash scripts/release.sh minor')
    expect(rootPackageJson.scripts?.['release:major']).toBe('bash scripts/release.sh major')
    expect(rootPackageJson.scripts?.['verify:workspace-package-cycles']).toBe(
      'node scripts/check-workspace-package-cycles.mjs',
    )
    expect(rootPackageJson.scripts?.['zip:src']).toBe('bash scripts/package-audit-context.sh --zip')
    expect(rootPackageJson.scripts?.['zip:src:full']).toBe('bash scripts/package-audit-context-full.sh --zip')
  })

  it('exposes only the package-backed review-gpt runner', () => {
    const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const pnpmWorkspace = readFileSync(
      path.join(repoRoot, 'pnpm-workspace.yaml'),
      'utf8',
    )
    const reviewGptConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'review-gpt.config.sh'),
      'utf8',
    )
    const reviewGptDriver = readFileSync(
      path.join(
        repoRoot,
        'node_modules',
        '@cobuild',
        'review-gpt',
        'src',
        'prepare-chatgpt-draft.js',
      ),
      'utf8',
    )
    const reviewGptReadme = readFileSync(
      path.join(repoRoot, 'node_modules', '@cobuild', 'review-gpt', 'README.md'),
      'utf8',
    )
    const removedScripts = [
      'review:gpt:full',
      'review:gpt:protocol',
      'review:gpt:protocol:all',
      'review:gpt:diagnose',
      'review:gpt:delay',
      'review:gpt:schedule',
      'review:gpt:data',
      'research',
      'research:init',
      'research:materialize',
      'research:run',
      'chatgpt:thread:export',
      'chatgpt:thread:download',
      'chatgpt:thread:watch',
      'chatgpt:thread:wake',
    ]

    expect(rootPackageJson.scripts?.['review:gpt']).toBe(
      'cobuild-review-gpt --config scripts/review-gpt.config.sh',
    )
    for (const scriptName of removedScripts) {
      expect(rootPackageJson.scripts?.[scriptName]).toBeUndefined()
    }

    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-export.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-download.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-wake.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.test.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.test.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-cli.sh'))).toBe(false)
    expect(rootPackageJson.devDependencies?.['@cobuild/review-gpt']).toBe('^0.5.110')
    expect(
      pnpmWorkspace
        .match(/^minimumReleaseAgeExclude:\n((?:  - .+\n)+)/mu)?.[1]
        ?.split('\n')
        .filter((line) => line.includes('@cobuild/review-gpt')),
    ).toEqual(["  - '@cobuild/review-gpt@0.5.110'"])
    expect(
      pnpmWorkspace
        .match(/^patchedDependencies:\n((?:  .+\n)+)/mu)?.[1]
        ?.trim()
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(
      [
        "'@cobuild/repo-tools@0.1.15': patches/@cobuild__repo-tools@0.1.15.patch",
        'incur@0.4.5: patches/incur@0.4.5.patch',
      ],
    )
    expect(
      existsSync(path.join(repoRoot, 'patches', '@cobuild__review-gpt@0.5.103.patch')),
    ).toBe(false)
    expect(reviewGptDriver).toContain("const { createHash, randomUUID } = require('crypto');")
    expect(reviewGptDriver).toContain(
      "const targetOwnershipUrlPrefix = 'about:blank#review-gpt-owned-';",
    )
    expect(reviewGptDriver).toContain(
      "(entry) => entry.type === 'page' && entry.url === ownershipUrl",
    )
    expect(reviewGptDriver).toContain('const navigation = await cdp(\'Page.navigate\', { url: chatgptUrl });')
    expect(reviewGptDriver.indexOf('ws.send(payload);')).toBeLessThan(
      reviewGptDriver.indexOf('commandDeliveryStarted = true;'),
    )
    expect(reviewGptDriver).toContain(
      [
        '      return { ws, target };',
        '    } catch (error) {',
        '      try {',
        '        ws?.close();',
        '      } catch {}',
        '      try {',
        '        await closeBackgroundTarget(target?.id);',
        '      } catch (cleanupError) {',
        '        throw addTargetCleanupContext(cleanupError, error);',
        '      }',
        '      lastError = error;',
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain('while (Date.now() < cleanupDeadline)')
    expect(reviewGptDriver).toContain("'Target.closeTarget'")
    expect(reviewGptDriver).toContain('{ targetId: normalizedTargetId }')
    expect(reviewGptDriver).toContain('attemptDeadline')
    expect(reviewGptDriver).toContain('failure.reviewGptTargetId = targetId;')
    expect(reviewGptDriver.match(/void (?:targetClosed|closed)\.catch\(\(\) => \{\}\);/gu)).toHaveLength(3)
    expect(reviewGptDriver).toContain('const controller = new AbortController();')
    expect(reviewGptDriver).toContain(
      'const browserTransportTimeoutMs = Math.min(configuredDraftTimeoutMs, 15000);',
    )
    expect(reviewGptDriver).toContain(
      'const pageCommandTimeoutMs = Math.min(configuredDraftTimeoutMs, 30000);',
    )
    expect(reviewGptDriver).toContain(
      'const targetCleanupTimeoutMs = Math.min(browserTransportTimeoutMs, 5000);',
    )
    expect(reviewGptDriver).toContain("'Timed out opening page CDP socket'")
    expect(reviewGptDriver).toContain('`CDP socket command timed out: ${method}`')
    expect(reviewGptDriver).toContain('`Nested CDP socket command timed out: ${method}`')
    expect(reviewGptDriver).toContain(
      'const MIN_MARKED_CONCRETE_MODEL_RESPONSE_MS = 10 * 60 * 1000;',
    )
    const solTarget: ReviewGptModelPickerTarget = {
      desiredVersion: '5-6',
      wantsInstant: false,
      wantsPro: false,
      wantsSol: true,
      wantsThinking: false,
    }
    expect(
      reviewGptModelPickerModule.modelPickerOptionMatchesTarget(
        'GPT-5.6 Sol',
        '',
        solTarget,
      ),
    ).toBe(true)
    expect(
      reviewGptModelPickerModule.modelPickerSummarySelectionProof(
        {
          label: 'ModelGPT-5.6 Sol',
          opensSubmenu: true,
          unavailable: false,
          visible: true,
        },
        solTarget,
      ),
    ).toBe(true)
    expect(
      reviewGptModelPickerModule.modelPickerOptionCanTraverseTarget(
        'ModelGPT-5.5',
        '',
        solTarget,
        true,
      ),
    ).toBe(true)
    expect(
      reviewGptModelPickerModule.modelPickerOptionCanTraverseTarget(
        'EffortHigh',
        '',
        solTarget,
        true,
      ),
    ).toBe(false)
    for (const invalidLabel of [
      'GPT-5.5 Sol',
      'GPT-15.6 Sol',
      'GPT-5.60 Sol',
      'GPT-5.6 Sol Extended Pro',
    ]) {
      expect(
        reviewGptModelPickerModule.modelPickerOptionMatchesTarget(
          invalidLabel,
          '',
          solTarget,
        ),
      ).toBe(false)
    }
    expect(
      reviewGptModelPickerModule.modelPickerSummarySelectionProof(
        {
          label: 'ModelGPT-5.5GPT-5.6 Sol',
          opensSubmenu: true,
          unavailable: false,
          visible: true,
        },
        solTarget,
      ),
    ).toBe(false)
    expect(
      reviewGptModelPickerModule.modelPickerSummarySelectionProof(
        {
          label: 'Model',
          opensSubmenu: true,
          testId: 'model-switcher-pro-submenu',
          unavailable: false,
          visible: true,
        },
        solTarget,
      ),
    ).toBe(false)
    expect(reviewGptDriver).toContain(
      'const MODEL_CONFIRMATION_UNKNOWN_FALLBACK_MS = MIN_MARKED_CONCRETE_MODEL_RESPONSE_MS;',
    )
    expect(reviewGptDriver).toContain("status: 'response-too-fast'")
    expect(reviewGptDriver).toContain('markedResponseDurationFailure({')
    expect(reviewGptDriver).toContain('acceptsTimedUnknown')
    expect(reviewGptReadme).toContain(
      'require exactly one unfenced, unquoted `MODEL_CONFIRMATION` line',
    )
    expect(reviewGptReadme).toContain('the exact turn committed by this run')
    expect(reviewGptReadme).toContain('An ephemeral per-run nonce')
    expect(reviewGptReadme).toContain('after at least 10 minutes of observed generation')
    expect(reviewGptReadme).toContain(
      'A marked concrete-model response that completes in under 10 minutes fails closed as untrusted',
    )
    expect(reviewGptDriver).toContain('REVIEW_GPT_TURN_NONCE:')
    expect(reviewGptDriver).not.toContain("value.includes('MODEL_CONFIRMATION:')")
    expect(reviewGptDriver).toContain('precedingUserMessageSignature')
    expect(reviewGptDriver).toContain('sendResult.committedUserTurnSignature')
    expect(reviewGptDriver).toContain('schemaVersion: 1')
    expect(reviewGptDriver).toContain("createHash('sha256')")
    expect(reviewGptDriver).toContain('mode: 0o600')
    expect(reviewGptDriver).toContain("`${responseFilePath}.model-verification.json`")
    expect(reviewGptDriver).toContain(
      [
        'if (require.main === module) {',
        '  prepareRuntimeConfig();',
        '  mainWithRetry().catch((error) => {',
      ].join('\n'),
    )
    const completedArtifactWriteStart = reviewGptDriver.indexOf(
      'artifacts = writeCompletedResponseArtifacts(',
    )
    expect(completedArtifactWriteStart).toBeGreaterThan(-1)
    expect(completedArtifactWriteStart).toBeLessThan(
      reviewGptDriver.indexOf('REVIEW_GPT_MODEL_VERIFICATION ${JSON.stringify'),
    )
    expect(completedArtifactWriteStart).toBeLessThan(
      reviewGptDriver.indexOf('emitCapturedResponse(\n      completedResponseCapture.responseText'),
    )
    const timeoutPartialStart = reviewGptDriver.indexOf("status: 'timeout-partial'")
    expect(timeoutPartialStart).toBeGreaterThan(-1)
    expect(reviewGptDriver.slice(timeoutPartialStart, timeoutPartialStart + 300)).not.toContain(
      'modelVerification',
    )
    const responseDurationGuardStart = reviewGptDriver.indexOf(
      'const responseDurationFailure = markedResponseDurationFailure({',
    )
    const responseAttestationStart = reviewGptDriver.indexOf(
      'const modelAttestation = modelAttestationForSnapshot(',
      responseDurationGuardStart,
    )
    expect(responseDurationGuardStart).toBeGreaterThan(-1)
    expect(responseAttestationStart).toBeGreaterThan(responseDurationGuardStart)
    const tooFastBranchStart = reviewGptDriver.indexOf(
      "} else if (responseResult?.status === 'response-too-fast') {",
    )
    const tooFastBranchEnd = reviewGptDriver.indexOf('} else {', tooFastBranchStart)
    const tooFastBranch = reviewGptDriver.slice(tooFastBranchStart, tooFastBranchEnd)
    expect(tooFastBranchStart).toBeGreaterThan(-1)
    expect(tooFastBranchEnd).toBeGreaterThan(tooFastBranchStart)
    expect(tooFastBranch).toContain(
      'writeCapturedResponseFile(responseFile, responseResult.responseText);',
    )
    expect(tooFastBranch).toContain('throw new Error(responseResult.responseDurationFailure')
    expect(tooFastBranch).not.toContain('writeCompletedResponseArtifacts')
    expect(tooFastBranch).not.toContain('modelVerification')
    expect(reviewGptDriver).toContain('process.exit(1);')
    expect(reviewGptDriver).toContain(
      [
        '  });',
        "  const pageTargetId = String(target?.id || '');",
        '  let ownedTargetId = pageTargetId;',
        '  let operationError = null;',
        '  let completedResponseCapture = null;',
        '  let releasePageFocusEmulation = async () => {};',
        '  try {',
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain('  releasePageFocusEmulation = async () => {')
    expect(reviewGptDriver).toContain(
      [
        '  let focusReleaseError = null;',
        '  try {',
        '    await releasePageFocusEmulation();',
        '  } catch (error) {',
        '    focusReleaseError = error;',
        '  }',
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain(
      [
        '  if (!shouldSend) {',
        '    if (shouldAttachFiles) {',
        "      cleanupConfirmedDraftAttachments('the upload');",
        '    }',
        "    ownedTargetId = '';",
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain(
      [
        '      if (!shouldWaitForResponse) {',
        "        ownedTargetId = '';",
        '      }',
        '    } else {',
        '      throw new Error(`Auto-send failed: ${JSON.stringify(sendResult?.lastAttempt || sendResult || { status: \'unknown\' })}`);',
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain(
      [
        '  let cleanupError = null;',
        '  if (ownedTargetId) {',
        '    try {',
        '      await closeBackgroundTarget(ownedTargetId);',
        '    } catch (error) {',
        '      cleanupError = addTargetCleanupContext(error, operationError);',
        '    }',
        '  }',
        '  try {',
        '    ws.close();',
        '  } catch {}',
      ].join('\n'),
    )
    expect(reviewGptDriver).toContain('if (completedResponseCapture && !operationError)')
    expect(reviewGptDriver).toContain(
      'Completed assistant response preserved despite unconfirmed cleanup for browser target',
    )
    expect(reviewGptDriver).toContain('if (cleanupError) throw cleanupError;')
    expect(reviewGptDriver).toContain('if (operationError) throw operationError;')
    expect(reviewGptDriver).toContain(
      [
        'error?.reviewGptTargetCleanupFailure ||',
        '        error?.reviewGptTargetOwnershipUncertain ||',
        '        !isRetryableSocketError(error)',
      ].join('\n'),
    )
    expect(reviewGptDriver).not.toContain('targetOwnedByRun')
    expect(reviewGptDriver).not.toContain('if (shouldWaitForResponse && pageTargetId)')
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-browser-profile.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.config.sh'))).toBe(true)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-pr-head-preflight.sh'))).toBe(true)
    expect(reviewGptConfig).toContain('repo_context_url=""')
    expect(reviewGptConfig).toContain('attach_artifacts=1')
    expect(reviewGptConfig).toContain('app_connector="current"')
    expect(reviewGptConfig).toContain('model="gpt-5.6-sol"')
    expect(reviewGptConfig).toContain('thinking="current"')
    expect(reviewGptConfig).toContain(
      'managed_browser_background_mode="${managed_browser_background_mode:-balanced}"',
    )
    expect(reviewGptConfig).toContain('codebase.zip')
    expect(reviewGptConfig).toContain('package_script="scripts/package-audit-context-full.sh"')
    expect(reviewGptConfig).not.toContain('snapshot_attachment_name=')
    expect(reviewGptConfig).not.toContain('repomix_attachment_format=')
    expect(reviewGptConfig).not.toContain('repomix_ignore_patterns=')
    const prDeepReviewPrompt = readFileSync(
      path.join(repoRoot, 'scripts', 'chatgpt-review-presets', 'pr-deep-review.md'),
      'utf8',
    )
    expect(prDeepReviewPrompt).toContain(
      'Use `codebase.zip` as the sole repository-content source.',
    )
    expect(prDeepReviewPrompt).toMatch(/Do not review a\s+diff hunk in isolation\./u)
    expect(prDeepReviewPrompt).toContain(
      'Do not use app connectors, memory, pasted repository context',
    )
    expect(prDeepReviewPrompt).toContain('`review-gpt-pr-context/pr-body.md`')
    expect(prDeepReviewPrompt).toContain('`review-gpt-pr-context/pr.diff`')
    expect(prDeepReviewPrompt).toContain('`review-gpt-pr-context/changed-files.txt`')
    expect(prDeepReviewPrompt).toContain('`review-gpt-pr-context/review-round.json`')
    expect(prDeepReviewPrompt).toContain(
      '`review-gpt-pr-context/since-first-reviewed-head.diff`',
    )
    expect(prDeepReviewPrompt).toContain(
      '`review-gpt-pr-context/since-previous-reviewed-head.diff`',
    )
    expect(prDeepReviewPrompt).toContain('If any required artifact is missing, unreadable, stale,')
    expect(prDeepReviewPrompt).not.toContain('repo.snapshot.zip')
    expect(prDeepReviewPrompt).not.toContain('repo.repomix.zip')
    expect(prDeepReviewPrompt.toLowerCase()).not.toContain('repomix')
    expect(prDeepReviewPrompt).not.toContain('app_connector="github"')
    expect(prDeepReviewPrompt).not.toContain('GitHub connector context')
    expect(prDeepReviewPrompt).not.toContain('connected repository, PR diff, or touched files')
    expect(prDeepReviewPrompt).toContain('Start with one line identifying the target')
    expect(prDeepReviewPrompt).toContain('`Checked: PR #123 @ abc1234`')
    expect(prDeepReviewPrompt).toContain('Our utmost priority is clean, simple, long-term maintainable')
    expect(prDeepReviewPrompt).toContain('Default to deletion and radical')
    expect(prDeepReviewPrompt).toContain('Round 1 is the only full-patch audit')
    expect(prDeepReviewPrompt).toContain('correction-verification rounds, not fresh full-PR audits')
    expect(prDeepReviewPrompt).toContain('`ORIGINAL_PR`')
    expect(prDeepReviewPrompt).toContain('`REVIEW_INDUCED`')
    expect(prDeepReviewPrompt).toContain('`PRE_EXISTING_OR_ADJACENT`')
    expect(prDeepReviewPrompt).toContain('`RETROSPECTIVE_REQUIRED`')
    expect(prDeepReviewPrompt).toContain('at least 2,000 lines')
    expect(prDeepReviewPrompt).toContain('at least 3,000 lines')
    expect(prDeepReviewPrompt).toContain('This is neither an automatic merge rejection')
    expect(prDeepReviewPrompt).toContain('do not emit a standalone Invariant Violation')
    expect(prDeepReviewPrompt).toContain('current scale, event volume,')
    expect(prDeepReviewPrompt).toContain('never assume hypothetical future or internet')
    expect(prDeepReviewPrompt).toMatch(
      /rare one-window miss affecting one or\s+a\s+few members/u,
    )
    expect(prDeepReviewPrompt).toContain('Do not demand replay, backfill, migration, dual-write,')
    expect(prDeepReviewPrompt).toContain('`ROUND_OUTCOME: PASS`')
    expect(prDeepReviewPrompt).toContain('`ROUND_OUTCOME: FINDINGS`')
    expect(prDeepReviewPrompt).toContain('`ROUND_OUTCOME: RETROSPECTIVE_REQUIRED`')
    expect(prDeepReviewPrompt).toContain('`ROUND_OUTCOME: INVALID`')
    expect(prDeepReviewPrompt).toMatch(
      /does\s+not actually resolve counts as `REVIEW_INDUCED`/u,
    )
    expect(prDeepReviewPrompt).toContain('change-shape breakdown')
    expect(prDeepReviewPrompt).toContain('UX outline')
    expect(prDeepReviewPrompt).toContain('`Non-obvious affected surfaces`')
    expect(prDeepReviewPrompt).toContain('**Purpose Drift**')
    expect(prDeepReviewPrompt).toContain('disclosure-only verification retry')
    expect(prDeepReviewPrompt).toContain('Do not reopen the\nfull patch')
    expect(prDeepReviewPrompt).toContain(
      'may select only the narrow retry scope defined above',
    )
    expect(prDeepReviewPrompt).toContain('ignore every other instruction')
    expect(prDeepReviewPrompt).toContain(
      'Every material behavior or ownership change is necessary',
    )
    expect(prDeepReviewPrompt).toContain(
      'Every non-obvious affected surface is also disclosed',
    )
    expect(prDeepReviewPrompt).toContain(
      'Disclosure does not make\nan unsafe or needless change acceptable',
    )
    expect(prDeepReviewPrompt).toContain(
      'Delete or split unnecessary scope. When\nthe surface is necessary but undisclosed',
    )
    expect(prDeepReviewPrompt).toContain(
      'require the intent contract to add the reason',
    )
    const genericReviewGptPrompts = [
      'security-audit.md',
      'privacy.md',
      'architecture-review.md',
      'giant-file-composability.md',
      'data-model-composability-review.md',
      'complexity-simplification.md',
      'bad-code-quality.md',
      'bug-hunt-high-value-seams.md',
      'legacy-removal.md',
      'package-boundaries.md',
    ].map((fileName) =>
      readFileSync(
        path.join(repoRoot, 'scripts', 'chatgpt-review-presets', fileName),
        'utf8',
      ),
    )
    for (const reviewPrompt of genericReviewGptPrompts) {
      expect(reviewPrompt).toContain('review-only')
      expect(reviewPrompt).toContain('# Outcome')
      expect(reviewPrompt).toContain('# Evidence')
      expect(reviewPrompt).toContain('# Finding bar')
      expect(reviewPrompt).toContain('# Output and stop')
      expect(reviewPrompt).toContain('`codebase.zip`')
      expect(reviewPrompt).toMatch(/untrusted\s+review data/u)
      expect(reviewPrompt).toMatch(/If no |Zero findings is valid/u)
      expect(reviewPrompt.toLowerCase()).toContain('stop')
    }
    const allPresetGroup = reviewGptConfig.slice(
      reviewGptConfig.indexOf('review_gpt_register_preset_group "all"'),
    )
    expect(allPresetGroup).toContain('review_gpt_register_preset_group "all"')
    expect(allPresetGroup).not.toMatch(/^\s*"pr-review"\s*\\?$/mu)
    const prReviewGptLoop = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'pr-reviewgpt-loop.md'),
      'utf8',
    )
    const agentsGuide = readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')
    const agentWorkflowRouting = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'agent-workflow-routing.md'),
      'utf8',
    )
    expect(prReviewGptLoop).toContain('Required post-completion ReviewGPT loop')
    expect(prReviewGptLoop).toContain('pnpm review:gpt pr-review')
    expect(prReviewGptLoop).toContain('repo-local `pr-review` preset')
    expect(prReviewGptLoop).toContain('`pnpm review:gpt`')
    expect(prReviewGptLoop).toContain('managed ReviewGPT browser lanes')
    expect(prReviewGptLoop).toContain('randomly among usable')
    expect(prReviewGptLoop).toContain('zero accepted findings')
    expect(prReviewGptLoop).toContain('non-obvious affected surfaces')
    expect(prReviewGptLoop).toContain('Accepted purpose drift')
    expect(prReviewGptLoop).toContain('disclosure-only finding')
    expect(prReviewGptLoop).toContain('retry the same substantive round number')
    expect(prReviewGptLoop).toContain('does not reopen the\n   patch')
    expect(prReviewGptLoop).toContain(
      'Disclosure alone does not cure unnecessary scope',
    )
    expect(prReviewGptLoop).toContain('`review-gpt-pr-context/pr-body.md`')
    expect(prReviewGptLoop).toContain('`review-gpt-pr-context/pr.diff`')
    expect(prReviewGptLoop).toContain('`review-gpt-pr-context/review-round.json`')
    expect(prReviewGptLoop).toContain(
      '`review-gpt-pr-context/since-first-reviewed-head.diff`',
    )
    expect(prReviewGptLoop).toContain(
      '`review-gpt-pr-context/since-previous-reviewed-head.diff`',
    )
    expect(prReviewGptLoop).toContain('REVIEW_GPT_ROUND_NUMBER')
    expect(prReviewGptLoop).toContain('REVIEW_GPT_FIRST_REVIEWED_HEAD')
    expect(prReviewGptLoop).toContain('REVIEW_GPT_PREVIOUS_REVIEWED_HEAD')
    expect(prReviewGptLoop).toContain('Round 1 is the only full-patch')
    expect(prReviewGptLoop).toMatch(/Keep that line and baseline\s+immutable/u)
    expect(prReviewGptLoop).toContain('ReviewGPT first-reviewed head: <full-sha>')
    expect(prReviewGptLoop).toContain('`ROUND_OUTCOME: INVALID`')
    expect(prReviewGptLoop).toContain(
      'A marked concrete-model response that completes in under 10 minutes',
    )
    expect(prReviewGptLoop).toContain('too-fast-response retries never advance')
    expect(prReviewGptLoop).toContain('review remediation has added at least 500')
    expect(prReviewGptLoop).toContain('source additions by at least 25 percent')
    expect(prReviewGptLoop).toContain('The retrospective is')
    expect(prReviewGptLoop).toContain('not an automatic merge rejection')
    expect(prReviewGptLoop).toContain('There is no automatic sixth substantive round')
    expect(prReviewGptLoop).not.toContain('likely needs structural rework')
    expect(prReviewGptLoop).toContain('current member/event volume')
    expect(prReviewGptLoop).toContain('First try deleting the rollout seam')
    expect(prReviewGptLoop).toContain('It does **not** run the local Codex')
    expect(prReviewGptLoop).toContain('scripts/review-gpt-pr-head-preflight.sh')
    expect(prReviewGptLoop).toContain('REVIEW_COMPLETE')
    expect(prReviewGptLoop).toContain('Hard cap: 5 rounds per PR')
    expect(prReviewGptLoop).not.toContain('Hard cap: 15 rounds per PR')
    expect(prReviewGptLoop).toContain('Prompt-primary PRs use the local')
    expect(agentsGuide).toContain('Prompt-primary PRs do not run ReviewGPT')
    expect(agentWorkflowRouting).toContain(
      "For prompt-primary changes, run the completion workflow's `prompt-review` pass",
    )
    expect(agentsGuide).toContain('isolated regression test or explanatory doc')
    expect(agentsGuide).toContain('later rounds verify only remediation deltas')
    expect(agentWorkflowRouting).toContain('proportional low-risk exemptions')
    expect(agentWorkflowRouting).toContain('scope-anomaly signal')
    expect(prReviewGptLoop).toContain('does **not** run the local Codex')
    expect(prReviewGptLoop).toContain('sole cross-cutting audit')
    expect(prReviewGptLoop).toContain('Never run both for the same completed')
    expect(prReviewGptLoop).toMatch(
      /specialist `prompt-review`,\s+`frontend-review`, or write-capable `coverage-write`/u,
    )
    const completionWorkflow = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'completion-workflow.md'),
      'utf8',
    )
    expect(completionWorkflow).toContain('not complete until the PR branch has no merge conflicts')
    expect(completionWorkflow).toContain('fetch the latest `main`')
    expect(completionWorkflow).toContain('still runs every specialist pass triggered')
    expect(completionWorkflow).toContain(
      'local `deep-review` or PR-lane ReviewGPT, never both',
    )
    expect(completionWorkflow).not.toContain(
      'Run local `deep-review` too only when the user explicitly asks',
    )
    expect(completionWorkflow).not.toContain(
      'may skip the individual required local audit subagent passes',
    )
    expect(completionWorkflow).toContain('gpt-5.6-sol')
    expect(completionWorkflow).toContain('prompt-guidance-gpt-5p6.md')
    expect(completionWorkflow).not.toContain('prompt-guidance?model=gpt-5.6-terra')
    expect(completionWorkflow).toContain('Change-shape breakdown')
    expect(completionWorkflow).toContain('scope-anomaly signal')
    expect(completionWorkflow).toContain('not a quality target or an automatic merge')
    expect(completionWorkflow).toContain('evidenced current member/event volume')
    expect(completionWorkflow).toContain('`ROUND_OUTCOME: PASS`')
    expect(completionWorkflow).toContain('User experience (when applicable)')
    expect(completionWorkflow).toContain('Non-obvious affected surfaces')
    expect(completionWorkflow).toContain('If none exist,')
    expect(completionWorkflow).toContain(
      'Prompt-primary PRs use `prompt-review` and do not run ReviewGPT',
    )

    const completionAuditPrompts = [
      'prompt-review.md',
      'frontend-review.md',
      'coverage-write.md',
    ].map((fileName) =>
      readFileSync(
        path.join(repoRoot, 'agent-docs', 'prompts', fileName),
        'utf8',
      ),
    )
    for (const auditPrompt of completionAuditPrompts) {
      expect(auditPrompt).not.toContain('Assume there is at least one')
      expect(auditPrompt).toContain('Stop rule:')
    }
    expect(completionAuditPrompts[0]).toContain('prompt-guidance-gpt-5p6.md')
    expect(completionAuditPrompts[0]).toContain('latest-model.md')
    expect(completionAuditPrompts[0]).toContain('upgrading-to-gpt-5p6-sol.md')
    expect(completionAuditPrompts[1]).toContain('render and inspect')
    expect(completionAuditPrompts[1]).toContain('desktop and mobile viewports')
    expect(completionAuditPrompts[2]).toContain('completion-workflow.md` § Audit Worker Rules')
    expect(
      existsSync(
        path.join(
          repoRoot,
          'agent-docs',
          'prompts',
          'security-privacy-review.md',
        ),
      ),
    ).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-full.config.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.data.config.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'research-run.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'research-init.mjs'))).toBe(false)
  })

  it('keeps delayed targets alive until discovery and closes only failed discoveries', async () => {
    const delayedTarget = loadReviewGptOpenTargetHarness(2)

    await expect(
      delayedTarget.openNewTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ id: 'target-1' })
    expect(delayedTarget.getListPollCount()).toBe(2)
    expect(delayedTarget.commands).toEqual([
      {
        listPollCount: 0,
        method: 'Target.createTarget',
        params: {
          background: true,
          url: expect.stringMatching(/^about:blank#review-gpt-owned-[0-9a-f-]+$/u),
        },
      },
    ])

    const failedTarget = loadReviewGptOpenTargetHarness(Number.POSITIVE_INFINITY)
    await expect(
      failedTarget.openNewTarget('https://chatgpt.com/'),
    ).rejects.toThrow('did not expose a debuggable page')
    expect(failedTarget.commands).toEqual([
      {
        listPollCount: 0,
        method: 'Target.createTarget',
        params: {
          background: true,
          url: expect.stringMatching(/^about:blank#review-gpt-owned-[0-9a-f-]+$/u),
        },
      },
      {
        listPollCount: 30,
        method: 'Target.closeTarget',
        params: { targetId: 'target-1' },
      },
    ])

    const recoveredPollTarget = loadReviewGptOpenTargetHarness(2, 1)
    await expect(
      recoveredPollTarget.openNewTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ id: 'target-1' })
    expect(recoveredPollTarget.getListPollCount()).toBe(2)
    expect(recoveredPollTarget.commands).toEqual([
      {
        listPollCount: 0,
        method: 'Target.createTarget',
        params: {
          background: true,
          url: expect.stringMatching(/^about:blank#review-gpt-owned-[0-9a-f-]+$/u),
        },
      },
    ])

    const absentAfterAmbiguousClose = loadReviewGptOpenTargetHarness(
      Number.POSITIVE_INFINITY,
      1,
      { closeCommandReturnsFalse: true },
    )
    await expect(
      absentAfterAmbiguousClose.openNewTarget('https://chatgpt.com/'),
    ).rejects.toThrow('did not expose a debuggable page')
    expect(
      absentAfterAmbiguousClose.commands.filter(
        (command) => command.method === 'Target.closeTarget',
      ),
    ).toEqual([
      {
        listPollCount: 30,
        method: 'Target.closeTarget',
        params: { targetId: 'target-1' },
      },
    ])

    for (const options of [
      {
        targetPresentAfterClose: true,
      },
      {
        closeCommandReturnsFalse: true,
        targetPresentAfterClose: true,
      },
      {
        closeCommandReturnsFalse: true,
        failListAfterClose: true,
      },
      {
        hangListAfterClose: true,
      },
    ]) {
      const unconfirmedDiscoveryCleanup = loadReviewGptOpenTargetHarness(
        Number.POSITIVE_INFINITY,
        1,
        options,
      )
      await expect(
        unconfirmedDiscoveryCleanup.openNewTarget('https://chatgpt.com/'),
      ).rejects.toMatchObject({
        reviewGptStage: 'target-cleanup',
        reviewGptTargetCleanupFailure: true,
        reviewGptTargetId: 'target-1',
      })
      expect(
        unconfirmedDiscoveryCleanup.commands.filter(
          (command) => command.method === 'Target.createTarget',
        ),
      ).toHaveLength(1)
    }

    const guardedDiscoveryCleanup = loadReviewGptOpenTargetHarness(
      Number.POSITIVE_INFINITY,
      1,
      { targetPresentAfterClose: true },
    )
    await expect(
      guardedDiscoveryCleanup.connectTarget('https://chatgpt.com/'),
    ).rejects.toMatchObject({
      reviewGptTargetCleanupFailure: true,
      reviewGptTargetId: 'target-1',
    })
    expect(
      guardedDiscoveryCleanup.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(1)

    for (const options of [
      { closeBrowserSocketAfterCreate: true },
      { createCommandOmitsTargetId: true },
      { hangBrowserSocketAfterCreate: true },
    ]) {
      const recoveredCreate = loadReviewGptOpenTargetHarness(1, undefined, {
        ...options,
        failPageCommandAtMethod: 'Runtime.enable',
      })
      await expect(recoveredCreate.main()).rejects.toThrow('Injected CDP socket error')
      expect(
        recoveredCreate.commands.filter(
          (command) => command.method === 'Target.createTarget',
        ),
      ).toHaveLength(1)
      expect(recoveredCreate.getLatestTargetUrl()).toBe('https://chatgpt.com/')
      expect(
        recoveredCreate.commands
          .filter((command) => command.method === 'Target.closeTarget')
          .map((command) => command.params.targetId),
      ).toEqual(['target-1'])
    }

    const synchronousCreateSendFailure = loadReviewGptOpenTargetHarness(1, undefined, {
      failPageCommandAtMethod: 'Runtime.enable',
      throwCreateSendSynchronouslyOnce: true,
    })
    await expect(synchronousCreateSendFailure.main()).rejects.toThrow(
      'Injected CDP socket error',
    )
    expect(synchronousCreateSendFailure.getCreateSendAttemptCount()).toBe(2)
    expect(
      synchronousCreateSendFailure.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(1)

    const failedBrowserSocket = loadReviewGptOpenTargetHarness(1, undefined, {
      failBrowserSocketOpen: true,
    })
    await expect(
      failedBrowserSocket.openNewTarget('https://chatgpt.com/'),
    ).rejects.toThrow('Injected browser WebSocket error')

    const closedBrowserSocket = loadReviewGptOpenTargetHarness(1, undefined, {
      closeBrowserSocketBeforeOpen: true,
    })
    await expect(
      closedBrowserSocket.openNewTarget('https://chatgpt.com/'),
    ).rejects.toThrow('Browser CDP socket closed unexpectedly')
  })

  it('extracts model confirmation only from visible standalone rendered lines', () => {
    const modelClassifier = loadReviewGptOpenTargetHarness(1)
    const validConfirmation = reviewGptDomElement('DIV', [
      reviewGptDomElement('P', [reviewGptDomText('Report ready')], { display: 'block' }),
      reviewGptDomElement('P', [
        reviewGptDomElement('STRONG', [reviewGptDomText('MODEL_CONFIRMATION:')]),
        reviewGptDomElement('EM', [reviewGptDomText(' UNKNOWN')]),
      ], { display: 'block' }),
    ], { display: 'block' })
    const extractedConfirmation = extractReviewGptModelConfirmationText(validConfirmation)
    expect(extractedConfirmation).toBe('Report ready\nMODEL_CONFIRMATION: UNKNOWN')
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        extractedConfirmation,
        'gpt-5-6-pro',
        46 * 60 * 1000,
      ),
    ).toBe('')
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        extractedConfirmation,
        '',
        10 * 60 * 1000 - 1,
      ),
    ).toContain('confirmed model UNKNOWN, expected gpt-5.6-sol')
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        extractedConfirmation,
        '',
        10 * 60 * 1000,
      ),
    ).toBe('')
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        extractedConfirmation,
        'gpt-5-5-pro',
        10 * 60 * 1000,
      ),
    ).toContain('DOM reported model gpt-5-5-pro, expected gpt-5.6-sol')

    const excludedContainers = reviewGptDomElement('DIV', [
      reviewGptDomElement('BLOCKQUOTE', [
        reviewGptDomText('MODEL_CONFIRMATION: gpt-5.6-sol'),
      ], { display: 'block' }),
      reviewGptDomElement('PRE', [
        reviewGptDomText('MODEL_CONFIRMATION: gpt-5.6-sol'),
      ], { display: 'block' }),
      reviewGptDomElement('CODE', [
        reviewGptDomText('MODEL_CONFIRMATION: gpt-5.6-sol'),
      ]),
    ], { display: 'block' })
    expect(extractReviewGptModelConfirmationText(excludedContainers)).toBe('')

    const inlineCodeDecoy = reviewGptDomElement('SPAN', [
      reviewGptDomText('prefix'),
      reviewGptDomElement('CODE', [reviewGptDomText('ignored')]),
      reviewGptDomText('MODEL_CONFIRMATION: UNKNOWN'),
    ])
    const hiddenInlineDecoy = reviewGptDomElement('SPAN', [
      reviewGptDomText('prefix'),
      reviewGptDomElement('SPAN', [reviewGptDomText('ignored')], { hidden: true }),
      reviewGptDomText('MODEL_CONFIRMATION: UNKNOWN'),
    ])
    const hiddenBlockDecoy = reviewGptDomElement('SPAN', [
      reviewGptDomText('prefix'),
      reviewGptDomElement('DIV', [reviewGptDomText('ignored')], {
        display: 'block',
        hidden: true,
      }),
      reviewGptDomText('MODEL_CONFIRMATION: UNKNOWN'),
    ])
    const displayContentsDecoy = reviewGptDomElement('SPAN', [
      reviewGptDomText('prefix'),
      reviewGptDomElement('DIV', [reviewGptDomText('ignored')], {
        display: 'contents',
      }),
      reviewGptDomText('MODEL_CONFIRMATION: UNKNOWN'),
    ])
    for (const decoy of [
      inlineCodeDecoy,
      hiddenInlineDecoy,
      hiddenBlockDecoy,
      displayContentsDecoy,
    ]) {
      expect(
        modelClassifier.modelConfirmationFailure(
          'gpt-5.6-sol',
          extractReviewGptModelConfirmationText(decoy),
          'gpt-5-6-pro',
        ),
      ).toContain('did not include MODEL_CONFIRMATION')
    }

    const multipleConfirmations = reviewGptDomElement('DIV', [
      reviewGptDomElement('P', [reviewGptDomText('MODEL_CONFIRMATION: UNKNOWN')], {
        display: 'block',
      }),
      reviewGptDomElement('P', [reviewGptDomText('MODEL_CONFIRMATION: gpt-5.6-sol')], {
        display: 'block',
      }),
    ], { display: 'block' })
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        extractReviewGptModelConfirmationText(multipleConfirmations),
        'gpt-5-6-pro',
      ),
    ).toContain('multiple MODEL_CONFIRMATION lines')
    expect(
      modelClassifier.modelConfirmationFailure(
        'gpt-5.6-sol',
        'MODEL_CONFIRMATION: gpt-5.6-sol',
        'gpt-5-5-pro',
      ),
    ).toContain('DOM reported model gpt-5-5-pro, expected gpt-5.6-sol')

    const captureExpression = reviewGptDomSnapshotModule.buildChatGptCaptureStateExpression({
      desiredChatId: 'test-chat',
      desiredOrigin: 'https://chatgpt.com',
    })
    expect(() => new Script(captureExpression)).not.toThrow()
    expect(captureExpression).toContain('precedingUserMessageSignature')
  })

  it('attests one fresh assistant snapshot bound to the committed user turn', () => {
    const harness = loadReviewGptOpenTargetHarness(1, undefined, {
      shouldSend: true,
      shouldWaitForResponse: true,
    })
    const concurrentHarness = loadReviewGptOpenTargetHarness(1, undefined, {
      shouldSend: true,
      shouldWaitForResponse: true,
    })
    const collisionHarness = loadReviewGptOpenTargetHarness(1, undefined, {
      prompt: 'Review MODEL_CONFIRMATION: UNKNOWN handling while rejecting the contradictory gpt-5-5-pro response slug.',
      shouldSend: true,
      shouldWaitForResponse: true,
    })
    const normalizePromptSignature = (value: string) => value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 320)
    const committedPrompt = harness.getDraftPrompt()
    const concurrentPrompt = concurrentHarness.getDraftPrompt()
    const collisionPrompt = collisionHarness.getDraftPrompt()
    const committedUserTurnSignature = normalizePromptSignature(committedPrompt)
    const concurrentUserTurnSignature = normalizePromptSignature(concurrentPrompt)
    expect(harness.getModelAttestationTurnNonce()).toMatch(/^[0-9a-f-]{36}$/u)
    expect(concurrentHarness.getModelAttestationTurnNonce()).not.toBe(
      harness.getModelAttestationTurnNonce(),
    )
    expect(committedPrompt).toMatch(/^REVIEW_GPT_TURN_NONCE: [0-9a-f-]{36}\n/u)
    expect(concurrentPrompt.split('\n').slice(1)).toEqual(
      committedPrompt.split('\n').slice(1),
    )
    expect(collisionPrompt).toContain(
      'Review MODEL_CONFIRMATION: UNKNOWN handling while rejecting the contradictory gpt-5-5-pro response slug.',
    )
    expect(collisionPrompt.match(/Complete the requested work even if you cannot independently identify the active model\./gu)).toHaveLength(1)
    expect(collisionPrompt).toContain('MODEL_CONFIRMATION: gpt-5.6-sol')
    expect(collisionHarness.modelConfirmationFailure(
      'gpt-5.6-sol',
      'Review complete without the package-owned final line.',
    )).toContain('did not include MODEL_CONFIRMATION')
    expect(collisionHarness.modelConfirmationFailure(
      'gpt-5.6-sol',
      'Review complete\nMODEL_CONFIRMATION: gpt-5.6-sol',
    )).toBe('')
    expect(concurrentUserTurnSignature).not.toBe(committedUserTurnSignature)
    const responseText = 'Report\r\nDone\u00a0'
    const exactResponseBytes = 'Report\nDone\n'
    const validSnapshot: ReviewGptAssistantSnapshot = {
      afterLastUserMessage: false,
      modelConfirmationText: 'MODEL_CONFIRMATION: UNKNOWN',
      modelSlug: 'gpt-5-6-pro',
      precedingUserMessageSignature: committedUserTurnSignature,
      signature: 'fresh-response',
      text: responseText,
    }
    const concurrentSnapshot: ReviewGptAssistantSnapshot = {
      afterLastUserMessage: true,
      modelConfirmationText: 'MODEL_CONFIRMATION: UNKNOWN',
      modelSlug: 'gpt-5-6-pro',
      precedingUserMessageSignature: concurrentUserTurnSignature,
      signature: 'concurrent-response',
      text: 'Concurrent response',
    }

    expect(
      harness.selectAssistantResponseCandidate(
        [validSnapshot, concurrentSnapshot],
        [],
        true,
        committedUserTurnSignature,
      ).snapshot,
    ).toMatchObject({ signature: 'fresh-response' })
    expect(
      harness.selectAssistantResponseCandidate(
        [concurrentSnapshot],
        [],
        true,
        committedUserTurnSignature,
      ).snapshot,
    ).toBeNull()
    expect(
      harness.selectAssistantResponseCandidate(
        [validSnapshot],
        ['fresh-response'],
        true,
        committedUserTurnSignature,
      ).snapshot,
    ).toBeNull()

    const attestation = harness.modelAttestationForSnapshot(
      'gpt-5.6-sol',
      validSnapshot,
      true,
      committedUserTurnSignature,
    )
    expect(attestation).toEqual({
      evidence: {
        schemaVersion: 1,
        requestedModel: 'gpt-5.6-sol',
        responseModelSlug: 'gpt-5-6-pro',
        responseSha256: createHash('sha256').update(exactResponseBytes).digest('hex'),
      },
      failure: '',
    })
    expect(
      harness.modelAttestationForSnapshot(
        'gpt-5.6-sol',
        validSnapshot,
        false,
        committedUserTurnSignature,
      ),
    ).toEqual({ evidence: null, failure: '' })

    const elapsedFallbackSnapshot = {
      ...validSnapshot,
      modelSlug: '',
    }
    expect(
      harness.modelAttestationForSnapshot(
        'gpt-5.6-sol',
        elapsedFallbackSnapshot,
        true,
        committedUserTurnSignature,
        10 * 60 * 1000 - 1,
      ),
    ).toMatchObject({ evidence: null, failure: expect.stringContaining('confirmed model UNKNOWN') })
    expect(
      harness.modelAttestationForSnapshot(
        'gpt-5.6-sol',
        elapsedFallbackSnapshot,
        true,
        committedUserTurnSignature,
        10 * 60 * 1000,
      ),
    ).toEqual({ evidence: null, failure: '' })

    for (const invalidSnapshot of [
      concurrentSnapshot,
      { ...validSnapshot, modelConfirmationText: '' },
      { ...validSnapshot, modelSlug: 'gpt-5-5-pro' },
      {
        ...validSnapshot,
        modelConfirmationText: 'MODEL_CONFIRMATION: gpt-5.6-sol',
        modelSlug: 'gpt-5-5-pro',
      },
    ]) {
      const invalidAttestation = harness.modelAttestationForSnapshot(
        'gpt-5.6-sol',
        invalidSnapshot,
        true,
        committedUserTurnSignature,
      )
      expect(invalidAttestation.failure).not.toBe('')
      expect(invalidAttestation.evidence).toBeNull()
    }

    const prePromptSnapshot = {
      ...validSnapshot,
      afterLastUserMessage: false,
      precedingUserMessageSignature: undefined,
    }
    expect(
      harness.modelAttestationForSnapshot('gpt-5.6-sol', prePromptSnapshot, true),
    ).toMatchObject({ evidence: null })
  })

  it('fails closed marked concrete-model responses below ten minutes', () => {
    const harness = loadReviewGptOpenTargetHarness(1)

    expect(
      harness.markedResponseDurationFailure('gpt-5.6-sol', 'ROUND_OUTCOME:', 37_000),
    ).toContain('after 37s, below the 10m minimum')
    expect(
      harness.markedResponseDurationFailure(
        'gpt-5.6-sol',
        'ROUND_OUTCOME:',
        10 * 60 * 1000 - 1,
      ),
    ).toContain('The response is untrusted and was not attested.')
    expect(
      harness.markedResponseDurationFailure(
        'gpt-5.6-sol',
        'ROUND_OUTCOME:',
        10 * 60 * 1000,
      ),
    ).toBe('')
    expect(
      harness.markedResponseDurationFailure('gpt-5.6-sol', '', 37_000),
    ).toBe('')
    expect(
      harness.markedResponseDurationFailure('current', 'ROUND_OUTCOME:', 37_000),
    ).toBe('')
  })

  it('writes private model evidence atomically and invalidates it before validation', () => {
    const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'review-gpt-attestation-'))
    try {
      const responseFile = path.join(outputDirectory, 'response.md')
      const evidenceFile = `${responseFile}.model-verification.json`
      const unrelatedFile = path.join(outputDirectory, 'unrelated.txt')
      const responseText = 'Report\r\nDone\u00a0'
      const exactResponseBytes = 'Report\nDone\n'
      const evidence: ModelVerificationEvidence = {
        schemaVersion: 1,
        requestedModel: 'gpt-5.6-sol',
        responseModelSlug: 'gpt-5-6-pro',
        responseSha256: createHash('sha256').update(exactResponseBytes).digest('hex'),
      }
      const harness = loadReviewGptOpenTargetHarness(1)

      writeFileSync(unrelatedFile, 'keep', 'utf8')
      expect(
        harness.writeCompletedResponseArtifacts(responseFile, responseText, evidence),
      ).toEqual({
        evidencePath: evidenceFile,
        evidenceWarning: '',
        responseFilePath: responseFile,
      })
      expect(readFileSync(responseFile, 'utf8')).toBe(exactResponseBytes)
      expect(JSON.parse(readFileSync(evidenceFile, 'utf8'))).toEqual(evidence)
      expect(statSync(responseFile).mode & 0o777).toBe(0o600)
      expect(statSync(evidenceFile).mode & 0o777).toBe(0o600)

      expect(harness.removeModelVerificationEvidenceFile(responseFile)).toBe(evidenceFile)
      expect(existsSync(evidenceFile)).toBe(false)
      expect(readFileSync(responseFile, 'utf8')).toBe(exactResponseBytes)
      expect(readFileSync(unrelatedFile, 'utf8')).toBe('keep')

      const failedResponseFile = path.join(outputDirectory, 'failed-response.md')
      const failedEvidenceFile = `${failedResponseFile}.model-verification.json`
      mkdirSync(failedEvidenceFile)
      expect(
        harness.writeCompletedResponseArtifacts(failedResponseFile, responseText, evidence),
      ).toEqual({
        evidencePath: '',
        evidenceWarning: expect.stringContaining('Optional model verification was not persisted'),
        responseFilePath: failedResponseFile,
      })
      expect(readFileSync(failedResponseFile, 'utf8')).toBe(exactResponseBytes)
      expect(existsSync(failedEvidenceFile)).toBe(true)

      const unavailableResponseFile = path.join(outputDirectory, 'unavailable-response.md')
      mkdirSync(unavailableResponseFile)
      expect(() => {
        harness.writeCompletedResponseArtifacts(unavailableResponseFile, responseText, evidence)
      }).toThrow()
      expect(readdirSync(outputDirectory).filter((entry) => entry.endsWith('.tmp'))).toEqual([])

      const staleResponseFile = path.join(outputDirectory, 'stale-response.md')
      const staleEvidenceFile = `${staleResponseFile}.model-verification.json`
      writeFileSync(staleResponseFile, 'prior response', 'utf8')
      writeFileSync(staleEvidenceFile, 'prior evidence', 'utf8')
      const invalidConfigHarness = loadReviewGptOpenTargetHarness(1, undefined, {
        remotePort: '',
        responseFile: staleResponseFile,
        shouldSend: true,
        shouldWaitForResponse: true,
      })
      expect(() => invalidConfigHarness.prepareRuntimeConfig()).toThrow(
        'Missing ORACLE_DRAFT_REMOTE_PORT',
      )
      expect(existsSync(staleEvidenceFile)).toBe(false)
      expect(readFileSync(staleResponseFile, 'utf8')).toBe('prior response')
      expect(readFileSync(unrelatedFile, 'utf8')).toBe('keep')
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true })
    }
  })

  it('releases failed non-wait runs and stops retries after unconfirmed cleanup', async () => {
    const timeoutClassifier = loadReviewGptOpenTargetHarness(1)
    for (const message of [
      'CDP socket command timed out: Runtime.evaluate',
      'Nested CDP socket command timed out: Runtime.evaluate',
      'Timed out opening page CDP socket',
    ]) {
      expect(timeoutClassifier.isRetryableSocketError(new Error(message))).toBe(true)
    }

    const delayedModelSelection = loadReviewGptOpenTargetHarness(1, undefined, {
      draftTimeoutMs: 600000,
    })
    expect(delayedModelSelection.getBrowserTransportTimeoutMs()).toBe(15000)
    expect(delayedModelSelection.getPageCommandTimeoutMs()).toBe(30000)
    await expect(delayedModelSelection.waitWithinPageCommand(20500)).resolves.toBe('completed')
    expect(delayedModelSelection.getNow()).toBe(20500)

    const transientPageTimeout = loadReviewGptOpenTargetHarness(1, undefined, {
      firstTargetPageCommandsHangThenFail: true,
    })
    await expect(transientPageTimeout.mainWithRetry()).rejects.toThrow(
      'Injected terminal command failure',
    )
    expect(
      transientPageTimeout.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(2)
    expect(
      transientPageTimeout.commands
        .filter((command) => command.method === 'Target.closeTarget')
        .map((command) => command.params.targetId),
    ).toEqual(['target-1', 'target-2'])

    for (const shouldSend of [false, true]) {
      const failedNonWait = loadReviewGptOpenTargetHarness(1, undefined, {
        failPageCommand: true,
        shouldSend,
      })

      await expect(failedNonWait.main()).rejects.toThrow('Injected CDP socket error')
      expect(
        failedNonWait.commands.filter((command) => command.method === 'Target.closeTarget'),
      ).toEqual([
        {
          listPollCount: 1,
          method: 'Target.closeTarget',
          params: { targetId: 'target-1' },
        },
      ])
    }

    const unconfirmedCleanup = loadReviewGptOpenTargetHarness(1, undefined, {
      closeCommandFails: true,
      failPageCommand: true,
      targetPresentAfterClose: true,
    })
    await expect(unconfirmedCleanup.mainWithRetry()).rejects.toMatchObject({
      reviewGptStage: 'target-cleanup',
      reviewGptTargetCleanupFailure: true,
      reviewGptTargetId: 'target-1',
    })
    expect(
      unconfirmedCleanup.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(1)
    const persistentCloseAttempts = unconfirmedCleanup.commands.filter(
      (command) => command.method === 'Target.closeTarget',
    )
    expect(persistentCloseAttempts.length).toBeGreaterThan(1)
    expect(persistentCloseAttempts.every(
      (command) => command.params.targetId === 'target-1',
    )).toBe(true)
    expect(unconfirmedCleanup.getNow()).toBe(5000)

    const recoveredVersionLookup = loadReviewGptOpenTargetHarness(1, undefined, {
      failPageCommandAtMethod: 'Runtime.enable',
      hangVersionAtCall: 2,
    })
    await expect(recoveredVersionLookup.main()).rejects.toThrow('Injected CDP socket error')
    expect(recoveredVersionLookup.getNow()).toBeLessThan(5000)
    expect(
      recoveredVersionLookup.commands.filter(
        (command) => command.method === 'Target.closeTarget',
      ),
    ).toHaveLength(1)
  })

  it('does not create another target after attachment cleanup is unconfirmed', async () => {
    const timedOutAttachment = loadReviewGptOpenTargetHarness(1, undefined, {
      hangPageSocketOpenAttempts: 1,
    })
    await expect(
      timedOutAttachment.connectTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ target: { id: 'target-2' } })
    expect(
      timedOutAttachment.commands.filter(
        (command) => command.method === 'Target.closeTarget',
      ),
    ).toEqual([
      {
        listPollCount: 1,
        method: 'Target.closeTarget',
        params: { targetId: 'target-1' },
      },
    ])

    const recoveredAttachment = loadReviewGptOpenTargetHarness(1, undefined, {
      failPageSocketOpenAttempts: 1,
    })
    await expect(
      recoveredAttachment.connectTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ target: { id: 'target-2' } })
    expect(
      recoveredAttachment.commands.filter(
        (command) => command.method === 'Target.closeTarget',
      ),
    ).toEqual([
      {
        listPollCount: 1,
        method: 'Target.closeTarget',
        params: { targetId: 'target-1' },
      },
    ])

    const retriedExactClose = loadReviewGptOpenTargetHarness(1, undefined, {
      closeCommandFailuresBeforeSuccess: 1,
      failPageSocketOpenAttempts: 1,
    })
    await expect(
      retriedExactClose.connectTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ target: { id: 'target-2' } })
    expect(
      retriedExactClose.commands
        .filter((command) => command.method === 'Target.closeTarget')
        .map((command) => command.params.targetId),
    ).toEqual(['target-1', 'target-1'])
    expect(
      retriedExactClose.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(2)

    const recoveredHungClose = loadReviewGptOpenTargetHarness(1, undefined, {
      failPageSocketOpenAttempts: 1,
      hangCloseCommandAtAttempt: 1,
    })
    await expect(
      recoveredHungClose.connectTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ target: { id: 'target-2' } })
    expect(recoveredHungClose.getNow()).toBeLessThan(5000)
    expect(
      recoveredHungClose.commands
        .filter((command) => command.method === 'Target.closeTarget')
        .map((command) => command.params.targetId),
    ).toEqual(['target-1', 'target-1'])

    const lostSuccessfulCloseResponse = loadReviewGptOpenTargetHarness(1, undefined, {
      closeCommandHangsAfterClosingAtAttempt: 1,
      failPageSocketOpenAttempts: 1,
    })
    await expect(
      lostSuccessfulCloseResponse.connectTarget('https://chatgpt.com/'),
    ).resolves.toMatchObject({ target: { id: 'target-2' } })
    expect(
      lostSuccessfulCloseResponse.commands
        .filter((command) => command.method === 'Target.closeTarget')
        .map((command) => command.params.targetId),
    ).toEqual(['target-1'])

    const failedAttachment = loadReviewGptOpenTargetHarness(1, undefined, {
      closeCommandFails: true,
      failPageSocketOpen: true,
      targetPresentAfterClose: true,
    })

    await expect(
      failedAttachment.connectTarget('https://chatgpt.com/'),
    ).rejects.toMatchObject({
      reviewGptStage: 'target-cleanup',
      reviewGptTargetCleanupFailure: true,
      reviewGptTargetId: 'target-1',
    })
    expect(
      failedAttachment.commands.filter(
        (command) => command.method === 'Target.createTarget',
      ),
    ).toHaveLength(1)
    const failedAttachmentCloses = failedAttachment.commands.filter(
      (command) => command.method === 'Target.closeTarget',
    )
    expect(failedAttachmentCloses.length).toBeGreaterThan(1)
    expect(failedAttachmentCloses.every(
      (command) => command.params.targetId === 'target-1',
    )).toBe(true)
  })

  it('keeps reverse-dependent CLI coverage on the source lane for inboxd-only diffs', () => {
    const summary = readWorkspaceDiffScope('packages/inboxd/test/inboxd.test.ts')

    expect(summary.affectedWorkspaceDirs).toContain('packages/cli')
    expect(summary.runVerifyCli).toBe(false)
    expect(summary.typecheckDirs).toContain('packages/cli')
    expect(summary.testDirs).toContain('packages/cli')
  })

  it('escalates CLI artifact-sensitive diffs onto the targeted verify lane', () => {
    const summary = readWorkspaceDiffScope('packages/cli/package.json')

    expect(summary.affectedWorkspaceDirs).toContain('packages/cli')
    expect(summary.runVerifyCli).toBe(true)
    expect(summary.typecheckDirs).not.toContain('packages/cli')
    expect(summary.testDirs).not.toContain('packages/cli')
  })

  it('treats shared prepared-runtime helper changes as CLI artifact-sensitive', () => {
    const summary = readWorkspaceDiffScope('scripts/build-test-runtime-prepared.mjs')

    expect(summary.repoInternalFastPath).toBe(true)
    expect(summary.runVerifyCli).toBe(true)
  })

  it('runs repo-tool regressions for config-only verification changes', () => {
    const summary = readWorkspaceDiffScope('config/vitest-parallelism.ts')

    expect(summary.repoInternalFastPath).toBe(true)
    expect(summary.runRepoToolsTests).toBe(true)
  })

  it('keeps active execution plans aligned with live coordination-ledger state', () => {
    const activePlansDir = path.join(repoRoot, 'agent-docs', 'exec-plans', 'active')
    const ledgerRows = parseCoordinationLedgerRows(
      readFileSync(path.join(activePlansDir, 'COORDINATION_LEDGER.md'), 'utf8'),
    )
    const activePlans = new Set(
      readdirSync(activePlansDir)
        .filter((entry) => entry.endsWith('.md'))
        .filter((entry) => entry !== 'README.md' && entry !== 'COORDINATION_LEDGER.md'),
    )
    const livePlanRows = ledgerRows.filter((row) =>
      row.plan.startsWith('agent-docs/exec-plans/active/'),
    )

    for (const row of livePlanRows) {
      const planName = path.basename(row.plan)
      const relativePlanPath = row.plan
      const matchingRows = livePlanRows.filter(
        (candidate) => candidate.plan === relativePlanPath,
      )

      if (!activePlans.has(planName)) {
        continue
      }

      const planText = readFileSync(path.join(activePlansDir, planName), 'utf8')
      const planStatus = planText.match(/^Status:\s*(.+)$/mu)?.[1].trim().toLowerCase() ?? ''

      expect(
        matchingRows,
        `${relativePlanPath} must have exactly one live coordination-ledger row.`,
      ).toHaveLength(1)
      expect(
        row.status.toLowerCase(),
        `${relativePlanPath} must not keep a completed ledger row under active/.`,
      ).not.toBe('completed')
      expect(
        planStatus.includes('completed'),
        `${relativePlanPath} must not remain under active/ once its plan status is completed.`,
      ).toBe(false)
      expect(
        planStatus.includes('implementation complete'),
        `${relativePlanPath} must not remain under active/ once implementation is complete.`,
      ).toBe(false)
    }
  })

  it('archives the active plan and clears the matching ledger row before invoking committer', () => {
    const harnessRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-finish-task-harness-'))

    try {
      writeHarnessFile(
        harnessRoot,
        'node_modules/@cobuild/repo-tools/src/consumer-shell.sh',
        `#!/usr/bin/env bash
repo_tools_join_lines() {
  local var_name="$1"
  shift
  local joined=""
  local item
  for item in "$@"; do
    if [[ -n "$joined" ]]; then
      joined+=$'\\n'
    fi
    joined+="$item"
  done
  printf -v "$var_name" '%s' "$joined"
  export "$var_name"
}

cobuild_repo_tool_bin() {
  printf '%s\\n' "$COBUILD_REPO_ROOT/.fake-tools/$1"
}
`,
        true,
      )

      for (const relativePath of [
        'scripts/repo-tools.config.sh',
        'scripts/finish-task',
        'scripts/close-exec-plan.sh',
        'scripts/committer',
      ]) {
        writeHarnessFile(
          harnessRoot,
          relativePath,
          readFileSync(path.join(repoRoot, relativePath), 'utf8'),
          true,
        )
      }

      writeHarnessFile(
        harnessRoot,
        'scripts/install-git-hooks',
        `#!/usr/bin/env bash
set -euo pipefail
touch .fake-tools/install-git-hooks.called
`,
        true,
      )

      writeHarnessFile(
        harnessRoot,
        '.fake-tools/cobuild-close-exec-plan',
        `#!/usr/bin/env bash
set -euo pipefail
plan_path="$1"
completed_path="agent-docs/exec-plans/completed/$(basename "$plan_path")"
mkdir -p "$(dirname "$completed_path")"
mv "$plan_path" "$completed_path"
printf '%s\\n' "$plan_path" "$completed_path" > .fake-tools/close-exec-plan.args
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        '.fake-tools/cobuild-committer',
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > .fake-tools/committer.args
if [[ -f agent-docs/exec-plans/active/COORDINATION_LEDGER.md ]]; then
  cp agent-docs/exec-plans/active/COORDINATION_LEDGER.md .fake-tools/committer-ledger.md
fi
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
        `# Coordination Ledger

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Harness | \`agent-docs/exec-plans/active/2026-04-24-harness.md\` | \`docs/touched.md\` | finish-task harness | in_progress | Harness row |
| Codex | Stable | \`agent-docs/exec-plans/active/stable.md\` | \`docs/stable.md\` | stable row | active | Existing row |
`,
      )
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/2026-04-24-harness.md',
        `# Harness Plan

Status: active
Created: 2026-04-24
Updated: 2026-04-24
`,
      )
      writeHarnessFile(harnessRoot, 'agent-docs/exec-plans/completed/README.md', '# Completed\n')
      writeHarnessFile(harnessRoot, 'docs/touched.md', '# Before\n')

      for (const command of [
        ['init'],
        ['config', 'user.name', 'Harness'],
        ['config', 'user.email', '123456+murph-harness@users.noreply.github.com'],
        ['add', '.'],
        ['commit', '-m', 'baseline'],
      ]) {
        const result = spawnSync('git', command, {
          cwd: harnessRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        })

        if (result.status !== 0) {
          throw new Error(
            `Harness git command failed (${command.join(' ')}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
          )
        }
      }

      writeHarnessFile(harnessRoot, 'docs/touched.md', '# Before\n\nAfter\n')
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
        `# Coordination Ledger

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Harness | \`agent-docs/exec-plans/active/2026-04-24-harness.md\` | \`docs/touched.md\` | finish-task harness | in_progress | Harness row |
| Codex | Stable | \`agent-docs/exec-plans/active/stable.md\` | \`docs/stable.md\` | stable row | active | Existing row |
| Codex | Unrelated | \`agent-docs/exec-plans/active/unrelated.md\` | \`docs/unrelated.md\` | unrelated row | active | Concurrent dirty row |
`,
      )

      const result = spawnSync(
        'bash',
        [
          'scripts/finish-task',
          'agent-docs/exec-plans/active/2026-04-24-harness.md',
          'close harness plan',
          'docs/touched.md',
        ],
        {
          cwd: harnessRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )

      if (result.status !== 0) {
        throw new Error(
          `finish-task harness failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
        )
      }

      expect(existsSync(path.join(harnessRoot, '.fake-tools/install-git-hooks.called'))).toBe(true)

      expect(
        existsSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/2026-04-24-harness.md')),
      ).toBe(false)
      expect(
        existsSync(path.join(harnessRoot, 'agent-docs/exec-plans/completed/2026-04-24-harness.md')),
      ).toBe(true)
      expect(
        readFileSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/COORDINATION_LEDGER.md'), 'utf8'),
      ).not.toContain('agent-docs/exec-plans/active/2026-04-24-harness.md')
      expect(
        readFileSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/COORDINATION_LEDGER.md'), 'utf8'),
      ).toContain('agent-docs/exec-plans/active/unrelated.md')
      expect(result.stdout).toContain(
        'finish-task: commit includes only this task\'s ledger-row removal',
      )

      const closeArgs = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'close-exec-plan.args'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/u)
      const commitArgs = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'committer.args'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/u)

      expect(closeArgs).toEqual([
        'agent-docs/exec-plans/active/2026-04-24-harness.md',
        'agent-docs/exec-plans/completed/2026-04-24-harness.md',
      ])
      expect(commitArgs).toEqual(
        expect.arrayContaining([
          'close harness plan',
          'agent-docs/exec-plans/active/2026-04-24-harness.md',
          'agent-docs/exec-plans/completed/2026-04-24-harness.md',
          'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
          'docs/touched.md',
        ]),
      )
      const committedLedger = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'committer-ledger.md'),
        'utf8',
      )
      expect(committedLedger).not.toContain('agent-docs/exec-plans/active/2026-04-24-harness.md')
      expect(committedLedger).not.toContain('agent-docs/exec-plans/active/unrelated.md')
      expect(committedLedger).toContain('agent-docs/exec-plans/active/stable.md')
    } finally {
      rmSync(harnessRoot, { recursive: true, force: true })
    }
  })

  it('keeps repo-tools audit bundles wired without review-gpt wrappers', () => {
    const repoToolsConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'repo-tools.config.sh'),
      'utf8',
    )
    const fullPackageScript = readFileSync(
      path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'),
      'utf8',
    )

    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'")
    expect(repoToolsConfig).toContain('repo_tools_join_lines COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS')
    expect(repoToolsConfig).toContain('"apps/*/public/design-assets/**"')
    expect(repoToolsConfig).toContain('"docs/assets/*.jpg"')
    expect(repoToolsConfig).toContain('repo_tools_join_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS')
    expect(repoToolsConfig).toContain('"agent-docs/references/hosted-runtime-protocol.md"')
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'")
    expect(fullPackageScript).toContain('REVIEW_GPT_ROUND_NUMBER')
    expect(fullPackageScript).toContain('REVIEW_GPT_FIRST_REVIEWED_HEAD')
    expect(fullPackageScript).toContain('REVIEW_GPT_PREVIOUS_REVIEWED_HEAD')
    expect(fullPackageScript).toContain('review-round.json')
    expect(fullPackageScript).toContain('since-first-reviewed-head.diff')
    expect(fullPackageScript).toContain('since-previous-reviewed-head.diff')
    expect(fullPackageScript).toContain('git diff --no-ext-diff --no-textconv --patch')
    expect(fullPackageScript).toContain(
      'gh pr view "$review_gpt_pr_ref" --json body',
    )
    expect(fullPackageScript).toContain('$review_gpt_pr_context_dir/pr-body.md')
    expect(fullPackageScript).toContain(
      'export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="${COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS:-}"',
    )
  })

  it('packages exact ReviewGPT round metadata and remediation deltas', () => {
    const harnessRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-review-round-harness-'))
    const fakeBin = path.join(harnessRoot, '.fake-tools')
    const packageScript = path.join(harnessRoot, 'scripts', 'package-audit-context-full.sh')

    try {
      writeHarnessFile(
        harnessRoot,
        'scripts/package-audit-context-full.sh',
        readFileSync(
          path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'),
          'utf8',
        ),
        true,
      )
      writeHarnessFile(
        harnessRoot,
        'scripts/repo-tools.config.sh',
        `#!/usr/bin/env bash
export COBUILD_REPO_ROOT="$(pwd)"
COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS=""
repo_tools_join_lines() { :; }
cobuild_repo_tool_bin() {
  printf '%s\\n' "$COBUILD_REPO_ROOT/.fake-tools/cobuild-package-audit-context"
}
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        '.fake-tools/pnpm',
        `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "no-js" ]]
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        '.fake-tools/gh',
        `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *".baseRefName"*) printf 'main\\n' ;;
  *".baseRefOid"*) printf '%s\\n' "$TEST_BASE_SHA" ;;
  *".headRefOid"*) printf '%s\\n' "$TEST_HEAD_SHA" ;;
  *".body"*) printf 'ReviewGPT first-reviewed head: %s\\n' "$TEST_FIRST_SHA" ;;
  *) printf 'unexpected gh invocation: %s\\n' "$*" >&2; exit 1 ;;
esac
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        '.fake-tools/cobuild-package-audit-context',
        `#!/usr/bin/env bash
set -euo pipefail
out_dir=""
name=""
while (( "$#" )); do
  case "$1" in
    --out-dir) out_dir="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$out_dir"
entries=()
while IFS= read -r entry; do
  [[ -z "$entry" ]] || entries+=("$entry")
done <<< "\${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"
(( "\${#entries[@]}" > 0 ))
(
  cd "$COBUILD_REPO_ROOT"
  zip -q "$out_dir/$name.zip" "\${entries[@]}"
)
`,
        true,
      )

      execFileSync('git', ['init', '-q'], { cwd: harnessRoot })
      execFileSync('git', ['config', 'core.hooksPath', '.disabled-hooks'], {
        cwd: harnessRoot,
      })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: harnessRoot })
      execFileSync('git', ['config', 'user.email', 'test@users.noreply.github.com'], {
        cwd: harnessRoot,
      })
      writeHarnessFile(harnessRoot, 'apps/demo/source.ts', 'export const value = 0\n')
      execFileSync('git', ['add', '.'], { cwd: harnessRoot })
      execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: harnessRoot })
      const baseHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: harnessRoot,
        encoding: 'utf8',
      }).trim()

      writeHarnessFile(harnessRoot, 'apps/demo/source.ts', 'export const value = 1\n')
      execFileSync('git', ['add', '.'], { cwd: harnessRoot })
      execFileSync('git', ['commit', '-q', '-m', 'first review'], { cwd: harnessRoot })
      const firstHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: harnessRoot,
        encoding: 'utf8',
      }).trim()

      writeHarnessFile(harnessRoot, 'apps/demo/source.ts', 'export const value = 2\n')
      execFileSync('git', ['add', '.'], { cwd: harnessRoot })
      execFileSync('git', ['commit', '-q', '-m', 'correction'], { cwd: harnessRoot })
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: harnessRoot,
        encoding: 'utf8',
      }).trim()

      execFileSync('git', ['checkout', '-q', '-b', 'non-ancestor', baseHead], {
        cwd: harnessRoot,
      })
      writeHarnessFile(harnessRoot, 'apps/demo/source.ts', 'export const value = 99\n')
      execFileSync('git', ['add', 'apps/demo/source.ts'], { cwd: harnessRoot })
      execFileSync('git', ['commit', '-q', '-m', 'unrelated line'], { cwd: harnessRoot })
      const nonAncestorHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: harnessRoot,
        encoding: 'utf8',
      }).trim()
      execFileSync('git', ['checkout', '-q', '--detach', currentHead], { cwd: harnessRoot })

      const invokePackager = (
        name: string,
        head: string,
        roundEnv: Record<string, string>,
      ) => {
        const outDir = path.join(harnessRoot, 'out', name)
        const result = spawnSync(
          'bash',
          [packageScript, '--zip', '--out-dir', outDir, '--name', name],
          {
            cwd: harnessRoot,
            encoding: 'utf8',
            env: {
              ...withoutNodeV8Coverage(),
              PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
              REVIEW_GPT_PR_REF: '',
              REVIEW_GPT_PR_URL: '123',
              TEST_BASE_SHA: baseHead,
              TEST_FIRST_SHA:
                roundEnv.TEST_RECORDED_FIRST_HEAD ??
                (roundEnv.REVIEW_GPT_ROUND_NUMBER === '1' ? head : firstHead),
              TEST_HEAD_SHA: head,
              ...roundEnv,
            },
          },
        )
        return {
          outDir,
          result,
          zipPath: path.join(outDir, `${name}.zip`),
        }
      }

      const roundOne = invokePackager('round-one', firstHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: '',
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: '',
        REVIEW_GPT_ROUND_NUMBER: '1',
      })
      expect(roundOne.result.status, roundOne.result.stderr).toBe(0)
      const roundOneMetadata = JSON.parse(
        execFileSync(
          'unzip',
          ['-p', roundOne.zipPath, 'review-gpt-pr-context/review-round.json'],
          { encoding: 'utf8' },
        ),
      ) as Record<string, unknown>
      expect(roundOneMetadata).toEqual({
        schemaVersion: 1,
        roundNumber: 1,
        reviewScope: 'full',
        currentBaseHead: baseHead,
        firstReviewedHead: firstHead,
        previousReviewedHead: null,
        currentReviewedHead: firstHead,
        firstReviewedHeadIsAncestorOfCurrent: true,
        previousReviewedHeadIsAncestorOfCurrent: null,
      })
      expect(
        execFileSync(
          'unzip',
          [
            '-p',
            roundOne.zipPath,
            'review-gpt-pr-context/since-previous-reviewed-head.diff',
          ],
          { encoding: 'utf8' },
        ),
      ).toBe('')
      expect(
        execFileSync(
          'unzip',
          ['-p', roundOne.zipPath, 'review-gpt-pr-context/since-first-reviewed-head.diff'],
          { encoding: 'utf8' },
        ),
      ).toBe('')
      expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(false)

      const roundTwo = invokePackager('round-two', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_ROUND_NUMBER: '2',
      })
      expect(roundTwo.result.status, roundTwo.result.stderr).toBe(0)
      const roundTwoMetadata = JSON.parse(
        execFileSync(
          'unzip',
          ['-p', roundTwo.zipPath, 'review-gpt-pr-context/review-round.json'],
          { encoding: 'utf8' },
        ),
      ) as Record<string, unknown>
      expect(roundTwoMetadata).toEqual({
        schemaVersion: 1,
        roundNumber: 2,
        reviewScope: 'correction',
        currentBaseHead: baseHead,
        firstReviewedHead: firstHead,
        previousReviewedHead: firstHead,
        currentReviewedHead: currentHead,
        firstReviewedHeadIsAncestorOfCurrent: true,
        previousReviewedHeadIsAncestorOfCurrent: true,
      })
      const expectedDelta = execFileSync(
        'git',
        ['diff', '--no-ext-diff', '--no-textconv', '--patch', firstHead, currentHead, '--'],
        { cwd: harnessRoot, encoding: 'utf8' },
      )
      expect(
        execFileSync(
          'unzip',
          [
            '-p',
            roundTwo.zipPath,
            'review-gpt-pr-context/since-previous-reviewed-head.diff',
          ],
          { encoding: 'utf8' },
        ),
      ).toBe(expectedDelta)
      expect(
        execFileSync(
          'unzip',
          ['-p', roundTwo.zipPath, 'review-gpt-pr-context/since-first-reviewed-head.diff'],
          { encoding: 'utf8' },
        ),
      ).toBe(expectedDelta)
      expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(false)

      const missingPrevious = invokePackager('missing-previous', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: '',
        REVIEW_GPT_ROUND_NUMBER: '2',
      })
      expect(missingPrevious.result.status).not.toBe(0)
      expect(missingPrevious.result.stderr).toContain(
        'later ReviewGPT rounds require REVIEW_GPT_FIRST_REVIEWED_HEAD and REVIEW_GPT_PREVIOUS_REVIEWED_HEAD',
      )
      expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(false)

      const malformedFirst = invokePackager('malformed-first', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: 'not-a-sha',
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_ROUND_NUMBER: '2',
      })
      expect(malformedFirst.result.status).not.toBe(0)
      expect(malformedFirst.result.stderr).toContain(
        'first-reviewed head must be a full lowercase 40-character commit SHA',
      )
      expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(false)

      const resetBaseline = invokePackager('reset-baseline', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: baseHead,
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_ROUND_NUMBER: '2',
      })
      expect(resetBaseline.result.status).not.toBe(0)
      expect(resetBaseline.result.stderr).toContain(
        'REVIEW_GPT_FIRST_REVIEWED_HEAD must match the immutable PR body baseline',
      )

      const unavailableHead = 'f'.repeat(40)
      const unavailableBaseline = invokePackager('unavailable-baseline', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: unavailableHead,
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_ROUND_NUMBER: '2',
        TEST_RECORDED_FIRST_HEAD: unavailableHead,
      })
      expect(unavailableBaseline.result.status).not.toBe(0)
      expect(unavailableBaseline.result.stderr).toContain(
        'first-reviewed head commit is not available locally',
      )

      const nonAncestorBaseline = invokePackager('non-ancestor-baseline', currentHead, {
        REVIEW_GPT_FIRST_REVIEWED_HEAD: nonAncestorHead,
        REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: firstHead,
        REVIEW_GPT_ROUND_NUMBER: '2',
        TEST_RECORDED_FIRST_HEAD: nonAncestorHead,
      })
      expect(nonAncestorBaseline.result.status).not.toBe(0)
      expect(nonAncestorBaseline.result.stderr).toContain(
        'first-reviewed head must be an ancestor of the current reviewed head',
      )
    } finally {
      rmSync(harnessRoot, { force: true, recursive: true })
    }
  }, 30_000)

  it('keeps the lean audit bundle smaller than the full one while preserving durable agent docs', () => {
    const leanBundle = createAuditZip('package-audit-context.sh', 'murph-lean-audit')
    const fullBundle = createAuditZip('package-audit-context-full.sh', 'murph-full-audit')

    try {
      const leanEntries = listZipEntries(leanBundle.zipPath)
      const fullEntries = listZipEntries(fullBundle.zipPath)

      expect(leanEntries).toContain('agent-docs/operations/verification-and-runtime.md')
      expect(leanEntries).toContain('agent-docs/operations/pr-reviewgpt-loop.md')
      expect(leanEntries).toContain('agent-docs/product-specs/repo.md')
      expect(leanEntries).toContain('agent-docs/references/hosted-runtime-protocol.md')
      expect(leanEntries).not.toContain('agent-docs/product-specs/repo-v1.md')
      expect(leanEntries).toContain('docs/architecture.md')
      expect(leanEntries).toContain('docs/contracts/00-invariants.md')
      expect(leanEntries).not.toContain('agent-docs/generated/doc-inventory.md')
      expect(leanEntries).not.toContain('agent-docs/exec-plans/completed/README.md')
      expect(leanEntries).not.toContain('agent-docs/prompts/coverage-write.md')
      expect(leanEntries).not.toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(leanEntries).not.toContain('apps/web/test/device-sync-http.test.ts')
      expect(leanEntries).not.toContain('docs/device-sync-hosted-control-plane.md')
      expect(leanEntries).not.toContain('.github/workflows/release.yml')
      expect(leanEntries).not.toContain('apps/web/public/design-assets/hero-02.png')
      expect(leanEntries).not.toContain('apps/web/public/hero.jpg')
      expect(leanEntries).not.toContain('apps/web/public/legal/privacy.pdf')
      expect(leanEntries).not.toContain('docs/assets/readme-hero.jpg')

      expect(fullEntries).toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(fullEntries).toContain('apps/web/test/device-sync-http.test.ts')
      expect(fullEntries).toContain('docs/device-sync-hosted-control-plane.md')
      expect(fullEntries).toContain('.github/workflows/release.yml')
      expect(fullEntries).toContain('agent-docs/exec-plans/completed/README.md')
      expect(fullEntries).toContain('agent-docs/prompts/coverage-write.md')
      expect(fullEntries).toContain('agent-docs/references/hosted-runtime-protocol.md')
      expect(fullEntries).not.toContain('apps/web/public/design-assets/hero-02.png')
      expect(fullEntries).not.toContain('apps/web/public/hero.jpg')
      expect(fullEntries).not.toContain('apps/web/public/legal/privacy.pdf')
      expect(fullEntries).not.toContain('docs/assets/readme-hero.jpg')
      expect(leanEntries.length).toBeLessThan(fullEntries.length)
    } finally {
      rmSync(leanBundle.outDir, { force: true, recursive: true })
      rmSync(fullBundle.outDir, { force: true, recursive: true })
    }
  }, 120_000)

  it('keeps release:check focused on release guards, typecheck, clean workspace build, and coverage verification', () => {
    const releaseCheck = readFileSync(
      path.join(repoRoot, 'scripts', 'release-check.sh'),
      'utf8',
    )

    expect(releaseCheck).toContain('bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh')
    expect(releaseCheck).toContain('node scripts/verify-release-target.mjs')
    expect(releaseCheck).toContain('corepack pnpm build:workspace:clean')
    expect(releaseCheck).toContain('corepack pnpm verify:acceptance')
    expect(releaseCheck).not.toContain('pnpm install --frozen-lockfile')
    expect(releaseCheck).not.toContain('pnpm verify:repo')
    expect(releaseCheck).not.toContain('--out-dir "$temp_dir/tarballs"')

    expect(releaseCheck.indexOf('node scripts/verify-release-target.mjs')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm build:workspace:clean'),
    )
    expect(releaseCheck.indexOf('corepack pnpm build:workspace:clean')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm verify:acceptance'),
    )
  })

  it('keeps acceptance web verification on prepared setup paths after root typecheck', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const webVerify = readFileSync(
      path.join(repoRoot, 'apps', 'web', 'scripts', 'verify-fast.sh'),
      'utf8',
    )

    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).toContain(
      'apps/web/scripts/dev-local.ts',
    )
    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).not.toContain(
      'health-commons:generate',
    )
    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).not.toContain(
      'legal:pdf',
    )
    expect(hostedWebPackageJson.scripts?.['test']).toBe(
      'pnpm health-commons:generate && pnpm test:prepared',
    )
    expect(hostedWebPackageJson.scripts?.['test:prepared']).toContain(
      'vitest run --config apps/web/vitest.workspace.ts --no-coverage',
    )
    expect(webVerify).toContain('MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV=1 pnpm dev:smoke')
    expect(webVerify).toContain('pnpm test:prepared')
    expect(webVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED')
    expect(workspaceVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED=1')
    expect(workspaceVerify).toContain(
      'skip Health Commons generated artifacts; root acceptance typecheck already prepared them',
    )
    expect(workspaceVerify).toContain(
      'run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts "$acceptance_typechecked"',
    )
    expect(workspaceVerify).toContain('MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE')
    expect(workspaceVerify).toContain(
      'run_timed_step "Package coverage hygiene" run_package_coverage_cleanup_and_hygiene',
    )
    expect(workspaceVerify).toContain('MURPH_ACCEPTANCE_APP_VERIFY_DELAY_SECONDS')
    expect(workspaceVerify).toContain(
      'readonly acceptance_app_verify_delay_seconds_default="$([[ -n "${CI:-}" || "$shared_host_mode" == "1" ]] && echo 0 || echo 45)"',
    )
    expect(workspaceVerify).toContain(
      'delay App verification ${acceptance_app_verify_delay_seconds}s to preserve package coverage throughput',
    )
    expect(workspaceVerify).toContain(
      'readonly package_coverage_vitest_max_workers_default="$([[ -n "${CI:-}" ]] && echo 50% || local_worker_budget_default "$package_coverage_concurrency_limit" 1)"',
    )
    expect(workspaceVerify).toContain(
      'readonly package_coverage_cli_active_concurrency_default="$([[ -n "${CI:-}" || "$shared_host_mode" == "1" ]] && echo 1 || echo 4)"',
    )
    expect(workspaceVerify).toContain('MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY')
    expect(workspaceVerify).toContain('current_package_coverage_concurrency()')
    expect(workspaceVerify).toContain('can_launch_next_package_coverage()')
    expect(webVerify.indexOf('run_timed_step "next build" run_next_build &')).toBeLessThan(
      webVerify.indexOf('run_timed_step "dev smoke" run_dev_smoke &'),
    )
    expect(workspaceVerify).toContain(
      'run_acceptance_app_verification_after_delay "$acceptance_typechecked" 1',
    )
    expect(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage hygiene" run_package_coverage_cleanup_and_hygiene',
      ),
    ).toBeLessThan(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage suite" run_test_packages_coverage_after_hygiene',
      ),
    )
    expect(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage suite" run_test_packages_coverage_after_hygiene',
      ),
    ).toBeLessThan(
      workspaceVerify.indexOf(
        'run_acceptance_app_verification_after_delay "$acceptance_typechecked" 1',
      ),
    )
  })

  it('keeps long CLI smoke groups in independent coverage buckets', () => {
    const cliWorkspace = readFileSync(
      path.join(repoRoot, 'packages', 'cli', 'vitest.workspace.ts'),
      'utf8',
    )

    expect(cliWorkspace).toContain('name: "cli-device-smoke"')
    expect(cliWorkspace).toContain('patterns: ["device-cli.test.ts"]')
    expect(cliWorkspace).toContain('name: "cli-release-smoke"')
    expect(cliWorkspace).toContain('patterns: ["release-*.test.ts"]')
    expect(cliWorkspace).toContain('name: "cli-incur-smoke"')
    expect(cliWorkspace).toContain(
      'patterns: ["incur-smoke.test.ts", "incur-skill-hash.test.ts"]',
    )
    expect(cliWorkspace.indexOf('name: "cli-device-smoke"')).toBeLessThan(
      cliWorkspace.indexOf('name: "cli-schemas-smoke"'),
    )
    expect(cliWorkspace.indexOf('name: "cli-incur-smoke"')).toBeLessThan(
      cliWorkspace.indexOf('name: "cli-schemas-smoke"'),
    )
  })

  it('prepares the hosted web Prisma client before Cloudflare app verification typecheck', () => {
    const cloudflareVerify = readFileSync(
      path.join(repoRoot, 'apps', 'cloudflare', 'scripts', 'verify-fast.sh'),
      'utf8',
    )

    expect(cloudflareVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED')
    expect(cloudflareVerify).toContain('pnpm --dir "$repo_root/apps/web" prisma:generate')
    expect(cloudflareVerify).toContain(
      'prepare_hosted_web_prisma_client\n\nif [[ "$skip_typecheck" == "1" ]]',
    )
  })

  it('runs release checks directly instead of through an env-overridable shell command', () => {
    const releaseScript = readFileSync(path.join(repoRoot, 'scripts', 'release.sh'), 'utf8')

    expect(releaseScript).toContain("echo 'Running release checks...'")
    expect(releaseScript).toContain('corepack pnpm release:check')
    expect(releaseScript).not.toContain('RELEASE_CHECK_CMD')
    expect(releaseScript).not.toContain('CHECK_CMD=')
    expect(releaseScript).not.toContain('sh -lc "$CHECK_CMD"')
  })

  it('propagates CLI package coverage failures instead of forcing the release lane green', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const runTimedStep = workspaceVerify.match(
      /run_timed_step\(\) \{[\s\S]*?^\}/m,
    )?.[0]
    const cliCoverageBranch = workspaceVerify.match(
      /run_workspace_package_coverage\(\) \{[\s\S]*?^\}/m,
    )?.[0]
    const packageCoverageDirs = workspaceVerify.match(
      /local package_coverage_dirs=\([\s\S]*?^  \)/m,
    )?.[0]

    expect(runTimedStep).toBeTruthy()
    expect(cliCoverageBranch).toBeTruthy()
    expect(packageCoverageDirs).toBeTruthy()
    expect(cliCoverageBranch).toContain(
      'env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" --coverage',
    )
    expect(cliCoverageBranch).toContain(
      'pnpm --dir packages/contracts test:coverage:prepared',
    )
    expect(workspaceVerify).toContain('verify:package-boundary:prepared')
    expect(workspaceVerify).toContain('trap write_package_coverage_status EXIT')
    expect(workspaceVerify).toContain('package_coverage_pid_finished_without_status()')
    expect(workspaceVerify).toContain('failure_labels_dir="$failure_dir/failures"')
    expect(workspaceVerify).toContain('status_dir="$failure_dir/status"')
    expect(workspaceVerify).toContain('reap_finished_package_coverage()')
    expect(packageCoverageDirs!.indexOf('"packages/cli"')).toBeLessThan(
      packageCoverageDirs!.indexOf('"packages/contracts"'),
    )
    expect(packageCoverageDirs!.indexOf('"packages/contracts"')).toBeLessThan(
      packageCoverageDirs!.indexOf('"packages/device-syncd"'),
    )
    expect(cliCoverageBranch).toContain('return $?')
    const harnessDir = mkdtempSync(
      path.join(os.tmpdir(), 'murph-workspace-verify-harness-'),
    )

    try {
      const harnessPath = path.join(harnessDir, 'workspace-verify-harness.sh')
      writeFileSync(
        harnessPath,
        `#!/usr/bin/env bash
set -euo pipefail
verify_log() { :; }
${runTimedStep!}
run_workspace_package_coverage() {
  if [[ "$1" == "packages/cli" ]]; then
    run_timed_step "$2" false
    return $?
  fi
}
if ! run_workspace_package_coverage packages/cli "CLI package coverage"; then
  printf 'captured\\n'
  exit 0
fi
printf 'missed\\n'
exit 1
`,
        'utf8',
      )

      const result = spawnSync('bash', [harnessPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('captured')
      expect(result.stdout).not.toContain('missed')
    } finally {
      rmSync(harnessDir, { recursive: true, force: true })
    }
  })

  it('keeps live agent-builder routing independent of the retired Fable implementation lane', () => {
    const liveAgentBuilderDocs = [
      'AGENTS.md',
      'CLAUDE.md',
      path.join('agent-docs', 'FRONTEND.md'),
      path.join('agent-docs', 'operations', 'agent-workflow-routing.md'),
    ].map((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'))

    for (const workflowDoc of liveAgentBuilderDocs) {
      expect(workflowDoc).not.toMatch(/\bFable\b|Claude Code/iu)
    }
  })

  it('requires the Claude Code UI double-check at website UI completion', () => {
    const completionWorkflow = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'completion-workflow.md'),
      'utf8',
    )

    expect(completionWorkflow).toContain('## Claude Code UI Double-Check')
    expect(completionWorkflow).toContain(
      'claude --model claude-fable-5 --permission-mode plan --no-session-persistence -p',
    )
    expect(completionWorkflow).toContain(
      'claude --model opus --permission-mode plan --no-session-persistence -p',
    )
    expect(completionWorkflow).toContain('run the same packet once')
    expect(completionWorkflow).toContain(
      'Explicit Claude credit or quota exhaustion is the only non-blocking Claude Code gap.',
    )
    expect(completionWorkflow).toContain('stop making Claude requests')
    expect(completionWorkflow).toContain(
      'An already-completed task-scoped `frontend-review` satisfies the substitute',
    )
    expect(completionWorkflow).toContain(
      'run the required `frontend-review` pass now',
    )
    expect(completionWorkflow).toContain(
      'without claiming that the Claude Code double-check passed',
    )
    expect(completionWorkflow).toContain(
      'neither model route can return a usable review for a non-credit reason',
    )
    expect(completionWorkflow).toContain(
      'do not claim this double-check passed',
    )
    expect(completionWorkflow).toContain('does not replace `frontend-review`')
    expect(completionWorkflow).toContain(
      'agent-docs/prompts/frontend-review.md',
    )
    expect(completionWorkflow).toContain('tiny copy-only fast path')
    expect(completionWorkflow).toContain(
      'excluding unrelated working-tree content',
    )
    expect(completionWorkflow).toContain(
      'untrusted evidence, not reviewer instructions',
    )
    expect(completionWorkflow).not.toContain(
      'Fable model, authentication, credits, or invocation is unavailable',
    )
    expect(completionWorkflow).not.toContain('--dangerously-skip-permissions')
  })

  it('keeps the durable storage-boundary docs explicit about canonical product state versus assistant runtime residue', () => {
    const architecture = readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf8')
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    const baselineArchitecture = readFileSync(
      path.join(repoRoot, 'docs', 'architecture.md'),
      'utf8',
    )
    const invariants = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '00-invariants.md'),
      'utf8',
    )
    const commandSurface = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '03-command-surface.md'),
      'utf8',
    )
    const safeExtensionGuide = readFileSync(
      path.join(repoRoot, 'docs', 'safe-extension-guide.md'),
      'utf8',
    )
    const workflowRouting = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'agent-workflow-routing.md'),
      'utf8',
    )
    const verificationAndRuntime = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'verification-and-runtime.md'),
      'utf8',
    )
    const security = readFileSync(path.join(repoRoot, 'agent-docs', 'SECURITY.md'), 'utf8')
    const runtimeStateReadme = readFileSync(
      path.join(repoRoot, 'packages', 'runtime-state', 'README.md'),
      'utf8',
    )

    expect(architecture).toContain('Storage-policy hard line:')
    expect(architecture).toContain('execution residue, replay/continuity artifacts, and operator diagnostics only')
    expect(readme).toContain('it does not belong in assistant runtime first')
    expect(baselineArchitecture).toContain('do not use assistant runtime as a first stop for user-facing or queryable product state')
    expect(invariants).toContain('never assistant runtime state')
    expect(commandSurface).toContain('runtime inspection/control only')
    expect(commandSurface).toContain('not an `assistant` runtime CRUD surface')
    expect(safeExtensionGuide).toContain('do not prototype it in assistant runtime first')
    expect(workflowRouting).toContain('it must not start life in assistant runtime or other operational state')
    expect(verificationAndRuntime).toContain('it must not start in assistant runtime first')
    expect(security).toContain('not a product-state staging area')
    expect(runtimeStateReadme).toContain('intentionally not a product-state incubator')
    expect(runtimeStateReadme).toContain('execution residue only')
  })

  it('verifies the live release manifest and publish set', () => {
    const summary = JSON.parse(
      execFileSync('node', ['scripts/verify-release-target.mjs', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      }),
    ) as {
      packages: Array<{
        bundledExternalDependencies?: string[]
        bundledWorkspaceDependencies?: string[]
        name: string
      }>
      primaryPackage: { name: string } | null
      version: string
    }

    expect(summary.version).toBe(cliPackageJson.version)
    expect(summary.primaryPackage?.name).toBe('@murphai/murph')
    expect([...summary.packages.map((entry) => entry.name)].sort()).toEqual([
      '@murphai/contracts',
      '@murphai/hosted-execution',
      '@murphai/gateway-core',
      '@murphai/murph',
      '@murphai/openclaw-plugin',
    ].sort())

    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledWorkspaceDependencies: [
        '@murphai/clinical-records',
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/health-metrics',
        '@murphai/importers',
        '@murphai/runtime-state',
      ],
      name: '@murphai/hosted-execution',
    }))
    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledExternalDependencies: ['incur'],
      bundledWorkspaceDependencies: expect.arrayContaining([
        '@murphai/assistant-cli',
        '@murphai/assistant-engine',
        '@murphai/assistantd',
        '@murphai/clinical-records',
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/importers',
        '@murphai/inbox-services',
        '@murphai/inboxd',
        '@murphai/messaging-ingress',
        '@murphai/operator-config',
        '@murphai/parsers',
        '@murphai/query',
        '@murphai/runtime-state',
        '@murphai/setup-cli',
        '@murphai/vault-usecases',
      ]),
      name: '@murphai/murph',
    }))
  })

  it('keeps release script help usage stable for both --help and -h', () => {
    const cases = [
      {
        args: ['scripts/verify-release-target.mjs'],
        expected:
          'Usage: node scripts/verify-release-target.mjs [--expect-version <version>] [--json]',
      },
      {
        args: ['scripts/pack-publishables.mjs'],
        expected:
          'Usage: node scripts/pack-publishables.mjs [--expect-version <version>] [--out-dir <dir>] [--pack-output <file>] [--clean]',
      },
      {
        args: ['scripts/publish-publishables.mjs'],
        expected:
          'Usage: node scripts/publish-publishables.mjs [--pack-output <file>] [--npm-tag <tag>] [--provenance|--no-provenance]',
      },
    ] as const

    for (const helpFlag of ['--help', '-h']) {
      for (const testCase of cases) {
        const result = runNodeScript(...testCase.args, helpFlag)

        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
        expect(result.stdout.trim()).toBe(testCase.expected)
      }
    }
  })

  it('rejects unknown release-script arguments with the stable error text', () => {
    for (const scriptPath of [
      'scripts/verify-release-target.mjs',
      'scripts/pack-publishables.mjs',
      'scripts/publish-publishables.mjs',
    ]) {
      const result = runNodeScript(scriptPath, '--wat')

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Unknown argument: --wat')
    }
  })

  it('preserves current value-token consumption and missing-value validation branches', () => {
    const verifyResult = runNodeScript(
      'scripts/verify-release-target.mjs',
      '--expect-version',
      '--json',
    )
    expect(verifyResult.status).not.toBe(0)
    expect(verifyResult.stdout).toBe('')
    expect(verifyResult.stderr).toContain(
      `Expected release version --json, but manifest packages are on ${cliPackageJson.version}.`,
    )

    const packMissingValue = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--pack-output',
      '--expect-version',
    )
    expect(packMissingValue.status).not.toBe(0)
    expect(packMissingValue.stdout).toBe('')
    expect(packMissingValue.stderr).toContain(
      'Missing value for --expect-version.',
    )

    const packEmptyString = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--out-dir',
      '',
    )
    expect(packEmptyString.status).not.toBe(0)
    expect(packEmptyString.stdout).toBe('')
    expect(packEmptyString.stderr).toContain('Missing value for --out-dir.')

    const publishMissingValue = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--pack-output',
      '--npm-tag',
    )
    expect(publishMissingValue.status).not.toBe(0)
    expect(publishMissingValue.stdout).toBe('')
    expect(publishMissingValue.stderr).toContain('Missing value for --npm-tag.')

    const publishEmptyString = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--npm-tag',
      '',
    )
    expect(publishEmptyString.status).not.toBe(0)
    expect(publishEmptyString.stdout).toBe('')
    expect(publishEmptyString.stderr).toContain('Missing value for --npm-tag.')
  })

  it('keeps packages/cli publish-ready as @murphai/murph without package-local release scripts', () => {
    const packPublishables = readFileSync(
      path.join(repoRoot, 'scripts', 'pack-publishables.mjs'),
      'utf8',
    )

    expect(cliPackageJson.name).toBe('@murphai/murph')
    expect(cliPackageJson.files).toContain('CHANGELOG.md')
    expect(cliPackageJson.bin?.murph).toBe('dist/bin.js')
    expect(cliPackageJson.bin?.['vault-cli']).toBe('dist/bin.js')
    expect(cliPackageJson.dependencies?.['@murphai/device-syncd']).toBe('workspace:*')
    expect(cliPackageJson.dependencies?.['@murphai/messaging-ingress']).toBe('workspace:*')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/assistant-engine')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/vault-usecases')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/messaging-ingress')
    expect(cliPackageJson.dependencies?.incur).toBe('0.4.5')
    expect(cliPackageJson.dependencies?.['@cfworker/json-schema']).toBe('^4.1.1')
    expect(cliPackageJson.dependencies?.['@modelcontextprotocol/server']).toBe('^2.0.0-alpha.2')
    expect(cliPackageJson.dependencies?.['@toon-format/toon']).toBe('^2.1.0')
    expect(cliPackageJson.dependencies?.tokenx).toBe('^1.3.0')
    expect(cliPackageJson.dependencies?.yaml).toBe('^2.8.2')
    expect(cliPackageJson.bundleDependencies).toContain('incur')
    expect(packPublishables).toContain('resolveBundledExternalDependencies')
    expect(packPublishables).toContain('copyExternalBundledDependency')
    expect(packPublishables).toContain('stripBundledDependencyMetadata')
    expect(packPublishables).toContain("path.join(targetDir, 'package.json')")
    expect(packPublishables).toContain('shouldSkipExternalPayloadArtifact')
    expect(packPublishables).toContain("path.basename(sourcePath) === 'node_modules'")
    expect(cliPackageJson.scripts?.['release:check']).toBeUndefined()
    expect(existsSync(path.join(packageDir, 'scripts', 'release.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'release-check.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'update-changelog.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'generate-release-notes.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'verify-release-target.ts'))).toBe(false)
  })

  it.skipIf(process.env.MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS !== '1')(
    'regenerates and verifies the assistant CLI surface contract in the real release tarball',
    () => {
      const openClawBuild = spawnSync(
        'pnpm',
        ['--dir', 'packages/openclaw-plugin', 'build'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )
      expect(openClawBuild.status, openClawBuild.stderr || openClawBuild.stdout).toBe(0)

      const outDir = mkdtempSync(path.join(os.tmpdir(), 'murph-release-cli-surface-'))
      const packOutputPath = path.join(outDir, 'pack-output.json')
      const assistantDistDirectory = path.join(
        repoRoot,
        'packages',
        'assistant-engine',
        'dist',
        'assistant',
      )
      const artifactPath = path.join(
        assistantDistDirectory,
        'cli-surface-contract.generated.json',
      )
      const generatorPath = path.join(
        assistantDistDirectory,
        'generate-cli-surface-contract.js',
      )

      try {
        rmSync(artifactPath, { force: true })
        const packResult = runNodeScript(
          'scripts/pack-publishables.mjs',
          '--out-dir',
          outDir,
          '--pack-output',
          packOutputPath,
          '--clean',
        )
        expect(packResult.status, packResult.stderr || packResult.stdout).toBe(0)

        const packOutput = JSON.parse(readFileSync(packOutputPath, 'utf8')) as {
          packages: Array<{
            name: string
            tarball: string
          }>
        }
        const murphPackage = packOutput.packages.find(
          (entry) => entry.name === '@murphai/murph',
        )
        if (!murphPackage) {
          throw new Error('Release pack output is missing @murphai/murph.')
        }

        const installRoot = path.join(outDir, 'installed')
        mkdirSync(installRoot, { recursive: true })
        const tarballPath = path.resolve(repoRoot, murphPackage.tarball)
        execFileSync('tar', ['-xzf', tarballPath, '-C', installRoot], {
          cwd: repoRoot,
          env: withoutNodeV8Coverage(),
        })

        const installedAssistantDirectory = path.join(
          installRoot,
          'package',
          'node_modules',
          '@murphai',
          'assistant-engine',
          'dist',
          'assistant',
        )
        const installedArtifactPath = path.join(
          installedAssistantDirectory,
          'cli-surface-contract.generated.json',
        )
        expect(existsSync(installedArtifactPath)).toBe(true)

        const installedArtifact = JSON.parse(
          readFileSync(installedArtifactPath, 'utf8'),
        ) as {
          contract?: string
          schemaVersion?: string
        }
        expect(installedArtifact.schemaVersion).toBe(
          'murph.assistant-cli-surface-prebuilt.v3',
        )
        const index = installedArtifact.contract?.split('\nCommand index:\n')[1]
        if (!index) {
          throw new Error('Packed assistant CLI surface contract is missing its command index.')
        }
        const reconstructedCommandNames = index.split('\n').flatMap((line) => {
          const match = /^- `(?<family>[^`]+)`: (?<leaves>.+)\.$/u.exec(line)
          if (!match?.groups) {
            throw new Error(`Invalid compact command-index line: ${line}`)
          }
          const family = match.groups.family
          return [...match.groups.leaves.matchAll(/`(?<leaf>[^`]+)`/gu)].map(
            ({ groups }) => {
              if (!groups) {
                throw new Error(`Invalid compact command leaf in line: ${line}`)
              }
              return family === 'root' ? groups.leaf : `${family} ${groups.leaf}`
            },
          )
        })
        expect(reconstructedCommandNames).toContain('device account reconcile')
      } finally {
        if (!existsSync(artifactPath) && existsSync(generatorPath)) {
          execFileSync(process.execPath, [generatorPath], {
            cwd: repoRoot,
            env: withoutNodeV8Coverage(),
          })
        }
        rmSync(outDir, { force: true, recursive: true })
      }
    },
    240_000,
  )

  it('keeps release-only docs drift allowances tied to the manifest package set', () => {
    const rootDocsDrift = readFileSync(
      path.join(repoRoot, 'scripts', 'check-agent-docs-drift.sh'),
      'utf8',
    )

    expect(rootDocsDrift).toContain('scripts/release-manifest.json')
    expect(rootDocsDrift).toContain('packages/cli/CHANGELOG.md')
    expect(rootDocsDrift).toContain('package_jsons_version_only')
  })

  it('wires the workspace package cycle guard into repo verification and keeps the live graph acyclic', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const result = runNodeScript('scripts/check-workspace-package-cycles.mjs')

    expect(workspaceVerify).toContain('node "scripts/check-workspace-package-cycles.mjs"')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('Workspace package dependency cycle check passed.')
  })

  it('detects and formats workspace package dependency cycles without duplicate reports', () => {
    const cycles = detectWorkspacePackageCycles([
      {
        name: '@murphai/a',
        packageJsonPath: path.join(repoRoot, 'packages', 'a', 'package.json'),
        internalDependencies: [{ name: '@murphai/b', fields: ['dependencies'] }],
      },
      {
        name: '@murphai/b',
        packageJsonPath: path.join(repoRoot, 'packages', 'b', 'package.json'),
        internalDependencies: [{ name: '@murphai/c', fields: ['devDependencies'] }],
      },
      {
        name: '@murphai/c',
        packageJsonPath: path.join(repoRoot, 'packages', 'c', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['peerDependencies'] }],
      },
      {
        name: '@murphai/d',
        packageJsonPath: path.join(repoRoot, 'packages', 'd', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['optionalDependencies'] }],
      },
    ])

    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.packageNames).toEqual([
      '@murphai/a',
      '@murphai/b',
      '@murphai/c',
      '@murphai/a',
    ])
    expect(formatWorkspacePackageCycles(cycles, repoRoot)).toBe(
      '@murphai/a -> @murphai/b -> @murphai/c -> @murphai/a '
        + '[packages/a/package.json (dependencies) -> @murphai/b | '
        + 'packages/b/package.json (devDependencies) -> @murphai/c | '
        + 'packages/c/package.json (peerDependencies) -> @murphai/a]',
    )
  })

  it('packages only canonical vault files without runtime or export-pack residue', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-data-context-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const outputRoot = path.join(repoRoot, '.tmp-data-context')

    rmSync(outputRoot, { recursive: true, force: true })
    mkdirSync(path.join(vaultRoot, 'journal', '2026'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions'), {
      recursive: true,
    })
    mkdirSync(
      path.join(
        vaultRoot,
        '.runtime',
        'operations',
        'assistant',
        'generated-deliveries',
      ),
      { recursive: true },
    )
    mkdirSync(path.join(vaultRoot, '.runtime', 'projections'), { recursive: true })
    mkdirSync(path.join(vaultRoot, 'exports', 'assistant-deliveries'), {
      recursive: true,
    })
    mkdirSync(path.join(vaultRoot, 'exports', 'user-files'), { recursive: true })
    mkdirSync(path.join(vaultRoot, 'exports', 'packs', 'existing-pack'), { recursive: true })
    writeFileSync(path.join(vaultRoot, 'vault.json'), '{ "id": "vault_test" }\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'CORE.md'), '# Vault\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'journal', '2026', '2026-03-18.md'), '# Journal\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'MEMORY.md'),
      '# Memory\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions', 'session.json'),
      '{"sessionId":"asst_test"}\n',
      'utf8',
    )
    writeFileSync(
      path.join(
        vaultRoot,
        '.runtime',
        'operations',
        'assistant',
        'generated-deliveries',
        'transient.pdf',
      ),
      'assistant runtime staging\n',
      'utf8',
    )
    writeFileSync(path.join(vaultRoot, '.runtime', 'secret.json'), '{"token":"nope"}\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'projections', 'query.sqlite'),
      'rebuildable projection\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, 'exports', 'packs', 'existing-pack', 'manifest.json'),
      '{"packId":"existing-pack"}\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, 'exports', 'assistant-deliveries', 'base-era.pdf'),
      'ordinary pre-existing vault file\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, 'exports', 'assistant-deliveries', 'base-era.zip'),
      'globally excluded archive\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, 'exports', 'user-files', 'keep.pdf'),
      'generic export\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, 'exports', 'user-files', 'keep.zip'),
      'globally excluded archive\n',
      'utf8',
    )

    try {
      const output = execFileSync(
        'bash',
        [
          'scripts/package-data-context.sh',
          '--vault',
          vaultRoot,
          '--out-dir',
          outputRoot,
          '--name',
          'murph-test-data',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )

      expect(output).toContain('Data package created.')
      expect(output).toContain('Vault files: 5')
      expect(output).not.toContain(vaultRoot)

      const zipMatch = output.match(/^ZIP: ([^ ]+) \(/m)
      expect(zipMatch).not.toBeNull()

      const zipPath = path.join(repoRoot, zipMatch?.[1] ?? '')
      const bundleDir = path.basename(zipPath, '.zip')
      const entries = execFileSync('unzip', ['-Z1', zipPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      })
        .trim()
        .split('\n')
        .filter((entry) => entry.length > 0)

      expect(entries.filter((entry) => entry.endsWith('/'))).toEqual([])
      expect(entries).toContain(`${bundleDir}/bundle-manifest.json`)
      expect(entries).toContain(`${bundleDir}/vault/vault.json`)
      expect(entries).toContain(`${bundleDir}/vault/CORE.md`)
      expect(entries).toContain(`${bundleDir}/vault/journal/2026/2026-03-18.md`)
      expect(entries).toContain(
        `${bundleDir}/vault/exports/assistant-deliveries/base-era.pdf`,
      )
      expect(entries).toContain(`${bundleDir}/vault/exports/user-files/keep.pdf`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/exports/assistant-deliveries/base-era.zip`,
      )
      expect(entries).not.toContain(`${bundleDir}/vault/exports/user-files/keep.zip`)
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/operations/assistant/MEMORY.md`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/.runtime/operations/assistant/sessions/session.json`,
      )
      expect(entries).not.toContain(
        `${bundleDir}/vault/.runtime/operations/assistant/generated-deliveries/transient.pdf`,
      )
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/secret.json`)
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/projections/query.sqlite`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/exports/packs/existing-pack/manifest.json`,
      )
      const manifest = JSON.parse(execFileSync(
        'unzip',
        ['-p', zipPath, `${bundleDir}/bundle-manifest.json`],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      ))
      expect(manifest).toMatchObject({
        counts: {
          totalFiles: 6,
          vaultFiles: 5,
        },
        excludes: expect.arrayContaining(['.runtime/**']),
      })
      expect(manifest.excludes).toContain('*.zip')
      expect(manifest.excludes).not.toContain('exports/assistant-deliveries/**')
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
      rmSync(parentRoot, { recursive: true, force: true })
    }
  })

  it('keeps diff-aware CLI escalation behind the nested lock handoff instead of locking every test:diff run', () => {
    const workspaceVerifyScript = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )

    expect(workspaceVerifyScript).toContain('command_requires_workspace_artifact_lock()')
    expect(workspaceVerifyScript).toContain(
      'if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]] && command_requires_workspace_artifact_lock "${1:-}"; then',
    )
    expect(workspaceVerifyScript).toContain('run_verify_cli_with_workspace_artifact_lock')
    expect(workspaceVerifyScript).toContain(
      'run_timed_step "CLI targeted verification" run_verify_cli_with_workspace_artifact_lock',
    )
  })
})
