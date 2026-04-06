import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineProject } from 'vitest/config'

import {
  createVitestWorkspaceRuntimeAliases,
  resolveWorkspaceSourceEntries,
} from '../../config/workspace-source-resolution.js'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS = {
  '@murphai/assistant-cli': './src/index.ts',
  '@murphai/assistant-engine': '../assistant-engine/src/index.ts',
  '@murphai/assistantd': '../assistantd/src/index.ts',
  '@murphai/operator-config': '../operator-config/src/index.ts',
  '@murphai/runtime-state': '../runtime-state/src/index.ts',
} as const

export default defineProject({
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(
      resolveWorkspaceSourceEntries(packageDir, WORKSPACE_SOURCE_ENTRY_RELATIVE_PATHS),
    ),
  },
  test: {
    name: 'assistant-cli',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
})
