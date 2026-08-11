import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PINNED_CODEX_OPENAI_EGRESS_INVENTORY,
} from "../test/fixtures/codex-openai-egress-routes.ts";

const CODEX_UPSTREAM_URL = "https://github.com/openai/codex.git";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function main(): Promise<void> {
  const inventory = PINNED_CODEX_OPENAI_EGRESS_INVENTORY;
  const assistantPackage = JSON.parse(await readFile(
    path.join(repoRoot, "packages/assistant-engine/package.json"),
    "utf8",
  )) as { devDependencies?: Record<string, string> };
  const installedVersion = assistantPackage.devDependencies?.["@openai/codex"];

  if (installedVersion !== inventory.version) {
    throw new Error(
      `Codex source verification expected package pin ${inventory.version}, received ${installedVersion ?? "missing"}.`,
    );
  }
  if (inventory.upstreamTag !== `rust-v${inventory.version}`) {
    throw new Error("Codex upstream tag does not match the pinned package version.");
  }

  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "murph-codex-upstream-source-"),
  );
  const upstreamRepository = path.join(temporaryRoot, "upstream");

  try {
    runGit(["init", "--quiet", upstreamRepository], temporaryRoot);
    runGit(
      ["remote", "add", "origin", CODEX_UPSTREAM_URL],
      upstreamRepository,
    );
    runGit([
      "fetch",
      "--quiet",
      "--depth=1",
      "--filter=blob:none",
      "origin",
      `refs/tags/${inventory.upstreamTag}`,
    ], upstreamRepository);

    const actualCommit = runGit(
      ["rev-parse", "FETCH_HEAD^{commit}"],
      upstreamRepository,
    );
    const actualSourceTree = runGit(
      ["rev-parse", `FETCH_HEAD:${inventory.upstreamSourceRoot}`],
      upstreamRepository,
    );
    if (actualCommit !== inventory.upstreamCommit) {
      throw new Error(
        `Codex tag ${inventory.upstreamTag} resolved to unexpected commit ${actualCommit}.`,
      );
    }
    if (actualSourceTree !== inventory.upstreamSourceTree) {
      throw new Error(
        `Codex source root ${inventory.upstreamSourceRoot} resolved to unexpected tree ${actualSourceTree}.`,
      );
    }

    const sourceFiles = new Set(runGit([
      "ls-tree",
      "-r",
      "--name-only",
      "FETCH_HEAD^{commit}",
      "--",
      inventory.upstreamSourceRoot,
    ], upstreamRepository).split("\n").filter(Boolean));
    const declaredSources = new Set([
      ...inventory.reviewedSources,
      ...inventory.routes.map((route) => route.source),
      ...inventory.chatGptAuthOnlyRoutes.map((route) => route.source),
    ]);
    const missingSources = [...declaredSources]
      .filter((source) => !sourceFiles.has(source))
      .sort();
    if (missingSources.length > 0) {
      throw new Error(
        `Codex reviewed source paths are absent from ${inventory.upstreamTag}: ${missingSources.join(", ")}.`,
      );
    }

    process.stdout.write(
      `Verified Codex ${inventory.version} tag, commit, ${inventory.upstreamSourceRoot} tree, and ${declaredSources.size} reviewed source paths.\n`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || "unknown git error")
      .replaceAll(cwd, "<UPSTREAM_REPO>")
      .trim();
    throw new Error(`Codex upstream source verification failed: ${detail}`);
  }
  return result.stdout.trim();
}

await main();
