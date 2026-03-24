import {
  loadReleaseContext,
  parseReleaseArgs,
  validateReleaseContext,
} from './release-helpers.mjs';

const options = parseReleaseArgs(process.argv.slice(2), {
  defaults: {
    expectVersion: '',
    json: false,
  },
  options: [
    {
      flag: '--expect-version',
      key: 'expectVersion',
      missingValueMessage: 'Missing value for --expect-version.',
      type: 'value',
    },
    {
      flag: '--json',
      key: 'json',
      type: 'flag',
      value: true,
    },
  ],
  usageText:
    'Usage: node scripts/verify-release-target.mjs [--expect-version <version>] [--json]',
});
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
