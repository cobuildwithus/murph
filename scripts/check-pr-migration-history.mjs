import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATIONS = "apps/web/prisma/migrations/";
const MIGRATION_SQL = /^apps\/web\/prisma\/migrations\/[^/]+\/migration\.sql$/u;

export function findChangedBaseMigrations({ baseSha, headSha, cwd = process.cwd() }) {
  for (const sha of [baseSha, headSha]) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sha ?? "")) {
      throw new Error("Migration history guard requires full base and head commit SHAs.");
    }
  }
  const git = (args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const gitPaths = (args) => git(args).split("\0").filter(Boolean);
  // Mode, type and blob of one path at one commit; empty when the path is absent.
  const treeEntry = (sha, file) => git(["ls-tree", "-z", sha, "--", file]).split("\t")[0];
  const basePaths = new Set(gitPaths([
    "ls-tree", "-r", "--name-only", "-z", baseSha, "--", MIGRATIONS,
  ]).filter((file) => MIGRATION_SQL.test(file)));
  // Compare only PR-authored changes, so a base advance is not a PR deletion.
  // Disable rename detection so both renamed and deleted source paths are checked.
  // A file inherited unchanged (e.g. via a squash-merged parent branch) is not a change.
  return gitPaths([
    "diff", "--no-renames", "--name-only", "-z",
    `${baseSha}...${headSha}`, "--", MIGRATIONS,
  ]).filter((file) => basePaths.has(file)
    && treeEntry(baseSha, file) !== treeEntry(headSha, file));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const changed = findChangedBaseMigrations({
      baseSha: process.env.MURPH_PR_BASE_SHA,
      headSha: process.env.MURPH_PR_HEAD_SHA,
    });
    if (changed.length > 0) {
      throw new Error(
        "Merged migrations are immutable. Add a forward migration instead:\n"
        + changed.map((file) => `- ${file}`).join("\n"),
      );
    }
    console.log("Pull request migration history passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration history check failed.");
    process.exitCode = 1;
  }
}
