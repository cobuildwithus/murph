import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as assistantAutomation from '../src/assistant-automation.ts'
import * as assistantCodex from '../src/assistant-codex.ts'
import * as assistantChannelAdapters from '../src/assistant-channel-adapters.ts'
import * as assistantCliTools from '../src/assistant-cli-tools.ts'
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
    'assistant-cli-tools',
    assistantCliTools,
    [
      'createDefaultAssistantToolCatalog',
      'createProviderTurnAssistantCapabilityRuntime',
      'readAssistantCliLlmsManifest',
    ],
  ],
  [
    'assistant-cron',
    assistantCron,
    [
      'addAssistantCronJob',
      'getAssistantCronPresetDefinition',
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
      'DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS',
      'resolveAssistantModelCatalog',
      'discoverAssistantProviderModels',
    ],
  ],
  [
    'assistant-provider',
    assistantProvider,
    [
      'ASSISTANT_PROVIDER_DEFINITIONS',
      'listAssistantProviders',
      'recoverAssistantSessionAfterProviderFailure',
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
      'assistantGatewayLocalProjectionSourceReader',
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

  for (const [moduleName, moduleExports, expectedExports] of wrapperCases) {
    it(`exposes the ${moduleName} public surface`, () => {
      expectNamedExports(moduleName, moduleExports, expectedExports)
    })
  }
})
