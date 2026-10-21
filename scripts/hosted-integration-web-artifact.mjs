import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WEB_ARTIFACT_CONTRACT = "hosted-integration-web-v1";
export const WEB_ARTIFACT_ARCHIVE = "hosted-web-next-dist.tar.zst";
export const WEB_ARTIFACT_MANIFEST = "hosted-web-build.json";

export function webArtifactIdentity(env) {
  if (!/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? "")
    || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "")
    || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? "")
    || !Number.isSafeInteger(Number(env.GITHUB_RUN_ID))
    || !Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT))
    || env.GITHUB_REPOSITORY !== "cobuildwithus/murph"
    || env.GITHUB_EVENT_NAME !== "push"
    || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Public Web artifact requires an exact main-push identity.");
  }
  return {
    contract: WEB_ARTIFACT_CONTRACT,
    sha: env.GITHUB_SHA,
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    platform: "linux",
    arch: "x64",
    nodeMajor: 24,
  };
}

export async function packWebArtifact(env = process.env) {
  const identity = webArtifactIdentity(env);
  if (process.platform !== identity.platform || process.arch !== identity.arch
    || Number(process.versions.node.split(".")[0]) !== identity.nodeMajor) {
    throw new Error("Public Web artifact build platform does not match its contract.");
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const privateInputs = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "packages/assistant-engine"], { encoding: "utf8" });
  if (sha !== identity.sha || privateInputs.trim()) {
    throw new Error("Public Web artifact must use unmodified public assistant sources.");
  }
  execFileSync("tar", ["--zstd", "--exclude=apps/web/.next-smoke-murph-cloud-integration/cache", "-cf", WEB_ARTIFACT_ARCHIVE,
    "apps/web/.next-smoke-murph-cloud-integration"], { stdio: "inherit" });
  const digest = createHash("sha256").update(await readFile(WEB_ARTIFACT_ARCHIVE)).digest("hex");
  await writeFile(WEB_ARTIFACT_MANIFEST, `${JSON.stringify({ ...identity, sha256: digest })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await packWebArtifact();
}
