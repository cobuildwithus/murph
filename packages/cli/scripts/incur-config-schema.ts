import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
export const incurGeneratedTypesPath = path.join(packageDir, 'src', 'incur.generated.ts')

interface GeneratedIncurOutputs {
  configSchema: string
  types: string
}

interface IncurGenerationOptions {
  rebuildCli?: boolean
}

interface GeneratedIncurArtifacts {
  generatedTypesPath: string
  generatedConfigSchemaPath: string
}

export async function generateIncurConfigSchema(
  options: IncurGenerationOptions = {},
): Promise<string> {
  return (await generateIncurArtifacts(options)).configSchema
}

export async function generateIncurTypes(
  options: IncurGenerationOptions = {},
): Promise<string> {
  return (await generateIncurArtifacts(options)).types
}

export async function generateIncurArtifacts(
  options: IncurGenerationOptions = {},
): Promise<GeneratedIncurOutputs> {
  return withGeneratedIncurArtifacts(
    options,
    async ({ generatedConfigSchemaPath, generatedTypesPath }) => ({
      configSchema: await readFile(generatedConfigSchemaPath, 'utf8'),
      types: await readFile(generatedTypesPath, 'utf8'),
    }),
  )
}

async function withGeneratedIncurArtifacts<T>(
  options: IncurGenerationOptions,
  run: (artifacts: GeneratedIncurArtifacts) => Promise<T>,
): Promise<T> {
  if (!existsSync(incurBinPath)) {
    throw new Error(
      'Missing local incur binary. Run pnpm install --frozen-lockfile before generating CLI artifacts.',
    )
  }

  if ((options.rebuildCli ?? true) || !existsSync(distEntryPath)) {
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

    return await run({
      generatedTypesPath,
      generatedConfigSchemaPath,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
