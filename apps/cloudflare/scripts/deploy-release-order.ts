import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const commitPattern = /^[0-9a-f]{40}$/u;
const fetchAttempts = 3;
const runGit = promisify(execFile);

/**
 * A deploy run resolves public main when it starts, and its gates can outlast a
 * later run's, so an older run can reach activation after a newer one went live.
 * Refuse any release the serving runner release already contains.
 */
export async function assertReleaseNotBehindLive(input: {
  releaseSha: string;
  liveReleaseSha: string | null;
  /** Any directory inside the public checkout the release was built from. */
  checkoutDir: string;
}): Promise<void> {
  const { releaseSha, liveReleaseSha } = input;
  if (liveReleaseSha === null || liveReleaseSha === releaseSha) return;
  if (!commitPattern.test(releaseSha) || !commitPattern.test(liveReleaseSha)) {
    throw new Error("Release order check requires full lowercase commit SHAs.");
  }
  if (await isAncestor(await readOriginUrl(input.checkoutDir), releaseSha, liveReleaseSha)) {
    throw new Error(
      `Live runner release ${liveReleaseSha} already contains ${releaseSha}; refusing to roll production back. `
        + "A newer deploy finished first. Dispatch a fresh deploy if main has moved since.",
    );
  }
}

async function readOriginUrl(checkoutDir: string): Promise<string> {
  const { stdout } = await runGit("git", ["-C", checkoutDir, "remote", "get-url", "origin"]);
  const url = stdout.trim();
  if (!url) throw new Error("Release order check requires the public checkout's origin remote.");
  return url;
}

// Commit objects only, in a scratch repository: the deploy checkout stays
// shallow and its remote is never turned into a partial-clone promisor.
async function isAncestor(repositoryUrl: string, ancestor: string, descendant: string): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-release-order-"));
  try {
    await runGit("git", ["init", "--quiet", "--bare", directory]);
    await runGit("git", ["-C", directory, "remote", "add", "origin", repositoryUrl]);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await runGit("git", ["-C", directory, "fetch", "--quiet", "--no-tags", "--filter=tree:0", "origin", ancestor, descendant],
          { timeout: 120_000 });
        break;
      } catch (error) {
        if (attempt >= fetchAttempts) {
          throw new Error("Release order check could not fetch the release and live commits; deploy stopped.", { cause: error });
        }
      }
    }
    try {
      await runGit("git", ["-C", directory, "merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch (error) {
      if (isExitCode(error, 1)) return false;
      throw new Error("Release order check could not compare the release and live commits; deploy stopped.", { cause: error });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isExitCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
