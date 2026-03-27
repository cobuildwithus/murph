import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantStatePaths } from './store.js'

const ASSISTANT_PROVIDER_WORKSPACE_DIRECTORY = 'workspaces'
const ASSISTANT_PROVIDER_WORKSPACE_README = 'README.md'

export async function resolveAssistantProviderWorkingDirectory(input: {
  requestedWorkingDirectory: string
  sessionId: string
  vault: string
}): Promise<string> {
  const absoluteVaultRoot = path.resolve(input.vault)
  const requestedWorkingDirectory = path.resolve(input.requestedWorkingDirectory)

  if (!isPathWithinDirectory(absoluteVaultRoot, requestedWorkingDirectory)) {
    return requestedWorkingDirectory
  }

  const paths = resolveAssistantStatePaths(absoluteVaultRoot)
  const workspaceRoot = path.join(
    paths.assistantStateRoot,
    ASSISTANT_PROVIDER_WORKSPACE_DIRECTORY,
    input.sessionId,
  )
  const readmePath = path.join(workspaceRoot, ASSISTANT_PROVIDER_WORKSPACE_README)
  const readme = buildAssistantProviderWorkspaceReadme()

  await mkdir(workspaceRoot, { recursive: true })
  if ((await readExistingWorkspaceReadme(readmePath)) !== readme) {
    await writeFile(readmePath, readme, 'utf8')
  }

  return workspaceRoot
}

function buildAssistantProviderWorkspaceReadme(): string {
  return [
    '# Healthy Bob assistant workspace',
    '',
    'This session runs in an isolated assistant workspace so the live vault is not the writable model workspace.',
    'Use `vault-cli` or other Healthy Bob assistant tools for canonical vault reads and writes.',
    '',
    'The real bound vault is supplied through the `VAULT` environment variable and assistant tooling.',
    'Do not treat direct file edits in this workspace as canonical vault changes.',
  ].join('\n')
}

function isPathWithinDirectory(parentDirectory: string, candidatePath: string): boolean {
  return (
    candidatePath === parentDirectory ||
    candidatePath.startsWith(`${parentDirectory}${path.sep}`)
  )
}

async function readExistingWorkspaceReadme(
  readmePath: string,
): Promise<string | null> {
  try {
    return await readFile(readmePath, 'utf8')
  } catch {
    return null
  }
}
