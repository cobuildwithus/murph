import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageJsonShape {
  main?: string
  types?: string
  bin?: Record<string, string>
  exports?: {
    '.': {
      default?: string
      types?: string
    }
  }
  scripts?: Record<string, string | undefined>
}

interface TsConfigShape {
  extends?: string
  compilerOptions?: {
    declaration?: boolean
    noEmit?: boolean
    outDir?: string
    rootDir?: string
  }
  include?: string[]
}

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(
  await readFile(path.join(packageDir, 'package.json'), 'utf8'),
) as PackageJsonShape
const tsconfig = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.json'), 'utf8'),
) as TsConfigShape
const tsconfigBuild = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.build.json'), 'utf8'),
) as TsConfigShape
const tsconfigTypecheck = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.typecheck.json'), 'utf8'),
) as TsConfigShape
const packageLocalTsFiles = await listFiles(packageDir, ['src', 'scripts', 'test'])

assert(
  packageJson.main === './dist/index.js',
  'package.json must expose ./dist/index.js as main.',
)
assert(
  packageJson.types === './dist/index.d.ts',
  'package.json must expose ./dist/index.d.ts as types.',
)
assert(
  packageJson.bin?.['vault-cli'] === 'dist/bin.js',
  'package.json must expose vault-cli from dist/bin.js.',
)
assert(
  packageJson.exports?.['.']?.default === './dist/index.js',
  'package.json exports must target dist/index.js.',
)
assert(
  packageJson.exports?.['.']?.types === './dist/index.d.ts',
  'package.json exports must target dist/index.d.ts for types.',
)
assert(
  packageJson.scripts?.build &&
    packageJson.scripts?.typecheck &&
    packageJson.scripts?.test,
  'package.json must define build, typecheck, and test scripts.',
)
assert(
  !Object.values(packageJson.scripts ?? {}).some((script) => script?.includes('.mjs')),
  'package.json package-local scripts must not point at legacy .mjs files.',
)
assert(
  tsconfig.extends === '../../tsconfig.base.json',
  'tsconfig.json must extend ../../tsconfig.base.json.',
)
assert(
  tsconfig.compilerOptions?.outDir === 'dist',
  'tsconfig.json must emit into dist.',
)
assert(
  tsconfig.compilerOptions?.rootDir === 'src',
  'tsconfig.json must compile from src.',
)
assert(
  tsconfig.compilerOptions?.declaration === undefined ||
    tsconfig.compilerOptions.declaration === true,
  'tsconfig.json must preserve declaration output from the shared base config.',
)
assert(
  tsconfigBuild.extends === './tsconfig.json',
  'tsconfig.build.json must extend ./tsconfig.json.',
)
assert(
  tsconfigTypecheck.extends === '../../tsconfig.base.json',
  'tsconfig.typecheck.json must extend ../../tsconfig.base.json.',
)
assert(
  tsconfigTypecheck.compilerOptions?.rootDir === '.',
  'tsconfig.typecheck.json must typecheck from the package root.',
)
assert(
  tsconfigTypecheck.compilerOptions?.noEmit === true,
  'tsconfig.typecheck.json must stay noEmit.',
)
assert(
  tsconfigTypecheck.include?.includes('scripts/**/*.ts') &&
    tsconfigTypecheck.include?.includes('test/**/*.ts'),
  'tsconfig.typecheck.json must include package-local scripts and tests.',
)

for (const filePath of packageLocalTsFiles) {
  const source = await readFile(filePath, 'utf8')
  assert(
    !/\.\.\/\.\.\/[^"'`]+\/src\//u.test(source),
    `${path.relative(packageDir, filePath)} still reaches into another package's src tree.`,
  )
}

const libraryEntry = await readFile(path.join(packageDir, 'src/index.ts'), 'utf8')
assert(
  !/\.serve\(\)/u.test(libraryEntry),
  'src/index.ts must stay import-safe and avoid serving the CLI on package import.',
)

console.log('packages/cli package shape verified.')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function listFiles(
  packageRoot: string,
  directories: string[],
): Promise<string[]> {
  const files: string[] = []

  for (const directory of directories) {
    files.push(...(await listFilesRecursive(path.join(packageRoot, directory))))
  }

  return files
}

async function listFilesRecursive(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}
