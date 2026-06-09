import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as assistantAutomation from '../src/assistant-automation.ts'
import * as assistantCodex from '../src/assistant-codex.ts'
import * as assistantChannelAdapters from '../src/assistant-channel-adapters.ts'
import * as assistantChannelRuntime from '../src/assistant-channel-runtime.ts'
import * as assistantCron from '../src/assistant-cron.ts'
import * as assistantEngineIndex from '../src/index.ts'
import * as assistantOutbox from '../src/assistant-outbox.ts'
import * as assistantProviderCatalog from '../src/assistant-provider-catalog.ts'
import * as assistantProvider from '../src/assistant-provider.ts'
import * as assistantRuntime from '../src/assistant-runtime.ts'
import * as assistantService from '../src/assistant-service.ts'
import * as assistantState from '../src/assistant-state.ts'
import * as assistantStatus from '../src/assistant-status.ts'
import * as assistantStore from '../src/assistant-store.ts'
import * as codexLifecycle from '../src/codex-lifecycle.ts'
import * as knowledge from '../src/knowledge.ts'

const wrapperCases = [
  [
    'assistant-automation',
    assistantAutomation,
    [
      'runAssistantAutomation',
      'scanAssistantAutomationOnce',
      'clearAssistantAutomationRunLock',
    ],
  ],
  [
    'assistant-codex',
    assistantCodex,
    [
      'buildCodexAppServerArgs',
      'executeCodexAppServerTurn',
      'listMurphDynamicToolNames',
      'resolveCodexDisplayOptions',
    ],
  ],
  [
    'assistant-channel-adapters',
    assistantChannelAdapters,
    [
      'getAssistantChannelAdapter',
      'startLinqTypingIndicator',
      'startTelegramTypingIndicator',
    ],
  ],
  [
    'assistant-channel-runtime',
    assistantChannelRuntime,
    [
      'sendLinqMessage',
      'sendTelegramMessage',
      'startLinqTypingIndicator',
      'startTelegramTypingIndicator',
    ],
  ],
  [
    'assistant-cron',
    assistantCron,
    [
      'addAssistantCronJob',
      'getAssistantCronPresetDefinition',
      'upsertAssistantCronAutomation',
    ],
  ],
  [
    'assistant-outbox',
    assistantOutbox,
    [
      'createAssistantOutboxIntent',
      'deliverAssistantOutboxMessage',
      'drainAssistantOutbox',
    ],
  ],
  [
    'assistant-provider-catalog',
    assistantProviderCatalog,
    [
      'DEFAULT_CODEX_CHAT_MODEL_OPTIONS',
      'DEFAULT_CODEX_REASONING_OPTIONS',
      'resolveCodexModelCatalog',
      'resolveCodexTargetCapabilities',
    ],
  ],
  [
    'assistant-provider',
    assistantProvider,
    [
      'annotateRecoveredCodexThreadIdForDiagnostics',
      'isAssistantProviderConnectionLostError',
    ],
  ],
  [
    'assistant-runtime',
    assistantRuntime,
    [
      'runAssistantAutomation',
      'addAssistantCronJob',
      'createAssistantOutboxIntent',
      'openAssistantConversation',
      'getAssistantStatus',
      'redactAssistantStateString',
    ],
  ],
  [
    'assistant-service',
    assistantService,
    [
      'openAssistantConversation',
      'sendAssistantMessage',
      'updateAssistantSessionOptions',
    ],
  ],
  [
    'assistant-state',
    assistantState,
    [
      'createAssistantRuntimeStateService',
      'withAssistantRuntimeWriteLock',
      'assertAssistantSessionId',
      'resolveAssistantSessionPath',
    ],
  ],
  [
    'assistant-status',
    assistantStatus,
    [
      'getAssistantStatus',
      'refreshAssistantStatusSnapshot',
    ],
  ],
  [
    'assistant-store',
    assistantStore,
    [
      'resolveAssistantSession',
      'listAssistantSessions',
      'saveAssistantSession',
    ],
  ],
  [
    'codex-lifecycle',
    codexLifecycle,
    [
      'snapshotExpectedCodexRootProcess',
      'stopWarmCodexAppServer',
    ],
  ],
  [
    'knowledge',
    knowledge,
    [
      'getKnowledgePage',
      'rebuildKnowledgeIndex',
      'upsertKnowledgePage',
      'listKnowledgePages',
      'searchKnowledgePages',
      'lintKnowledgePages',
      'tailKnowledgeLog',
    ],
  ],
  [
      'index',
    assistantEngineIndex,
    [
      'runAssistantAutomation',
      'sanitizeChildProcessEnv',
      'deliverAssistantMessage',
    ],
  ],
] as const

function expectNamedExports(
  moduleName: string,
  moduleExports: object,
  expectedExports: readonly string[],
): void {
  const exportedNames = Object.keys(moduleExports)

  expect(exportedNames.length, `${moduleName} should expose runtime exports`).toBeGreaterThan(0)

  for (const exportName of expectedExports) {
    expect(exportedNames, `${moduleName} should export ${exportName}`).toContain(exportName)
    expect(
      Reflect.get(moduleExports, exportName),
      `${moduleName} should provide ${exportName} at runtime`,
    ).toBeDefined()
  }
}

describe('assistant-engine wrapper exports', () => {
  it('does not expose implementation-shaped assistant/* public subpaths', async () => {
    const packageManifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports?: Record<string, { default?: string; types?: string } | undefined>
    }

    const implementationShapedAssistantExports = Object.keys(
      packageManifest.exports ?? {},
    ).filter((exportKey) => exportKey.startsWith('./assistant/'))

    expect(implementationShapedAssistantExports).toEqual([])
  })

  it('keeps raw provider execution and catalog internals off the public facades', async () => {
    const assistantProviderSource = await readFile(
      new URL('../src/assistant-provider.ts', import.meta.url),
      'utf8',
    )
    const assistantProviderCatalogSource = await readFile(
      new URL('../src/assistant/provider-catalog.ts', import.meta.url),
      'utf8',
    )

    expect(assistantProviderSource).not.toContain(
      'AssistantProviderTurnExecutionResult',
    )
    expect(assistantProviderSource).not.toContain('AssistantProviderUsage')
    expect(assistantProviderSource).not.toContain('provider-traces.js')
    expect(assistantProviderSource).not.toContain('provider-progress.js')
    expect(assistantProviderCatalogSource).not.toContain(
      'export type {\n  AssistantCatalogModel',
    )
  })

  for (const [moduleName, moduleExports, expectedExports] of wrapperCases) {
    it(`exposes the ${moduleName} public surface`, () => {
      expectNamedExports(moduleName, moduleExports, expectedExports)
    })
  }
})
