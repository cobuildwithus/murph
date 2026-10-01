import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isObjectRecord } from "./deploy-automation/shared.ts";
import { runWranglerLoggedCaptured } from "./wrangler-runner.ts";
import { readReusableHostedRunnerImage } from "./stage-runner-release.ts";
import type { ListCloudflareContainerApplications } from "./container-release-receipt.ts";

/** Publish the immutable image before native admission or Worker version activation. */
export async function prepareHostedContainerDeployImage(input: {
  accountId: string;
  configPath: string;
  release?: { currentVersion: unknown; releaseSha: string; listApplications: ListCloudflareContainerApplications };
}): Promise<string> {
  const source: unknown = JSON.parse(await readFile(input.configPath, "utf8"));
  if (!isObjectRecord(source) || !Array.isArray(source.containers)
    || source.containers.length === 0
    || typeof source.name !== "string" || !/^[a-z0-9-]+$/u.test(source.name)
    || !/^[a-f0-9]{32}$/u.test(input.accountId)) {
    throw new Error("Prepared container deployment configuration is invalid.");
  }
  const configDir = path.dirname(input.configPath);
  const containers = source.containers.map((container: unknown) => {
    if (!isObjectRecord(container)
      || typeof container.image !== "string"
      || typeof container.image_build_context !== "string") {
      throw new Error("Prepared deployment requires local runner image build inputs.");
    }
    return container;
  });
  const first = containers[0]!;
  if (containers.some((container) =>
    container.image !== first.image
    || container.image_build_context !== first.image_build_context
  )) {
    throw new Error("Prepared runner containers must share one validated image build.");
  }
  // Keep the generated config beside its source so all relative bindings retain meaning.
  const releaseId = randomUUID();
  let image = input.release ? await readReusableHostedRunnerImage({ config: source, ...input.release }) : null;
  if (!image) image = await publishImage({ configDir, first, releaseId, ...input, workerName: source.name });
  const preparedPath = path.join(configDir, `wrangler.image-${releaseId}.jsonc`);
  await writeFile(preparedPath, `${JSON.stringify({
    ...source,
    containers: containers.map(({ image_build_context: _context, ...container }) => ({
      ...container,
      image,
    })),
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return preparedPath;
}

async function publishImage(input: {
  accountId: string; configPath: string; configDir: string;
  first: Record<string, unknown>; releaseId: string; workerName: string;
}): Promise<string> {
  const { configDir, first, releaseId } = input;
  const imageTag = `${input.workerName}:prepared-${releaseId}`;
  try {
    await promisify(execFile)("docker", [
      "build", "--platform", "linux/amd64",
      "--file", path.resolve(configDir, String(first.image)),
      "--tag", imageTag,
      path.resolve(configDir, String(first.image_build_context)),
    ], { maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 });
  } catch {
    // Child-process exceptions contain command paths and unbounded build output.
    throw new Error("Runner image build failed before Worker activation.");
  }
  const pushed = await runWranglerLoggedCaptured([
    "containers", "push", imageTag, "--config", input.configPath,
  ]);
  const digests = new Set(
    [...`${pushed.stdout}\n${pushed.stderr}`.matchAll(/\bdigest:\s+(sha256:[a-f0-9]{64})\s+size:/gu)]
      .map((match) => match[1]),
  );
  if (digests.size !== 1) {
    throw new Error("Runner image publication did not prove one immutable digest; Worker was not activated.");
  }
  return `registry.cloudflare.com/${input.accountId}/${input.workerName}@${[...digests][0]}`;
}
