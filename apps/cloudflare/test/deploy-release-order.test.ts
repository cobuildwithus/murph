import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertReleaseNotBehindLive } from "../scripts/deploy-release-order.ts";

let root: string;
let checkoutDir: string;
const commits: Record<"first" | "second" | "third" | "side", string> = { first: "", second: "", third: "", side: "" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "synthetic@example.test",
      GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "synthetic@example.test" },
  }).trim();
}

describe("assertReleaseNotBehindLive", () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "murph-release-order-test-"));
    const publicRepo = path.join(root, "public");
    git(root, "init", "--quiet", "--initial-branch=main", publicRepo);
    git(publicRepo, "config", "uploadpack.allowFilter", "true");
    git(publicRepo, "config", "uploadpack.allowAnySHA1InWant", "true");
    for (const name of ["first", "second", "third"] as const) {
      git(publicRepo, "commit", "--quiet", "--allow-empty", "-m", name);
      commits[name] = git(publicRepo, "rev-parse", "HEAD");
    }
    git(publicRepo, "checkout", "--quiet", "-b", "side", commits.first);
    git(publicRepo, "commit", "--quiet", "--allow-empty", "-m", "side");
    commits.side = git(publicRepo, "rev-parse", "HEAD");
    // The deploy checkout is a shallow clone of the release commit.
    checkoutDir = path.join(root, "checkout");
    git(root, "clone", "--quiet", "--depth=1", "--no-local", `file://${publicRepo}`, checkoutDir);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("refuses a release that the live release already contains", async () => {
    await expect(assertReleaseNotBehindLive({ releaseSha: commits.first, liveReleaseSha: commits.third, checkoutDir }))
      .rejects.toThrow(`Live runner release ${commits.third} already contains ${commits.first}`);
  });

  it.each([
    ["a newer release", "third", "first"],
    ["a release on a different line", "side", "second"],
  ] as const)("admits %s", async (_label, release, live) => {
    await expect(assertReleaseNotBehindLive({ releaseSha: commits[release], liveReleaseSha: commits[live], checkoutDir }))
      .resolves.toBeUndefined();
  });

  it("leaves the deploy checkout shallow and its remote unchanged", async () => {
    await assertReleaseNotBehindLive({ releaseSha: commits.second, liveReleaseSha: commits.third, checkoutDir }).catch(() => {});
    expect(git(checkoutDir, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(() => git(checkoutDir, "config", "--get", "remote.origin.promisor")).toThrow();
  });

  it.each([
    ["no live release SHA", null],
    ["the same release", "same"],
  ] as const)("admits %s without reading git", async (_label, live) => {
    const releaseSha = commits.second;
    await expect(assertReleaseNotBehindLive({
      releaseSha, liveReleaseSha: live === "same" ? releaseSha : live, checkoutDir: path.join(root, "missing"),
    })).resolves.toBeUndefined();
  });

  it("stops the deploy when the live commit cannot be fetched", async () => {
    await expect(assertReleaseNotBehindLive({ releaseSha: commits.second, liveReleaseSha: "f".repeat(40), checkoutDir }))
      .rejects.toThrow("could not fetch the release and live commits");
  });

  it("rejects malformed commit identities", async () => {
    await expect(assertReleaseNotBehindLive({ releaseSha: commits.second, liveReleaseSha: "HEAD", checkoutDir }))
      .rejects.toThrow("full lowercase commit SHAs");
  });
});
