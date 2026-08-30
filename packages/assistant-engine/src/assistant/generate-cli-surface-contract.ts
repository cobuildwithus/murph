import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assistantCliSurfacePrebuiltArtifactFileName,
  assistantCliSurfacePrebuiltSchemaVersion,
  buildAssistantCliSurfaceContract,
  type AssistantCliSurfacePrebuiltArtifact,
} from './cli-surface-bootstrap.js'
import { readAssistantCliLlmsFullManifest } from './cli-surface-manifest.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(moduleDirectory, '../../../..')
const artifactPath = path.join(
  moduleDirectory,
  assistantCliSurfacePrebuiltArtifactFileName,
)
const manifestTimeoutMs = readManifestTimeoutMs(process.argv.slice(2))

const manifest = await readAssistantCliLlmsFullManifest({
  timeoutMs: manifestTimeoutMs,
  workingDirectory: workspaceRoot,
})
const contract = buildAssistantCliSurfaceContract(manifest)

if (!contract) {
  throw new Error('Could not render the assistant CLI surface contract.')
}

const artifact: AssistantCliSurfacePrebuiltArtifact = {
  contract,
  schemaVersion: assistantCliSurfacePrebuiltSchemaVersion,
}

await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

function readManifestTimeoutMs(args: readonly string[]): number | undefined {
  if (args.length === 0) {
    return undefined
  }

  const [flag, rawTimeoutMs] = args
  const timeoutMs = Number(rawTimeoutMs)
  if (
    args.length !== 2 ||
    flag !== '--manifest-timeout-ms' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error(
      'Usage: generate-cli-surface-contract.js [--manifest-timeout-ms <positive-integer>]',
    )
  }

  return timeoutMs
}
