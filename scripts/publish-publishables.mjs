import { readFile } from 'node:fs/promises';
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
    'Usage: node scripts/publish-publishables.mjs [--pack-output <file>] [--npm-tag <tag>] [--provenance|--no-provenance]',
  );
}

function parseArgs(argv) {
  const options = {
    npmTag: '',
    packOutput: 'dist/npm/pack-output.json',
    provenance: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--pack-output') {
      options.packOutput = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--npm-tag') {
      options.npmTag = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--provenance') {
      options.provenance = true;
      continue;
    }

    if (argument === '--no-provenance') {
      options.provenance = false;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (argv.includes('--pack-output') && options.packOutput.length === 0) {
    throw new Error('Missing value for --pack-output.');
  }
  if (argv.includes('--npm-tag') && options.npmTag.length === 0) {
    throw new Error('Missing value for --npm-tag.');
  }

  return options;
}

function isAlreadyPublished(output) {
  return /previously published|cannot publish over|version already exists/ui.test(
    output,
  );
}

const options = parseArgs(process.argv.slice(2));
const context = await loadReleaseContext();
const packOutputPath = path.resolve(context.repoRoot, options.packOutput);
const packOutput = JSON.parse(await readFile(packOutputPath, 'utf8'));
const summary = validateReleaseContext(context, {
  expectVersion: packOutput.version,
});

const packedByName = new Map(
  packOutput.packages.map((entry) => [entry.name, entry]),
);

for (const entry of summary.packages) {
  const packedEntry = packedByName.get(entry.name);
  if (!packedEntry) {
    throw new Error(`Missing packed tarball metadata for ${entry.name}.`);
  }

  const tarballPath = path.resolve(context.repoRoot, packedEntry.tarball);
  const publishArgs = ['publish', tarballPath];

  if (entry.name.startsWith('@')) {
    publishArgs.push('--access', 'public');
  }

  if (options.provenance) {
    publishArgs.push('--provenance');
  }

  if (options.npmTag.length > 0) {
    publishArgs.push('--tag', options.npmTag);
  }

  console.log(`+ npm ${publishArgs.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync('npm', publishArgs);
    if (stdout.length > 0) {
      process.stdout.write(stdout);
    }
    if (stderr.length > 0) {
      process.stderr.write(stderr);
    }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (output.length > 0) {
      process.stdout.write(output);
    }

    if (isAlreadyPublished(output)) {
      console.log(`Skipping ${entry.name}@${entry.version}; version already published.`);
      continue;
    }

    throw error;
  }
}
