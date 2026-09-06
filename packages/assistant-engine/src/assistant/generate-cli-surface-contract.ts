import { writeFile } from 'node:fs/promises'

import {
  assistantCliSurfacePrebuiltSchemaVersion,
  buildAssistantCliSurfaceContract,
  type AssistantCliSurfacePrebuiltArtifact,
} from './cli-surface-bootstrap.js'
import { readAssistantCliLlmsFullManifestFromCliEntry } from './cli-surface-manifest.js'

export async function generateAssistantCliSurfaceContract(input: {
  artifactPath: string
  cliEntryPath: string
  workingDirectory: string
}): Promise<void> {
  const manifest = await readAssistantCliLlmsFullManifestFromCliEntry({
    cliEntryPath: input.cliEntryPath,
    workingDirectory: input.workingDirectory,
  })
  const contract = buildAssistantCliSurfaceContract(manifest)

  if (!contract) {
    throw new Error('Could not render the assistant CLI surface contract.')
  }

  const artifact: AssistantCliSurfacePrebuiltArtifact = {
    contract,
    schemaVersion: assistantCliSurfacePrebuiltSchemaVersion,
  }

  await writeFile(
    input.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  )
}
