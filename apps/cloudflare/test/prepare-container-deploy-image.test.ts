import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ build: vi.fn(), push: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.build }));
vi.mock("../scripts/wrangler-runner.ts", () => ({ runWranglerLoggedCaptured: mocks.push }));
import { prepareHostedContainerDeployImage } from "../scripts/prepare-container-deploy-image.ts";

const accountId = "a".repeat(32);
const digest = `sha256:${"b".repeat(64)}`;
let directory: string;
let configPath: string;
const config = {
  name: "synthetic-worker",
  main: "../src/index.ts",
  vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "expected-bundle" },
  containers: ["RunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"].map((className) => ({
    class_name: className,
    image: "../../../Dockerfile.cloudflare-hosted-runner",
    image_build_context: "..",
    max_instances: className === "StandbyRunnerContainer" ? 0 : 1,
  })),
};

describe("container image publication before Worker activation", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "murph-image-prepublish-"));
    configPath = path.join(directory, "wrangler.generated.jsonc");
    await writeFile(configPath, JSON.stringify(config));
    mocks.build.mockReset();
    mocks.build.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));
    mocks.push.mockReset();
    mocks.push.mockResolvedValue({ stdout: `prepared: digest: ${digest} size: 1234\n`, stderr: "" });
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("builds once, publishes once, and pins every fleet to the proven digest without changing other config", async () => {
    const preparedPath = await prepareHostedContainerDeployImage({ accountId, configPath });
    const prepared = JSON.parse(await readFile(preparedPath, "utf8"));
    expect(path.dirname(preparedPath)).toBe(path.dirname(configPath));
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(config);
    expect(prepared).toEqual({
      ...config,
      containers: config.containers.map(({ image_build_context: _context, ...container }) => ({
        ...container,
        image: `registry.cloudflare.com/${accountId}/synthetic-worker@${digest}`,
      })),
    });
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
    const args = mocks.build.mock.calls[0]![1] as string[];
    expect(args).toEqual([
      "build", "--platform", "linux/amd64", "--file",
      path.resolve(directory, config.containers[0]!.image),
      "--tag", expect.stringMatching(/^synthetic-worker:prepared-/u),
      path.resolve(directory, ".."),
    ]);
    expect(mocks.push).toHaveBeenCalledWith(["containers", "push", args[6], "--config", configPath]);
  });

  it("never publishes if the validated image cannot build", async () => {
    mocks.build.mockImplementation((_command, _args, _options, callback) => callback(new Error("synthetic build failure")));
    await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
      .rejects.toThrow("Runner image build failed before Worker activation.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(["", `digest: ${digest} size: 1\ndigest: sha256:${"c".repeat(64)} size: 1`])(
    "rejects missing or ambiguous immutable publication evidence", async (stdout) => {
      mocks.push.mockResolvedValue({ stdout, stderr: "" });
      await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
        .rejects.toThrow("did not prove one immutable digest");
    },
  );

  it("fails before build when fleet image inputs differ", async () => {
    await writeFile(configPath, JSON.stringify({ ...config, containers: [
      config.containers[0], { ...config.containers[1], image: "another-dockerfile" },
    ] }));
    await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
      .rejects.toThrow("share one validated image build");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
