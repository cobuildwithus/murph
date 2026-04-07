import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  loadReleaseContext,
  parseReleaseArgs,
  validateReleaseContext,
} from './release-helpers.mjs';

function isAlreadyPublished(output) {
  return /previously published|cannot publish over|version already exists/ui.test(
    output,
  );
}

function isPermissionOrScopeNotFound(output) {
  return /npm error 404 Not Found - PUT https:\/\/registry\.npmjs\.org\/@/ui.test(output);
}

function isOtpRequired(output) {
  return /npm error code EOTP|one-time password|OTP required for authentication/ui.test(
    output,
  );
}

function shellEscapeArgument(argument) {
  if (/^[A-Za-z0-9_./:@=+-]+$/u.test(argument)) {
    return argument;
  }

  return `'${argument.replace(/'/gu, `'\\''`)}'`;
}

function buildShellCommand(command, args) {
  return [command, ...args].map(shellEscapeArgument).join(' ');
}

function shouldUseInteractivePublishWrapper() {
  return (
    !process.env.CI &&
    process.platform !== 'win32' &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY)
  );
}

function resolvePublishCommand(publishArgs) {
  if (!shouldUseInteractivePublishWrapper()) {
    return {
      command: 'npm',
      args: publishArgs,
    };
  }

  if (process.platform === 'darwin') {
    return {
      command: 'script',
      args: ['-q', '/dev/null', 'npm', ...publishArgs],
    };
  }

  return {
    command: 'script',
    args: ['-q', '-e', '-c', buildShellCommand('npm', publishArgs), '/dev/null'],
  };
}

async function execFileStreaming(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(chunk);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(chunk);
  });

  return await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }

      const error = new Error(
        `Command failed: ${command} ${args.map(shellEscapeArgument).join(' ')}`,
      );
      error.code = code ?? 1;
      error.signal = signal ?? null;
      error.stderr = stderr;
      error.stdout = stdout;
      reject(error);
    });
  });
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
  const publishCommand = resolvePublishCommand(publishArgs);

  try {
    await execFileStreaming(publishCommand.command, publishCommand.args, context.repoRoot);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;

    if (isAlreadyPublished(output)) {
      console.log(`Skipping ${entry.name}@${entry.version}; version already published.`);
      continue;
    }

    if (isOtpRequired(output)) {
      throw new Error(
        `npm publish failed for ${entry.name}@${entry.version} because npm still requires interactive authentication. `
          + 'Run `npm login --auth-type=web` or complete the browser auth URL that npm prints, '
          + 'then rerun `node scripts/publish-publishables.mjs --pack-output '
          + `${options.packOutput}` + '`.',
      );
    }

    if (isPermissionOrScopeNotFound(output)) {
      throw new Error(
        `npm publish failed for ${entry.name}@${entry.version}. `
          + 'The package exists on npm but this workflow could not publish to the scoped package. '
          + 'npm trusted publishing is configured per package on npm, so every publishable '
          + `package in this monorepo must trust cobuildwithus/murph via release.yml. Run `
          + '`node scripts/configure-trusted-publishing.mjs` from an npm-authenticated shell '
          + 'to attach the missing package-level trust relationship(s).',
      );
    }

    throw error;
  }
}
