import path from "node:path";

import {
  parseHostedContainerImageListOutput,
  selectHostedContainerImageTagsForCleanup,
} from "./deploy-automation/container-images.ts";
import { runWranglerJson, runWranglerLogged } from "./wrangler-runner.js";

const cliArgs = parseCliArgs(process.argv.slice(2));

if (cliArgs.showHelp) {
  printUsage();
  process.exit(0);
}

if (!cliArgs.repositoryFilter) {
  throw new Error("Pass --filter with a repository regex so image cleanup stays intentionally scoped.");
}

const wranglerConfigArgs = cliArgs.configPath ? ["--config", cliArgs.configPath] : [];

const rawList = await runWranglerJson([
  "containers",
  "images",
  "list",
  "--json",
  "--filter",
  cliArgs.repositoryFilter,
  ...wranglerConfigArgs,
]);
const images = parseHostedContainerImageListOutput(rawList);
const tagsToDelete = selectHostedContainerImageTagsForCleanup({
  images,
  keepPerRepository: cliArgs.keepPerRepository,
});

if (tagsToDelete.length === 0) {
  console.log("No matching Cloudflare container images need cleanup.");
  process.exit(0);
}

console.log("Cloudflare container image cleanup plan:");
for (const entry of tagsToDelete) {
  console.log(`- delete ${entry.image}`);
}

if (!cliArgs.apply) {
  console.log("Dry run only. Re-run with --apply to delete these images.");
  process.exit(0);
}

for (const entry of tagsToDelete) {
  await runWranglerLogged([
    "containers",
    "images",
    "delete",
    entry.image,
    ...wranglerConfigArgs,
  ]);
}

console.log(`Deleted ${tagsToDelete.length} Cloudflare container image tag(s).`);

function parseCliArgs(argv: string[]): {
  apply: boolean;
  configPath: string | null;
  repositoryFilter: string | null;
  keepPerRepository: number;
  showHelp: boolean;
} {
  let apply = false;
  let configPath: string | null = null;
  let repositoryFilter: string | null = null;
  let keepPerRepository = 10;
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    switch (current) {
      case "--":
        continue;
      case "--help":
      case "-h":
        showHelp = true;
        continue;
      case "--apply":
        apply = true;
        continue;
      case "--config":
      case "-c":
        configPath = path.resolve(process.cwd(), requireCliValue(argv, index, current));
        index += 1;
        continue;
      case "--filter":
        repositoryFilter = requireCliValue(argv, index, current);
        index += 1;
        continue;
      case "--keep": {
        const parsed = Number.parseInt(requireCliValue(argv, index, current), 10);

        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error("--keep must be a non-negative integer.");
        }

        keepPerRepository = parsed;
        index += 1;
        continue;
      }
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return {
    apply,
    configPath,
    repositoryFilter,
    keepPerRepository,
    showHelp,
  };
}

function requireCliValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];

  if (!value || value === "--") {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printUsage(): void {
  console.log(`Usage: pnpm --dir apps/cloudflare images:cleanup -- --filter <repo-regex> [options]

Options:
  --filter <regex>   Limit cleanup to matching repositories. Required.
  --keep <count>     Keep this many tags per repository. Default: 10.
  --config, -c <path>  Use a specific Wrangler config file.
  --apply            Delete the selected image tags. Default is dry-run.
  --help, -h         Show this help text.`);
}
