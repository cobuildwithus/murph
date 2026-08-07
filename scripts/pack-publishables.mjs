import { cp, copyFile, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  clonePackageJsonWithResolvedWorkspaceVersions,
  loadReleaseContext,
  parseReleaseArgs,
  resolveBundledExternalDependencies,
  resolveBundledWorkspaceDependencies,
  validateReleaseContext,
  writeJson,
} from './release-helpers.mjs';
import { verifyReleaseArtifacts } from './release-artifact-secret-guard.mjs';

const execFileAsync = promisify(execFile);
const npmPackMetadataMaxBufferBytes = 64 * 1024 * 1024;
const assistantCliSurfaceGeneratorPath = path.join(
  'packages',
  'assistant-engine',
  'dist',
  'assistant',
  'generate-cli-surface-contract.js',
);
const murphAssistantCliSurfaceTarballPath = path.posix.join(
  'node_modules',
  '@murphai',
  'assistant-engine',
  'dist',
  'assistant',
  'cli-surface-contract.generated.json',
);

function normalizePackResult(rawValue) {
  if (!rawValue || rawValue.length === 0) {
    return null;
  }

  const trimmed = rawValue.trim();
  const jsonStart = Math.max(trimmed.lastIndexOf('\n['), trimmed.lastIndexOf('\n{'));
  const candidate = jsonStart >= 0 ? trimmed.slice(jsonStart + 1) : trimmed;
  const parsed = JSON.parse(candidate);
  return Array.isArray(parsed) ? parsed.at(-1) ?? null : parsed;
}

function verifyRequiredPackedArtifacts(entry, packResult) {
  if (entry.name !== '@murphai/murph') {
    return;
  }

  const packedFilePaths = new Set(
    Array.isArray(packResult?.files)
      ? packResult.files
        .map((file) => file?.path)
        .filter((filePath) => typeof filePath === 'string')
      : [],
  );
  if (!packedFilePaths.has(murphAssistantCliSurfaceTarballPath)) {
    throw new Error(
      `Cannot pack ${entry.name}: missing generated assistant CLI surface contract at ${murphAssistantCliSurfaceTarballPath}.`,
    );
  }
}

async function tgzFiles(directoryPath) {
  try {
    const entries = await readdir(directoryPath);
    return entries.filter((entry) => entry.endsWith('.tgz')).sort();
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function stageDirectoryName(packageName) {
  return packageName.replace(/^@/u, '').replace(/\//gu, '__');
}

function shouldSkipPayloadArtifact(sourcePath) {
  return path.basename(sourcePath).endsWith('.tsbuildinfo');
}

function shouldSkipExternalPayloadArtifact(sourcePath) {
  return path.basename(sourcePath) === 'node_modules' || shouldSkipPayloadArtifact(sourcePath);
}

function isNonRuntimeIncurPayloadPath(relativePath) {
  return /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$/u.test(relativePath);
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function copyPayloadPath(sourcePath, targetPath, options = {}) {
  const shouldSkip = options.shouldSkip ?? shouldSkipPayloadArtifact;

  if (shouldSkip(sourcePath)) {
    return;
  }

  const sourceStats = await stat(sourcePath);

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, targetPath, {
      filter(candidatePath) {
        return !shouldSkip(candidatePath);
      },
      recursive: true,
    });
    return;
  }

  await mkdir(path.dirname(targetPath), {
    recursive: true,
  });
  await copyFile(sourcePath, targetPath);
}

async function copyPublishPayload(entry, targetDir) {
  const includePaths = ['package.json', ...(entry.packageJson.files ?? [])];
  const seenPaths = new Set();

  for (const relativePath of includePaths) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      continue;
    }

    if (seenPaths.has(relativePath)) {
      continue;
    }
    seenPaths.add(relativePath);

    const sourcePath = path.join(entry.dirPath, relativePath);
    if (!(await pathExists(sourcePath))) {
      throw new Error(
        `Cannot pack ${entry.name}: missing ${path.relative(entry.dirPath, sourcePath)}. Run the package build before packing publishables.`,
      );
    }

    await copyPayloadPath(sourcePath, path.join(targetDir, relativePath));
  }
}

async function copyExternalPackagePayload(packageName, packageJson, sourceDir, targetDir) {
  const declaredFiles = Array.isArray(packageJson.files)
    ? packageJson.files.filter((entry) => typeof entry === 'string' && entry.length > 0)
    : [];
  const includePaths = [
    'package.json',
    ...declaredFiles,
    'README.md',
    'README',
    'LICENSE',
    'LICENSE.md',
    'LICENCE',
    'NOTICE',
  ];
  const seenPaths = new Set();

  for (const relativePath of includePaths) {
    if (seenPaths.has(relativePath)) {
      continue;
    }
    seenPaths.add(relativePath);

    const sourcePath = path.join(sourceDir, relativePath);
    const required = relativePath === 'package.json' || declaredFiles.includes(relativePath);

    if (!(await pathExists(sourcePath))) {
      if (required) {
        throw new Error(
          `Cannot bundle ${packageName}: missing ${relativePath} in installed package payload.`,
        );
      }
      continue;
    }

    await copyPayloadPath(sourcePath, path.join(targetDir, relativePath), {
      shouldSkip(candidatePath) {
        const relativeCandidate = path.relative(sourceDir, candidatePath)
          .split(path.sep)
          .join('/');
        return shouldSkipExternalPayloadArtifact(candidatePath)
          || (
            packageName === 'incur'
            && isNonRuntimeIncurPayloadPath(relativeCandidate)
          );
      },
    });
  }
}

async function resolveInstalledDependencyDir(entry, dependencyName) {
  const dependencyPath = path.join(
    entry.dirPath,
    'node_modules',
    ...dependencyName.split('/'),
  );

  if (!(await pathExists(dependencyPath))) {
    throw new Error(
      `Cannot bundle ${dependencyName} for ${entry.name}: missing installed dependency. Run pnpm install --frozen-lockfile before packing publishables.`,
    );
  }

  return realpath(dependencyPath);
}

async function copyExternalBundledDependency(entry, dependencyName, targetDir) {
  const sourceDir = await resolveInstalledDependencyDir(entry, dependencyName);
  const packageJson = JSON.parse(
    await readFile(path.join(sourceDir, 'package.json'), 'utf8'),
  );

  if (packageJson.name !== dependencyName) {
    throw new Error(
      `Cannot bundle ${dependencyName} for ${entry.name}: installed package resolved to ${packageJson.name ?? '<missing>'}.`,
    );
  }

  await copyExternalPackagePayload(dependencyName, packageJson, sourceDir, targetDir);
  await writeJson(
    path.join(targetDir, 'package.json'),
    stripBundledDependencyMetadata(packageJson),
  );
}

function stripBundledDependencyMetadata(packageJson) {
  const tarballPackageJson = { ...packageJson };
  delete tarballPackageJson.dependencies;
  delete tarballPackageJson.optionalDependencies;
  delete tarballPackageJson.peerDependencies;
  delete tarballPackageJson.devDependencies;
  delete tarballPackageJson.scripts;
  delete tarballPackageJson.bundleDependencies;
  delete tarballPackageJson.bundledDependencies;
  return tarballPackageJson;
}

function buildTarballPackageJson(
  entry,
  context,
  bundledDependencies,
  options = {},
) {
  const tarballPackageJson = clonePackageJsonWithResolvedWorkspaceVersions(
    entry.packageJson,
    context.workspacePackageByName,
  );

  delete tarballPackageJson.devDependencies;
  delete tarballPackageJson.scripts;

  if (options.stripBundledDependencyMetadata === true) {
    return stripBundledDependencyMetadata(tarballPackageJson);
  }

  if (bundledDependencies.length > 0) {
    tarballPackageJson.bundleDependencies = bundledDependencies;
  } else {
    delete tarballPackageJson.bundleDependencies;
    delete tarballPackageJson.bundledDependencies;
  }

  return tarballPackageJson;
}

async function materializeStage(entry, context, stageDir) {
  await rm(stageDir, {
    force: true,
    recursive: true,
  });
  await mkdir(stageDir, {
    recursive: true,
  });

  await copyPublishPayload(entry, stageDir);

  const bundledWorkspaceDependencies = resolveBundledWorkspaceDependencies(
    entry.packageJson,
    context.workspacePackageByName,
    context.releasePackageNames,
  );
  const bundledExternalDependencies = resolveBundledExternalDependencies(
    entry.packageJson,
    context.workspacePackageByName,
  );
  const bundledDependencies = [
    ...bundledWorkspaceDependencies,
    ...bundledExternalDependencies,
  ].sort((left, right) => left.localeCompare(right));

  for (const dependencyName of bundledWorkspaceDependencies) {
    const dependencyEntry = context.workspacePackageByName.get(dependencyName);
    if (!dependencyEntry) {
      throw new Error(
        `Cannot bundle ${dependencyName} for ${entry.name}: no matching workspace package was found.`,
      );
    }

    const dependencyTargetDir = path.join(
      stageDir,
      'node_modules',
      ...dependencyName.split('/'),
    );

    await copyPublishPayload(dependencyEntry, dependencyTargetDir);
    await writeJson(
      path.join(dependencyTargetDir, 'package.json'),
      buildTarballPackageJson(dependencyEntry, context, [], {
        stripBundledDependencyMetadata: true,
      }),
    );
  }

  for (const dependencyName of bundledExternalDependencies) {
    await copyExternalBundledDependency(
      entry,
      dependencyName,
      path.join(stageDir, 'node_modules', ...dependencyName.split('/')),
    );
  }

  await writeJson(
    path.join(stageDir, 'package.json'),
    buildTarballPackageJson(entry, context, bundledDependencies),
  );
}

async function ensureGeneratedPackageArtifacts(context) {
  if (context.workspacePackageByName.has('@murphai/assistant-engine')) {
    await execFileAsync(
      process.execPath,
      [assistantCliSurfaceGeneratorPath],
      {
        cwd: context.repoRoot,
      },
    );
  }

  if (context.workspacePackageByName.has('@murphai/exercise-library')) {
    await execFileAsync(
      'pnpm',
      ['--dir', 'packages/exercise-library', 'generate'],
      {
        cwd: context.repoRoot,
      },
    );
  }

  if (context.workspacePackageByName.has('@murphai/health-commons')) {
    await execFileAsync(
      process.execPath,
      ['scripts/ensure-health-commons-generated.mjs'],
      {
        cwd: context.repoRoot,
      },
    );
  }
}

const options = parseReleaseArgs(process.argv.slice(2), {
  defaults: {
    clean: false,
    expectVersion: '',
    outDir: 'dist/npm',
    packOutput: '',
  },
  options: [
    {
      flag: '--clean',
      key: 'clean',
      type: 'flag',
      value: true,
    },
    {
      flag: '--expect-version',
      key: 'expectVersion',
      missingValueMessage: 'Missing value for --expect-version.',
      type: 'value',
    },
    {
      flag: '--out-dir',
      key: 'outDir',
      missingValueCheck: 'always',
      missingValueMessage: 'Missing value for --out-dir.',
      type: 'value',
    },
    {
      flag: '--pack-output',
      key: 'packOutput',
      missingValueMessage: 'Missing value for --pack-output.',
      type: 'value',
    },
  ],
  usageText:
    'Usage: node scripts/pack-publishables.mjs [--expect-version <version>] [--out-dir <dir>] [--pack-output <file>] [--clean]',
});
const context = await loadReleaseContext();
const summary = validateReleaseContext(context, {
  expectVersion: options.expectVersion || undefined,
});
const outDir = path.resolve(context.repoRoot, options.outDir);
const packOutputPath = path.resolve(
  context.repoRoot,
  options.packOutput || path.join(options.outDir, 'pack-output.json'),
);
const stageRoot = path.join(outDir, '.staging');

if (options.clean) {
  await rm(outDir, { force: true, recursive: true });
}

await mkdir(outDir, { recursive: true });
await mkdir(path.dirname(packOutputPath), { recursive: true });
await rm(stageRoot, { force: true, recursive: true });
await mkdir(stageRoot, { recursive: true });
await ensureGeneratedPackageArtifacts(context);

const packedPackages = [];

for (const entry of context.orderedPackages) {
  const stageDir = path.join(stageRoot, stageDirectoryName(entry.name));
  await materializeStage(entry, context, stageDir);

  const beforeFiles = new Set(await tgzFiles(outDir));
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', outDir],
    {
      cwd: stageDir,
      // Bundled dependencies can make npm's JSON file manifest exceed the 1 MiB default.
      maxBuffer: npmPackMetadataMaxBufferBytes,
    },
  );

  const packResult = normalizePackResult(stdout.trim());
  verifyRequiredPackedArtifacts(entry, packResult);
  const afterFiles = await tgzFiles(outDir);
  const newFiles = afterFiles.filter((fileName) => !beforeFiles.has(fileName));
  const rawTarballPath =
    typeof packResult?.filename === 'string'
      ? packResult.filename
      : newFiles.at(-1);

  if (!rawTarballPath) {
    throw new Error(
      `Unable to resolve tarball filename for ${entry.name} from npm pack output.`,
    );
  }

  const tarballPath = path.isAbsolute(rawTarballPath)
    ? rawTarballPath
    : path.join(outDir, rawTarballPath);
  const tarballFilename = path.basename(tarballPath);

  packedPackages.push({
    name: entry.name,
    packageJsonPath: path.relative(context.repoRoot, entry.packageJsonPath),
    path: entry.path,
    tarball: path.relative(context.repoRoot, tarballPath),
    tarballFilename,
    version: entry.packageJson.version,
  });

  console.log(`${entry.name}@${entry.packageJson.version} packed.`);
}

const packOutput = {
  changelogPath: summary.changelogPath,
  generatedAt: new Date().toISOString(),
  packages: packedPackages,
  primaryPackage: summary.primaryPackage,
  releaseNotesPath: summary.releaseNotesPath,
  version: summary.version,
};

await verifyReleaseArtifacts(context.repoRoot, packOutput);
await writeJson(packOutputPath, packOutput);
console.log(`Wrote pack manifest: ${path.relative(context.repoRoot, packOutputPath)}`);
