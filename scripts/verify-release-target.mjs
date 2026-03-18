import { loadReleaseContext, validateReleaseContext } from './release-helpers.mjs';

function usage() {
  console.log(`Usage: node scripts/verify-release-target.mjs [--expect-version <version>] [--json]`);
}

function parseArgs(argv) {
  const options = {
    expectVersion: '',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--expect-version') {
      options.expectVersion = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument === '--json') {
      options.json = true;
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

  return options;
}

const options = parseArgs(process.argv.slice(2));
const context = await loadReleaseContext();
const summary = validateReleaseContext(context, {
  expectVersion: options.expectVersion || undefined,
});

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.log(`Verified ${summary.packages.length} publishable packages at ${summary.version}.`);
console.log(`Primary package: ${summary.primaryPackage?.name ?? 'UNCONFIRMED'}`);
console.log(`Release notes: ${summary.releaseNotesPath}`);
for (const entry of summary.packages) {
  console.log(
    `- ${entry.name}@${entry.version} (${entry.path})${
      entry.workspaceDependencies.length > 0
        ? ` -> ${entry.workspaceDependencies.join(', ')}`
        : ''
    }`,
  );
}
