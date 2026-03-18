import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadReleaseContext,
  validateReleaseContext,
} from './release-helpers.mjs';

const execFileAsync = promisify(execFile);

function usage() {
  console.log(
    'Usage: node scripts/pack-publishables.mjs [--expect-version <version>] [--out-dir <dir>] [--pack-output <file>] [--clean]',
  );
}

function parseArgs(argv) {
  const options = {
    clean: false,
    expectVersion: '',
    outDir: 'dist/npm',
    packOutput: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--clean') {
      options.clean = true;
      continue;
    }

    if (argument === '--expect-version') {
      options.expectVersion = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--out-dir') {
      options.outDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--pack-output') {
      options.packOutput = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (argv.includes('--expect-version') && options.expectVersion.length === 0) {
    throw new Error('Missing value for --expect-version.');
  }
  if (options.outDir.length === 0) {
    throw new Error('Missing value for --out-dir.');
  }
  if (argv.includes('--pack-output') && options.packOutput.length === 0) {
    throw new Error('Missing value for --pack-output.');
  }

  return options;
}

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

const options = parseArgs(process.argv.slice(2));
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
