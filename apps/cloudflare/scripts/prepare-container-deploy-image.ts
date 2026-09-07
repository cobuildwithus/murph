import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isObjectRecord } from "./deploy-automation/shared.ts";
import { runWranglerLoggedCaptured } from "./wrangler-runner.ts";

/** Publish the immutable image before native admission or Worker version activation. */
export async function prepareHostedContainerDeployImage(input: {
  accountId: string;
  configPath: string;
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
  const imageTag = `${source.name}:prepared-${releaseId}`;
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
  const image = `registry.cloudflare.com/${input.accountId}/${source.name}@${[...digests][0]}`;
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
