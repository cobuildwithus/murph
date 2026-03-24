import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadReleaseContext,
  parseReleaseArgs,
  validateReleaseContext,
} from './release-helpers.mjs';

const execFileAsync = promisify(execFile);

function isAlreadyPublished(output) {
  return /previously published|cannot publish over|version already exists/ui.test(
    output,
  );
}

const options = parseReleaseArgs(process.argv.slice(2), {
  defaults: {
    npmTag: '',
    packOutput: 'dist/npm/pack-output.json',
    provenance: false,
  },
  options: [
    {
      flag: '--pack-output',
      key: 'packOutput',
      missingValueMessage: 'Missing value for --pack-output.',
      type: 'value',
    },
    {
      flag: '--npm-tag',
      key: 'npmTag',
      missingValueMessage: 'Missing value for --npm-tag.',
      type: 'value',
    },
    {
      flag: '--provenance',
      key: 'provenance',
      type: 'flag',
      value: true,
    },
    {
      flag: '--no-provenance',
      key: 'provenance',
      type: 'flag',
      value: false,
    },
  ],
  usageText:
    'Usage: node scripts/publish-publishables.mjs [--pack-output <file>] [--npm-tag <tag>] [--provenance|--no-provenance]',
});
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
