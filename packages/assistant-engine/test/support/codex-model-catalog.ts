import { execFile, execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function writeHostedOpenAiMixedModeModelCatalogJson(input: {
  codexCommand: string
  directory: string
  astraAllowed?: boolean
}): Promise<string> {
  const { stdout } = await execFileAsync(input.codexCommand, ['debug', 'models', '--bundled'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const dockerfile = await readFile(new URL('../../../../Dockerfile.cloudflare-hosted-runner', import.meta.url), 'utf8')
  const patchFilter = /\| jq '([^']+)'/u.exec(dockerfile)?.[1]
  const standardFilter = /&& jq '([^']+)' \/tmp\/murph-codex-model-catalog\.openai-flex\.json/u.exec(dockerfile)?.[1]
  if (!patchFilter || !standardFilter) throw new Error('Image catalog filters are missing.')
  const catalogJson = execFileSync('jq', [
    input.astraAllowed ? patchFilter : `${patchFilter} | ${standardFilter}`,
  ], { input: stdout, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const modelCatalogJson = path.join(input.directory, 'codex-model-catalog.openai-flex.json')
  await writeFile(modelCatalogJson, catalogJson, { encoding: 'utf8', mode: 0o600 })
  return modelCatalogJson
}
