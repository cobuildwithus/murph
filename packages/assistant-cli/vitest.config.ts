import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import {
  createMurphVitestCoverage,
  resolveMurphVitestCoverageProviderModule,
} from '../../config/vitest-coverage.js'
import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from '../../config/workspace-source-resolution.js'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  '@murphai/assistant-cli': './src/index.ts',
  '@murphai/assistant-engine': '../assistant-engine/src/index.ts',
  '@murphai/assistantd': '../assistantd/src/index.ts',
  '@murphai/inbox-services': '../inbox-services/src/index.ts',
  '@murphai/operator-config': '../operator-config/src/index.ts',
  '@murphai/runtime-state': '../runtime-state/src/index.ts',
  '@murphai/vault-usecases': '../vault-usecases/src/index.ts',
} as const

export default defineConfig({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    name: 'assistant-cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: createMurphVitestCoverage({
      customProviderModule: resolveMurphVitestCoverageProviderModule(packageDir),
      include: ['src/assistant-runtime.ts'],
    }),
  },
})
