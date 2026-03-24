import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadReleaseContext,
  parseReleaseArgs,
  validateReleaseContext,
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

if (options.clean) {
  await rm(outDir, { force: true, recursive: true });
}

await mkdir(outDir, { recursive: true });
await mkdir(path.dirname(packOutputPath), { recursive: true });

const packedPackages = [];

for (const entry of context.orderedPackages) {
  const beforeFiles = new Set(await tgzFiles(outDir));
  const { stdout } = await execFileAsync(
    'pnpm',
    ['pack', '--json', '--pack-destination', outDir],
    {
      cwd: entry.dirPath,
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
      `Unable to resolve tarball filename for ${entry.name} from pnpm pack output.`,
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

await writeFile(packOutputPath, `${JSON.stringify(packOutput, null, 2)}\n`);
console.log(`Wrote pack manifest: ${path.relative(context.repoRoot, packOutputPath)}`);
