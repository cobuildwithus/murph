import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Cli } from 'incur'

const execFileAsync = promisify(execFile)
const INCUR_GENERATION_TIMEOUT_MS = 5 * 60_000

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
const repoDir = fileURLToPath(new URL('../../../', import.meta.url))
const distEntryPath = path.join(packageDir, 'dist', 'index.js')
const incurPackageDir = path.join(packageDir, 'node_modules', 'incur')

export const configSchemaPath = path.join(packageDir, 'config.schema.json')
export const incurGeneratedTypesPath = path.join(packageDir, 'src', 'incur.generated.ts')
export const vaultCliSkillHashPath = path.join(
  packageDir,
  'src',
  'vault-cli-skill-hash.generated.ts',
)

interface GeneratedIncurOutputs {
  configSchema: string
  skillHashModule: string
  types: string
}

interface IncurGenerationOptions {
  onStage?: (message: string) => void
  rebuildCli?: boolean
}

interface IncurGeneratorCommandOptions {
  cwd: string
  entryPath: string
  generatorPath: string
  outputPath: string
  repoDir: string
  timeoutMs: number
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
      skillHashModule: renderSkillHashModule(await readBuiltCliSkillHash()),
      types: quoteInvalidTypePropertyNames(await readFile(generatedTypesPath, 'utf8')),
    }),
  )
}

async function withGeneratedIncurArtifacts<T>(
  options: IncurGenerationOptions,
  run: (artifacts: GeneratedIncurArtifacts) => Promise<T>,
): Promise<T> {
  const incurBinPath = await resolveInstalledIncurBinPath()

  if ((options.rebuildCli ?? true) || !existsSync(distEntryPath)) {
    options.onStage?.('Building the CLI package.')
    await prepareBuiltCliRuntime()
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-incur-gen-'))

  try {
    const generatedTypesPath = path.join(tempDir, 'incur.generated.ts')
    const generatedConfigSchemaPath = path.join(tempDir, 'config.schema.json')

    options.onStage?.('Generating Incur types and config schema (timeout: 5 minutes).')
    await runIncurGeneratorCommand({
      cwd: packageDir,
      entryPath: distEntryPath,
      generatorPath: incurBinPath,
      outputPath: generatedTypesPath,
      repoDir,
      timeoutMs: INCUR_GENERATION_TIMEOUT_MS,
    })

    options.onStage?.('Finalizing generated artifacts and CLI skill hash.')
    return await run({
      generatedTypesPath,
      generatedConfigSchemaPath,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function resolveInstalledIncurBinPath(): Promise<string> {
  let packageManifest: unknown

  try {
    packageManifest = JSON.parse(
      await readFile(path.join(incurPackageDir, 'package.json'), 'utf8'),
    )
  } catch {
    throw new Error(
      'Missing or invalid local incur package manifest. Run pnpm install --frozen-lockfile before generating CLI artifacts.',
    )
  }

  const generatorPath = resolveIncurBinPathFromManifest(
    incurPackageDir,
    packageManifest,
  )

  if (!existsSync(generatorPath)) {
    throw new Error(
      'The installed incur package declares a missing bin.incur target. Reinstall the frozen workspace dependencies before generating CLI artifacts.',
    )
  }

  return generatorPath
}

export function resolveIncurBinPathFromManifest(
  packageDirectory: string,
  packageManifest: unknown,
): string {
  if (
    typeof packageManifest !== 'object' ||
    packageManifest === null ||
    !('bin' in packageManifest)
  ) {
    throw new Error('The installed incur package manifest must declare bin.incur.')
  }

  const { bin } = packageManifest
  if (
    typeof bin !== 'object' ||
    bin === null ||
    !('incur' in bin) ||
    typeof bin.incur !== 'string' ||
    bin.incur.trim() === ''
  ) {
    throw new Error('The installed incur package manifest must declare bin.incur.')
  }

  const packageRoot = path.resolve(packageDirectory)
  if (path.isAbsolute(bin.incur)) {
    throw new Error(
      'The installed incur package bin.incur target must be package-relative and stay inside its package.',
    )
  }
  const generatorPath = path.resolve(packageRoot, bin.incur)
  const relativePath = path.relative(packageRoot, generatorPath)

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      'The installed incur package bin.incur target must be package-relative and stay inside its package.',
    )
  }

  return generatorPath
}

export async function prepareBuiltCliRuntime(): Promise<void> {
  await execFileAsync('pnpm', ['build:test-runtime:prepared'], {
    cwd: repoDir,
    env: process.env,
  })
}

export async function runIncurGeneratorCommand(
  options: IncurGeneratorCommandOptions,
): Promise<void> {
  try {
    await execFileAsync(
      process.execPath,
      [
        options.generatorPath,
        'gen',
        '--dir',
        options.repoDir,
        '--entry',
        options.entryPath,
        '--output',
        options.outputPath,
      ],
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
        },
        killSignal: 'SIGTERM',
        timeout: options.timeoutMs,
      },
    )
  } catch (error) {
    if (isTimedOutExecFileError(error)) {
      const timeoutSeconds = Math.max(1, Math.ceil(options.timeoutMs / 1_000))
      const unit = timeoutSeconds === 1 ? 'second' : 'seconds'
      throw new Error(
        `Incur CLI artifact generation timed out after ${timeoutSeconds} ${unit} while importing the built CLI. ` +
          'Re-run `pnpm --dir packages/cli gen:config-schema` on a prepared workspace; if it repeats, inspect the package build and CLI import graph.',
      )
    }
    throw error
  }
}

function isTimedOutExecFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'killed' in error &&
    error.killed === true &&
    'signal' in error &&
    error.signal === 'SIGTERM'
  )
}

function quoteInvalidTypePropertyNames(types: string): string {
  return types.replace(
    /([;{]\s*)([A-Za-z_$][\w$]*(?:-[A-Za-z_$][\w$]*)+)(\??:)/gu,
    (_match, prefix: string, propertyName: string, suffix: string) =>
      `${prefix}${JSON.stringify(propertyName)}${suffix}`,
  )
}

async function readBuiltCliSkillHash(): Promise<string> {
  const cliModule = await import(pathToFileURL(distEntryPath).href) as {
    default: Cli.Cli
  }
  return Cli.skillHash(cliModule.default)
}

function renderSkillHashModule(skillHash: string): string {
  return [
    '// Generated by scripts/generate-incur-config-schema.ts. Do not edit.',
    `export const VAULT_CLI_SKILL_HASH = ${JSON.stringify(skillHash)}`,
    '',
  ].join('\n')
}
