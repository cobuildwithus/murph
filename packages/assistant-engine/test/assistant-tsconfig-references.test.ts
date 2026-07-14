import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const sourceDir = path.join(packageDir, 'src')
const tsconfigPath = path.join(packageDir, 'tsconfig.json')

// Keep this list explicit when assistant-engine intentionally needs a project
// reference for dynamic-import-only or packaging-only edges.
const ALLOWED_REFERENCE_ONLY_PACKAGES = new Set<string>()
const ALLOWED_SOURCE_ONLY_PACKAGES = new Set<string>()

type TsConfigReference = {
  path: string
}

type AssistantEngineTsConfig = {
  references?: TsConfigReference[]
}

async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return listTypeScriptFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
    }),
  )

  return nested.flat()
}

function readWorkspacePackageName(specifier: string): string | null {
  const match = /^(@murphai\/[^/]+)/u.exec(specifier)
  return match?.[1] ?? null
}

function collectWorkspaceImportsFromSourceFile(filePath: string, sourceText: string): Set<string> {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const importedPackages = new Set<string>()

  const recordSpecifier = (specifier: string): void => {
    const workspacePackageName = readWorkspacePackageName(specifier)
    if (workspacePackageName) {
      importedPackages.add(workspacePackageName)
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node)
    ) {
      const specifier = node.moduleSpecifier
      if (specifier && ts.isStringLiteral(specifier)) {
        recordSpecifier(specifier.text)
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument && ts.isStringLiteral(argument)) {
        recordSpecifier(argument.text)
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      if (
        ts.isLiteralTypeNode(argument) &&
        ts.isStringLiteral(argument.literal)
      ) {
        recordSpecifier(argument.literal.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return importedPackages
}

async function collectAssistantEngineWorkspaceImports(): Promise<Set<string>> {
  const importedPackages = new Set<string>()
  const sourceFiles = await listTypeScriptFiles(sourceDir)

  for (const filePath of sourceFiles) {
    const sourceText = await readFile(filePath, 'utf8')
    for (const packageName of collectWorkspaceImportsFromSourceFile(filePath, sourceText)) {
      importedPackages.add(packageName)
    }
  }

  return importedPackages
}

async function resolveWorkspacePackageNameFromReference(referencePath: string): Promise<string> {
  const resolvedReferencePath = path.resolve(packageDir, referencePath)
  let currentPath = resolvedReferencePath

  if (path.extname(currentPath)) {
    currentPath = path.dirname(currentPath)
  }

  while (currentPath.startsWith(repoRoot)) {
    const manifestPath = path.join(currentPath, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
      if (manifest.name?.startsWith('@murphai/')) {
        return manifest.name
      }
    } catch {
      // Keep walking upward until we find the owning workspace package root.
    }

    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }

  throw new Error(`Could not resolve workspace package name for tsconfig reference "${referencePath}".`)
}

async function readAssistantEngineTsconfigReferences(): Promise<Set<string>> {
  const rawConfig = JSON.parse(await readFile(tsconfigPath, 'utf8')) as AssistantEngineTsConfig
  const referencePackages = new Set<string>()

  for (const reference of rawConfig.references ?? []) {
    referencePackages.add(await resolveWorkspacePackageNameFromReference(reference.path))
  }

  return referencePackages
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

describe('assistant-engine tsconfig references', () => {
  it('tracks direct src workspace imports with only explicit reference-only exceptions', async () => {
    const sourceImportPackages = await collectAssistantEngineWorkspaceImports()
    const tsconfigReferencePackages = await readAssistantEngineTsconfigReferences()

    const unexpectedReferenceOnlyPackages = sorted(
      [...tsconfigReferencePackages].filter(
        (packageName) =>
          !sourceImportPackages.has(packageName) &&
          !ALLOWED_REFERENCE_ONLY_PACKAGES.has(packageName),
      ),
    )
    const missingReferencePackages = sorted(
      [...sourceImportPackages].filter(
        (packageName) =>
          !tsconfigReferencePackages.has(packageName) &&
          !ALLOWED_SOURCE_ONLY_PACKAGES.has(packageName),
      ),
    )
    const staleReferenceOnlyAllowlistEntries = sorted(
      [...ALLOWED_REFERENCE_ONLY_PACKAGES].filter(
        (packageName) =>
          sourceImportPackages.has(packageName) ||
          !tsconfigReferencePackages.has(packageName),
      ),
    )
    const staleSourceOnlyAllowlistEntries = sorted(
      [...ALLOWED_SOURCE_ONLY_PACKAGES].filter(
        (packageName) =>
          tsconfigReferencePackages.has(packageName) ||
          !sourceImportPackages.has(packageName),
      ),
    )

    expect(
      unexpectedReferenceOnlyPackages,
      `Unexpected assistant-engine tsconfig project references: ${unexpectedReferenceOnlyPackages.join(', ') || 'none'}`,
    ).toEqual([])
    expect(
      missingReferencePackages,
      `Missing assistant-engine tsconfig project references for direct src imports: ${missingReferencePackages.join(', ') || 'none'}`,
    ).toEqual([])
    expect(
      staleReferenceOnlyAllowlistEntries,
      `Stale assistant-engine reference-only allowlist entries: ${staleReferenceOnlyAllowlistEntries.join(', ') || 'none'}`,
    ).toEqual([])
    expect(
      staleSourceOnlyAllowlistEntries,
      `Stale assistant-engine source-only allowlist entries: ${staleSourceOnlyAllowlistEntries.join(', ') || 'none'}`,
    ).toEqual([])
  })
})
