import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV,
  HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
} from "./clean-hosted-web-workflow-artifacts.js";
import {
  deployHostedWebVercelPrebuilt,
  ensureHostedWebVercelPrebuiltWorkflowTriggers,
} from "./deploy-hosted-web-vercel-prebuilt.js";

const STEP_TRIGGER = {
  consumer: "default",
  initialDelaySeconds: 0,
  retryAfterSeconds: 5,
  topic: "__wkf_step_*",
  type: "queue/v2beta",
};
const FLOW_TRIGGER = {
  consumer: "default",
  initialDelaySeconds: 0,
  retryAfterSeconds: 5,
  topic: "__wkf_workflow_*",
  type: "queue/v2beta",
};
const SDK_CONFIG = {
  steps: {
    experimentalTriggers: [STEP_TRIGGER],
    maxDuration: "max",
  },
  version: "0",
  workflows: {
    experimentalTriggers: [FLOW_TRIGGER],
    maxDuration: "max",
  },
};

type Fixture = {
  functionsDir: string;
  outputDir: string;
  root: string;
  sdkConfigPath: string;
};

describe("ensureHostedWebVercelPrebuiltWorkflowTriggers", () => {
  it("repairs one shared final function with every exact SDK-generated trigger", async () => {
    await withFixture(async (fixture) => {
      const sharedFunctionDir = await createFunctionTarget(
        fixture,
        "__next_shared.func",
        { runtime: "nodejs22.x" },
      );
      await linkWorkflowRoute(fixture, "step", sharedFunctionDir);
      await linkWorkflowRoute(fixture, "flow", sharedFunctionDir);

      await ensureHostedWebVercelPrebuiltWorkflowTriggers({
        outputDir: fixture.outputDir,
        sdkConfigPath: fixture.sdkConfigPath,
      });

      await expect(readFunctionConfig(sharedFunctionDir)).resolves.toEqual({
        experimentalTriggers: [STEP_TRIGGER, FLOW_TRIGGER],
        runtime: "nodejs22.x",
      });
    });
  });

  it("repairs distinct final functions without assigning a second route's trigger", async () => {
    await withFixture(async (fixture) => {
      const unrelatedTrigger = {
        consumer: "other",
        topic: "unrelated",
        type: "queue/v2beta",
      };
      const stepFunctionDir = await createFunctionTarget(
        fixture,
        "__next_step.func",
        { experimentalTriggers: [unrelatedTrigger] },
      );
      const flowFunctionDir = await createFunctionTarget(
        fixture,
        "__next_flow.func",
        {},
      );
      await linkWorkflowRoute(fixture, "step", stepFunctionDir);
      await linkWorkflowRoute(fixture, "flow", flowFunctionDir);

      await ensureHostedWebVercelPrebuiltWorkflowTriggers({
        outputDir: fixture.outputDir,
        sdkConfigPath: fixture.sdkConfigPath,
      });

      await expect(readFunctionConfig(stepFunctionDir)).resolves.toEqual({
        experimentalTriggers: [unrelatedTrigger, STEP_TRIGGER],
      });
      await expect(readFunctionConfig(flowFunctionDir)).resolves.toEqual({
        experimentalTriggers: [FLOW_TRIGGER],
      });
    });
  });

  it("is byte-for-byte idempotent after the artifact is valid", async () => {
    await withFixture(async (fixture) => {
      const sharedFunctionDir = await createFunctionTarget(
        fixture,
        "__next_shared.func",
        {},
      );
      await linkWorkflowRoute(fixture, "step", sharedFunctionDir);
      await linkWorkflowRoute(fixture, "flow", sharedFunctionDir);

      await ensureHostedWebVercelPrebuiltWorkflowTriggers({
        outputDir: fixture.outputDir,
        sdkConfigPath: fixture.sdkConfigPath,
      });
      const configPath = path.join(sharedFunctionDir, ".vc-config.json");
      const firstContents = await readFile(configPath, "utf8");

      await ensureHostedWebVercelPrebuiltWorkflowTriggers({
        outputDir: fixture.outputDir,
        sdkConfigPath: fixture.sdkConfigPath,
      });

      await expect(readFile(configPath, "utf8")).resolves.toBe(firstContents);
    });
  });

  it("rejects missing or malformed SDK trigger evidence", async () => {
    await withFixture(async (fixture) => {
      const sharedFunctionDir = await createFunctionTarget(
        fixture,
        "__next_shared.func",
        {},
      );
      await linkWorkflowRoute(fixture, "step", sharedFunctionDir);
      await linkWorkflowRoute(fixture, "flow", sharedFunctionDir);

      await rm(fixture.sdkConfigPath, { force: true });
      await expect(
        ensureHostedWebVercelPrebuiltWorkflowTriggers({
          outputDir: fixture.outputDir,
          sdkConfigPath: fixture.sdkConfigPath,
        }),
      ).rejects.toThrow("captured Workflow SDK config is missing");

      await writeJson(fixture.sdkConfigPath, {
        ...SDK_CONFIG,
        workflows: {
          experimentalTriggers: [
            { ...FLOW_TRIGGER, type: "queue/v1" },
          ],
        },
      });
      await expect(
        ensureHostedWebVercelPrebuiltWorkflowTriggers({
          outputDir: fixture.outputDir,
          sdkConfigPath: fixture.sdkConfigPath,
        }),
      ).rejects.toThrow("is not a valid queue/v2beta trigger");
    });
  });

  it("validates every distinct final function before writing any of them", async () => {
    await withFixture(async (fixture) => {
      const stepFunctionDir = await createFunctionTarget(
        fixture,
        "__next_step.func",
        { runtime: "nodejs22.x" },
      );
      const flowFunctionDir = await createFunctionTarget(
        fixture,
        "__next_flow.func",
        {},
      );
      await writeFile(
        path.join(flowFunctionDir, ".vc-config.json"),
        "not-json",
        "utf8",
      );
      await linkWorkflowRoute(fixture, "step", stepFunctionDir);
      await linkWorkflowRoute(fixture, "flow", flowFunctionDir);
      const stepConfigPath = path.join(stepFunctionDir, ".vc-config.json");
      const originalStepConfig = await readFile(stepConfigPath, "utf8");

      await expect(
        ensureHostedWebVercelPrebuiltWorkflowTriggers({
          outputDir: fixture.outputDir,
          sdkConfigPath: fixture.sdkConfigPath,
        }),
      ).rejects.toThrow("is not valid JSON");
      await expect(readFile(stepConfigPath, "utf8")).resolves.toBe(
        originalStepConfig,
      );
    });
  });

  it("rejects route links that escape the Vercel functions boundary", async () => {
    await withFixture(async (fixture) => {
      const outsideFunctionDir = path.join(fixture.root, "outside.func");
      await mkdir(outsideFunctionDir, { recursive: true });
      await writeJson(path.join(outsideFunctionDir, ".vc-config.json"), {});
      await linkWorkflowRoute(fixture, "step", outsideFunctionDir);
      const flowFunctionDir = await createFunctionTarget(
        fixture,
        "__next_flow.func",
        {},
      );
      await linkWorkflowRoute(fixture, "flow", flowFunctionDir);

      await expect(
        ensureHostedWebVercelPrebuiltWorkflowTriggers({
          outputDir: fixture.outputDir,
          sdkConfigPath: fixture.sdkConfigPath,
        }),
      ).rejects.toThrow("resolves outside its allowed local build boundary");
    });
  });

  it(
    "rejects an existing trigger with the same queue identity but different SDK fields",
    async () => {
      await withFixture(async (fixture) => {
        const sharedFunctionDir = await createFunctionTarget(
          fixture,
          "__next_shared.func",
          {
            experimentalTriggers: [
              STEP_TRIGGER,
              { ...STEP_TRIGGER, retryAfterSeconds: 60 },
            ],
          },
        );
        await linkWorkflowRoute(fixture, "step", sharedFunctionDir);
        await linkWorkflowRoute(fixture, "flow", sharedFunctionDir);

        await expect(
          ensureHostedWebVercelPrebuiltWorkflowTriggers({
            outputDir: fixture.outputDir,
            sdkConfigPath: fixture.sdkConfigPath,
          }),
        ).rejects.toThrow("conflicting Workflow queue trigger");
      });
    },
  );
});

describe("deployHostedWebVercelPrebuilt", () => {
  it("repairs and verifies the artifact before starting the prebuilt upload", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "hosted-web-vercel-prebuilt-command-"),
    );
    const invocations: string[][] = [];
    let capturePath = "";
    let sharedFunctionDir = "";

    try {
      await mkdir(path.join(repoRoot, "apps/web"), { recursive: true });

      await deployHostedWebVercelPrebuilt({
        commandRunner: async (invocation) => {
          invocations.push(invocation.args);
          if (invocation.args[0] === "build") {
            capturePath = getPrebuiltCapturePath(invocation.env);
            const outputDir = path.join(repoRoot, "apps/web/.vercel/output");
            const functionsDir = path.join(outputDir, "functions");
            sharedFunctionDir = path.join(functionsDir, "__next_shared.func");
            await writeJson(capturePath, SDK_CONFIG);
            await writeJson(path.join(outputDir, "config.json"), { version: 3 });
            await writeJson(
              path.join(sharedFunctionDir, ".vc-config.json"),
              { runtime: "nodejs22.x" },
            );
            await linkRoutePath(
              path.join(functionsDir, ".well-known/workflow/v1/step.func"),
              sharedFunctionDir,
            );
            await linkRoutePath(
              path.join(functionsDir, ".well-known/workflow/v1/flow.func"),
              sharedFunctionDir,
            );
            return;
          }

          expect(
            invocation.env[HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV],
          ).toBe(undefined);
          await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
            code: "ENOENT",
          });
          await expect(readFunctionConfig(sharedFunctionDir)).resolves.toEqual({
            experimentalTriggers: [STEP_TRIGGER, FLOW_TRIGGER],
            runtime: "nodejs22.x",
          });
        },
        repoRoot,
        vercelArgs: ["--prod"],
      });

      expect(invocations).toEqual([
        ["build", "--prod"],
        ["deploy", "--prebuilt", "--prod"],
      ]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  it("does not start a prebuilt upload when artifact proof fails", async () => {
    const repoRoot = await mkdtemp(
      path.join(os.tmpdir(), "hosted-web-vercel-prebuilt-command-"),
    );
    const invocations: string[][] = [];
    let capturePath = "";

    try {
      await mkdir(path.join(repoRoot, "apps/web"), { recursive: true });

      await expect(
        deployHostedWebVercelPrebuilt({
          commandRunner: async (invocation) => {
            invocations.push(invocation.args);
            if (invocation.args[0] !== "build") {
              return;
            }

            capturePath = getPrebuiltCapturePath(invocation.env);
            const outputDir = path.join(repoRoot, "apps/web/.vercel/output");
            const functionsDir = path.join(outputDir, "functions");
            await writeJson(capturePath, SDK_CONFIG);
            await writeJson(path.join(outputDir, "config.json"), { version: 3 });
            const stepFunctionDir = path.join(functionsDir, "__next_step.func");
            await writeJson(
              path.join(stepFunctionDir, ".vc-config.json"),
              {},
            );
            await linkRoutePath(
              path.join(
                functionsDir,
                ".well-known/workflow/v1/step.func",
              ),
              stepFunctionDir,
            );
          },
          repoRoot,
        }),
      ).rejects.toThrow("Workflow flow route function is missing");

      expect(invocations).toEqual([["build"]]);
      await expect(readFile(capturePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function getPrebuiltCapturePath(env: NodeJS.ProcessEnv): string {
  const capturePath =
    env[HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV];
  expect(typeof capturePath).toBe("string");
  if (typeof capturePath !== "string") {
    throw new Error("Expected the local prebuilt capture path.");
  }
  expect(path.basename(capturePath)).toBe(
    HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
  );
  return capturePath;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hosted-web-vercel-prebuilt-"));
  const outputDir = path.join(root, ".vercel/output");
  const functionsDir = path.join(outputDir, "functions");
  const sdkConfigPath = path.join(root, "workflow-config.json");

  try {
    await mkdir(functionsDir, { recursive: true });
    await writeJson(path.join(outputDir, "config.json"), { version: 3 });
    await writeJson(sdkConfigPath, SDK_CONFIG);
    await run({ functionsDir, outputDir, root, sdkConfigPath });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function createFunctionTarget(
  fixture: Fixture,
  name: string,
  config: object,
): Promise<string> {
  const functionDir = path.join(fixture.functionsDir, name);
  await writeJson(path.join(functionDir, ".vc-config.json"), config);
  return functionDir;
}

async function linkWorkflowRoute(
  fixture: Fixture,
  routeSegment: "flow" | "step",
  targetDirectory: string,
): Promise<void> {
  await linkRoutePath(
    path.join(
      fixture.functionsDir,
      ".well-known/workflow/v1",
      `${routeSegment}.func`,
    ),
    targetDirectory,
  );
}

async function linkRoutePath(
  routePath: string,
  targetDirectory: string,
): Promise<void> {
  await mkdir(path.dirname(routePath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(routePath), targetDirectory);
  await symlink(relativeTarget, routePath, "dir");
}

async function writeJson(filePath: string, value: object): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readFunctionConfig(functionDir: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(functionDir, ".vc-config.json"), "utf8"),
  );
}
