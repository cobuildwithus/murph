import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assistantCliSurfacePrebuiltArtifactFileName,
  assistantCliSurfacePrebuiltSchemaVersion,
  buildAssistantCliSurfaceContract,
  hashAssistantCliSurfaceManifest,
  type AssistantCliSurfacePrebuiltArtifact,
} from './cli-surface-bootstrap.js'
import { readAssistantCliLlmsManifest } from './cli-surface-manifest.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(moduleDirectory, '../../../..')
const artifactPath = path.join(
  moduleDirectory,
  assistantCliSurfacePrebuiltArtifactFileName,
)

const manifest = await readAssistantCliLlmsManifest({
  workingDirectory: workspaceRoot,
})
const contract = buildAssistantCliSurfaceContract(manifest)

if (!contract) {
  throw new Error('Could not render the assistant CLI surface contract.')
}

const artifact: AssistantCliSurfacePrebuiltArtifact = {
  contract,
  manifestFingerprint: hashAssistantCliSurfaceManifest(manifest),
  schemaVersion: assistantCliSurfacePrebuiltSchemaVersion,
}

await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
