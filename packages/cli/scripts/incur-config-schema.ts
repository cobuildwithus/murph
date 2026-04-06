import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
const repoDir = fileURLToPath(new URL('../../../', import.meta.url))
const distEntryPath = path.join(packageDir, 'dist', 'index.js')
const incurBinPath = path.join(packageDir, 'node_modules', 'incur', 'dist', 'bin.js')

export const configSchemaPath = path.join(packageDir, 'config.schema.json')

export async function generateIncurConfigSchema(): Promise<string> {
  if (!existsSync(incurBinPath)) {
    throw new Error(
      'Missing local incur binary. Run pnpm install --frozen-lockfile before generating the CLI config schema.',
    )
  }

  if (!existsSync(distEntryPath)) {
    await execFileAsync('pnpm', ['build'], {
      cwd: packageDir,
      env: process.env,
    })
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-incur-gen-'))

  try {
    const generatedTypesPath = path.join(tempDir, 'incur.generated.ts')
    const generatedConfigSchemaPath = path.join(tempDir, 'config.schema.json')

    await execFileAsync(
      process.execPath,
      [
        incurBinPath,
        'gen',
        '--dir',
        repoDir,
        '--entry',
        distEntryPath,
        '--output',
        generatedTypesPath,
      ],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
        },
      },
    )

    return await readFile(generatedConfigSchemaPath, 'utf8')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
