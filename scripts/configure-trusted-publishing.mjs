import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { loadReleaseContext, parseReleaseArgs } from './release-helpers.mjs';

const execFileAsync = promisify(execFile);
const MINIMUM_NPM_VERSION = [11, 10, 0];

function parseVersion(value) {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (!match) {
    throw new Error(`Unable to parse npm version: ${value}`);
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function versionLessThan(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart < rightPart) {
      return true;
    }
    if (leftPart > rightPart) {
      return false;
    }
  }

  return false;
}

function formatMinimumVersion(parts) {
  return parts.join('.');
}

function resolveRepositorySlug(repositoryUrl) {
  try {
    const normalizedUrl = repositoryUrl.startsWith('git+')
      ? repositoryUrl.slice(4)
      : repositoryUrl;
    const url = new URL(normalizedUrl);
    return url.pathname.replace(/^\/+/u, '').replace(/\.git$/u, '');
  } catch {
    return '';
  }
}

const options = parseReleaseArgs(process.argv.slice(2), {
  defaults: {
    dryRun: false,
    file: 'release.yml',
    yes: false,
  },
  options: [
    {
      flag: '--dry-run',
      key: 'dryRun',
      type: 'flag',
      value: true,
    },
    {
      flag: '--file',
      key: 'file',
      missingValueMessage: 'Missing value for --file.',
      type: 'value',
    },
    {
      flag: '--yes',
      key: 'yes',
      type: 'flag',
      value: true,
    },
  ],
  usageText:
    'Usage: node scripts/configure-trusted-publishing.mjs [--dry-run] [--file <workflow-file>] [--yes]',
});

const context = await loadReleaseContext();
const repositorySlug = resolveRepositorySlug(context.manifest.repositoryUrl);

if (repositorySlug.length === 0) {
  throw new Error(
    `Unable to derive the GitHub owner/repo slug from scripts/release-manifest.json repositoryUrl: ${context.manifest.repositoryUrl}`,
  );
}

if (!options.dryRun) {
  const { stdout } = await execFileAsync('npm', ['--version']);
  const npmVersion = parseVersion(stdout);

  if (versionLessThan(npmVersion, MINIMUM_NPM_VERSION)) {
    throw new Error(
      `npm trust requires npm >= ${formatMinimumVersion(MINIMUM_NPM_VERSION)}. `
        + `Current npm is ${stdout.trim()}. Upgrade npm or rerun this command with --dry-run to preview the required package-level trust bindings.`,
    );
  }
}

console.log(
  `Configuring npm trusted publishing for ${context.orderedPackages.length} package(s) from ${repositorySlug} via ${options.file}.`,
);
console.log(
  'npm trusted publishing is configured per package on npm, so monorepo releases must bind every publishable package individually.',
);
console.log(
  'This helper bootstraps missing trust relationships. If a package is already bound to the wrong workflow or repo, use `npm trust list` and `npm trust revoke` for that package before rerunning this command.',
);

for (const [index, entry] of context.orderedPackages.entries()) {
  const command = [
    'trust',
    'github',
    entry.name,
    '--repo',
    repositorySlug,
    '--file',
    options.file,
  ];

  if (options.yes) {
    command.push('--yes');
  }

  console.log(`+ npm ${command.join(' ')}`);

  if (options.dryRun) {
    continue;
  }

  const { stdout, stderr } = await execFileAsync('npm', command, {
    cwd: context.repoRoot,
  });

  if (stdout.length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr);
  }

  if (index < context.orderedPackages.length - 1) {
    await delay(2_000);
  }
}
