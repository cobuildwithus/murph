import { cp, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  clonePackageJsonWithResolvedWorkspaceVersions,
  loadReleaseContext,
  parseReleaseArgs,
  resolveBundledWorkspaceDependencies,
  validateReleaseContext,
  writeJson,
} from './release-helpers.mjs';

const execFileAsync = promisify(execFile);

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

async function copyPayloadPath(sourcePath, targetPath) {
  const sourceStats = await stat(sourcePath);

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, targetPath, {
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

function buildTarballPackageJson(entry, context, bundledWorkspaceDependencies) {
  const tarballPackageJson = clonePackageJsonWithResolvedWorkspaceVersions(
    entry.packageJson,
    context.workspacePackageByName,
  );

  delete tarballPackageJson.devDependencies;
  delete tarballPackageJson.scripts;

  if (bundledWorkspaceDependencies.length > 0) {
    tarballPackageJson.bundleDependencies = bundledWorkspaceDependencies;
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
      buildTarballPackageJson(dependencyEntry, context, []),
    );
  }

  await writeJson(
    path.join(stageDir, 'package.json'),
    buildTarballPackageJson(entry, context, bundledWorkspaceDependencies),
  );
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
    },
  );

  const packResult = normalizePackResult(stdout.trim());
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

  console.log(`${entry.name}@${entry.packageJson.version} -> ${tarballFilename}`);
}

const packOutput = {
  changelogPath: summary.changelogPath,
  generatedAt: new Date().toISOString(),
  packages: packedPackages,
  primaryPackage: summary.primaryPackage,
  releaseNotesPath: summary.releaseNotesPath,
  version: summary.version,
};

await writeJson(packOutputPath, packOutput);
console.log(`Wrote pack manifest: ${path.relative(context.repoRoot, packOutputPath)}`);
