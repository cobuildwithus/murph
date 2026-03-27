import { spawn } from "node:child_process";
import path from "node:path";

import {
  parseHostedContainerImageListOutput,
  selectHostedContainerImageTagsForCleanup,
} from "../src/deploy-automation.js";

const args = parseCliArgs(process.argv.slice(2));

if (args.showHelp) {
  printUsage();
  process.exit(0);
}

if (!args.filter) {
  throw new Error("Pass --filter with a repository regex so image cleanup stays intentionally scoped.");
}

const rawList = await runWranglerJson([
  "containers",
  "images",
  "list",
  "--json",
  "--filter",
  args.filter,
  ...(args.configPath ? ["--config", args.configPath] : []),
]);
const images = parseHostedContainerImageListOutput(rawList);
const tagsToDelete = selectHostedContainerImageTagsForCleanup({
  images,
  keepPerRepository: args.keepPerRepository,
});

if (tagsToDelete.length === 0) {
  console.log("No matching Cloudflare container images need cleanup.");
  process.exit(0);
}

console.log("Cloudflare container image cleanup plan:");
for (const entry of tagsToDelete) {
  console.log(`- delete ${entry.image}`);
}

if (!args.apply) {
  console.log("Dry run only. Re-run with --apply to delete these images.");
  process.exit(0);
}

for (const entry of tagsToDelete) {
  await runWranglerLogged([
    "containers",
    "images",
    "delete",
    entry.image,
    ...(args.configPath ? ["--config", args.configPath] : []),
  ]);
}

console.log(`Deleted ${tagsToDelete.length} Cloudflare container image tag(s).`);

async function runWranglerLogged(wranglerArgs: string[]): Promise<void> {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "wrangler", ...wranglerArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler ${wranglerArgs.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function runWranglerJson(wranglerArgs: string[]): Promise<string> {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "wrangler", ...wranglerArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          `wrangler ${wranglerArgs.join(" ")} exited with code ${code ?? "unknown"}.${
            stderr.trim().length > 0 ? ` ${stderr.trim()}` : ""
          }`,
        ),
      );
    });
  });
}

function parseCliArgs(argv: string[]): {
  apply: boolean;
  configPath: string | null;
  filter: string | null;
  keepPerRepository: number;
  showHelp: boolean;
} {
  let apply = false;
  let configPath: string | null = null;
  let filter: string | null = null;
  let keepPerRepository = 10;
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--") {
      continue;
    }

    if (current === "--help" || current === "-h") {
      showHelp = true;
      continue;
    }

    if (current === "--apply") {
      apply = true;
      continue;
    }

    if ((current === "--config" || current === "-c") && next) {
      configPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (current === "--filter" && next) {
      filter = next;
      index += 1;
      continue;
    }

    if (current === "--keep" && next) {
      const parsed = Number.parseInt(next, 10);

      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--keep must be a non-negative integer.");
      }

      keepPerRepository = parsed;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    apply,
    configPath,
    filter,
    keepPerRepository,
    showHelp,
  };
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
