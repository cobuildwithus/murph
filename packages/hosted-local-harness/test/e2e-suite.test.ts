import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ForegroundCommandSignalError,
  type ForegroundCommandInput,
} from "../src/process.ts";

const runForegroundCommand = vi.hoisted(() =>
  vi.fn(async (_input: ForegroundCommandInput) => {})
);
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedRunnerImages = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioBuildContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));
const cleanupHostedLocalMinioE2eContainersBestEffort = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/process.ts", () => {
  class MockForegroundCommandSignalError extends Error {
    readonly commandSignal: NodeJS.Signals;

    constructor(label: string, signal: NodeJS.Signals) {
      super(`${label} exited with signal ${signal}.`);
      this.name = "ForegroundCommandSignalError";
      this.commandSignal = signal;
    }
  }

  return {
    ForegroundCommandSignalError: MockForegroundCommandSignalError,
    runForegroundCommand,
  };
});

vi.mock("../src/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
}));

vi.mock("../src/dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioBuildContainersBestEffort,
  cleanupHostedLocalMinioE2eContainersBestEffort,
}));

import { runHostedLocalE2eSuite } from "../src/e2e.ts";

const interruptionCases: Array<{
  expectedExitCode: number;
  signal: "SIGHUP" | "SIGINT" | "SIGTERM";
}> = [
  { expectedExitCode: 130, signal: "SIGINT" },
  { expectedExitCode: 143, signal: "SIGTERM" },
  ...(process.platform === "win32"
    ? []
    : [{ expectedExitCode: 129, signal: "SIGHUP" as const }]),
];

function captureSuiteSignalHandlers(): {
  handlers: Map<NodeJS.Signals, Array<() => void>>;
  restore: () => void;
} {
  const handlers = new Map<NodeJS.Signals, Array<() => void>>();
  const originalOnMethod = process.on.bind(process);
  const originalOffMethod = process.off.bind(process);
  const onSpy = vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP") {
      handlers.set(event, [
        ...(handlers.get(event) ?? []),
        listener as () => void,
      ]);
      return process;
    }
    return originalOnMethod(event, listener);
  });
  const offSpy = vi.spyOn(process, "off").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP") {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((handler) => handler !== listener),
      );
      return process;
    }
    return originalOffMethod(event, listener);
  });
  return {
    handlers,
    restore: () => {
      onSpy.mockRestore();
      offSpy.mockRestore();
    },
  };
}

function emitCapturedSignal(
  handlers: Map<NodeJS.Signals, Array<() => void>>,
  signal: NodeJS.Signals,
): void {
  for (const handler of handlers.get(signal) ?? []) {
    handler();
  }
}

describe("hosted-local E2E suite preparation", () => {
  test("prepares stale Worker imports once before every no-bundle scenario", async () => {
    const fixture = await fs.mkdtemp(path.join(tmpdir(), "hosted-local-workspace-artifacts-"));
    const packageDir = path.join(fixture, "packages", "hosted-execution");
    const scenarioArtifacts: string[] = [];
    try {
      await fs.mkdir(path.join(packageDir, "src"), { recursive: true });
      await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });
      await fs.mkdir(path.join(fixture, "apps", "cloudflare"), { recursive: true });
      await fs.writeFile(path.join(fixture, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n  - apps/*\n");
      await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ private: true }));
      await fs.writeFile(path.join(fixture, "apps", "cloudflare", "package.json"), JSON.stringify({
        name: "@murphai/cloudflare-runner",
        dependencies: { "@murphai/hosted-execution": "workspace:*" },
        devDependencies: { "@murphai/dev-only-fixture": "workspace:*" },
        scripts: { build: "node -e 'process.exit(1)'" },
      }));
      await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({
        name: "@murphai/hosted-execution",
        dependencies: { "@murphai/runtime-state": "workspace:*" },
        scripts: { build: "node build.cjs" },
      }));
      const transitiveDir = path.join(fixture, "packages", "runtime-state");
      await fs.mkdir(transitiveDir, { recursive: true });
      await fs.writeFile(path.join(transitiveDir, "package.json"), JSON.stringify({
        name: "@murphai/runtime-state",
        scripts: { build: "node build.cjs" },
      }));
      await fs.writeFile(path.join(transitiveDir, "build.cjs"), "require('node:fs').writeFileSync('built.cjs', 'currentState');\n");
      await fs.writeFile(path.join(transitiveDir, "built.cjs"), "staleState");
      for (const name of ["dev-only-fixture", "unrelated-fixture"]) {
        const dir = path.join(fixture, "packages", name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
          name: `@murphai/${name}`,
          scripts: { build: "node -e 'process.exit(1)'" },
        }));
      }
      await fs.writeFile(path.join(packageDir, "build.cjs"), [
        "const fs = require('node:fs');",
        "if (fs.readFileSync('../runtime-state/built.cjs', 'utf8') !== 'currentState') process.exit(1);",
        "fs.copyFileSync('src/index.cjs', 'dist/index.cjs');",
      ].join("\n"));
      await fs.writeFile(path.join(packageDir, "src", "index.cjs"), "exports.newRouteHelper = () => 'current';\n");
      await fs.writeFile(path.join(packageDir, "dist", "index.cjs"), "exports.oldRouteHelper = () => 'stale';\n");
      runForegroundCommand.mockImplementation(async ({ command, args }) => {
        if (args.includes("--filter-prod")) {
          await new Promise<void>((resolve, reject) => {
            execFile(command, [...args], { cwd: fixture }, (error) => error ? reject(error) : resolve());
          });
        }
        if (args.includes("vitest")) {
          scenarioArtifacts.push(await fs.readFile(path.join(packageDir, "dist", "index.cjs"), "utf8"));
        }
      });
      await runHostedLocalE2eSuite({
        env: {},
        prepareRunnerBundle: false,
        scenario: ["checkpoint-baseline", "foreground-reply-priority"],
      });
      expect(scenarioArtifacts.length).toBeGreaterThan(1);
      for (const artifact of scenarioArtifacts) {
        expect(artifact).toContain("newRouteHelper");
        expect(artifact).not.toContain("oldRouteHelper");
      }
      expect(runForegroundCommand.mock.calls.filter(([call]) => call.args.includes("--filter-prod"))).toHaveLength(1);
      expect(runForegroundCommand.mock.calls.some(([call]) => call.args.includes("runner:bundle:hosted-local"))).toBe(false);
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    runForegroundCommand.mockResolvedValue(undefined);
    vi.unstubAllEnvs();
  });

  test("process shards partition the actual unsharded Vitest invocations exactly once", async () => {
    const commands = () => runForegroundCommand.mock.calls
      .map(([input]) => input)
      .filter((input) => input.args.includes("vitest"))
      .map((input) => input.args);
    await runHostedLocalE2eSuite({ env: {}, prepareRunnerBundle: false, scenario: "foreground-reply-priority" });
    const complete = commands();
    expect(complete).toHaveLength(2);
    runForegroundCommand.mockClear();
    for (const processShard of ["1/2", "2/2"]) {
      await runHostedLocalE2eSuite({ env: {}, prepareRunnerBundle: false, scenario: "foreground-reply-priority", processShard });
    }
    expect(commands()).toEqual(complete);
  });

  test.each(["", "0/2", "3/2", "1/1", "1/3", "1/2junk", "9007199254740993/2"])(
    "rejects invalid or stale process inventory %s before setup",
    async (processShard) => {
      await expect(runHostedLocalE2eSuite({ env: {}, scenario: "foreground-reply-priority", processShard })).rejects.toThrow("complete declared process inventory");
      expect(runForegroundCommand).not.toHaveBeenCalled();
      expect(cleanupHostedRunnerContainers).not.toHaveBeenCalled();
    },
  );

  test("does not shard an aggregate suite or a scenario without process groups", async () => {
    for (const scenario of ["all", "linq-webhook"]) {
      await expect(runHostedLocalE2eSuite({ env: {}, scenario, processShard: "1/2" })).rejects.toThrow("complete declared process inventory");
    }
    expect(runForegroundCommand).not.toHaveBeenCalled();
  });

  test("prepares generated inputs once for one scenario with two processes", async () => {
    await runHostedLocalE2eSuite({
      env: {}, prepareRunnerBundle: false, scenario: "foreground-reply-priority",
    });
    const calls = runForegroundCommand.mock.calls.map(([call]) => call);
    expect(calls.filter((call) => call.args.includes("prisma:generate"))).toHaveLength(1);
    expect(calls.filter((call) => call.args.includes("health-commons:generate"))).toHaveLength(1);
    const children = calls.filter((call) => call.args.includes("vitest"));
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.env).toEqual(expect.objectContaining({
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      }));
    }
  });

  test.each(["prisma:generate", "health-commons:generate"])(
    "does not launch either foreground process when %s preparation fails",
    async (failedCommand) => {
      runForegroundCommand.mockImplementation(async (input) => {
        if (input.args.includes(failedCommand)) throw new Error("generation failed");
      });
      await expect(runHostedLocalE2eSuite({
        env: {}, prepareRunnerBundle: false, scenario: "foreground-reply-priority",
      })).rejects.toThrow("generation failed");
      expect(runForegroundCommand.mock.calls.some(([call]) => call.args.includes("vitest"))).toBe(false);
    },
  );

  test("prepares generated web artifacts once for aggregate scenario runs", async () => {
    const env: NodeJS.ProcessEnv = {};

    await runHostedLocalE2eSuite({
      env,
      prepareRunnerBundle: false,
      scenario: "all",
    });

    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/cloudflare", "runner:docker:base"],
      command: "pnpm",
      label: "Hosted local runner base image preparation",
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/web", "prisma:generate"],
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
        MURPH_DEV_SKIP_RUNNER_DOCKER_BASE: "1",
      }),
      label: "Hosted local web Prisma client preparation",
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["health-commons:generate"],
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      }),
      label: "Hosted local Health Commons generation",
    }));
    const vitestCalls = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .filter((call) => call.args.includes("vitest"));
    expect(vitestCalls).toHaveLength(26);
    expect(vitestCalls[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_DEV_CF_PERSIST_DIR: expect.stringContaining(".tmp/hosted-local-e2e/"),
        MURPH_DEV_WEB_PORT: expect.stringMatching(/^[3-9][0-9]{4}$/u),
        MURPH_DEV_WORKER_PORT: expect.stringMatching(/^[4-9][0-9]{4}$/u),
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: expect.stringMatching(/^e2e-hosted-local-e2e-/u),
        TEMPORAL_DEV_HEADLESS: "1",
      }),
      label: "Hosted local full-stack e2e suite 1/25",
    }));
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    );
    expect(vitestCalls[0]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[1]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-canonical-receipt-lost-ack-recovery-e2e.test.ts",
      ]),
      command: "pnpm",
      label:
        "Hosted local full-stack e2e scenario 2/25 canonical-receipt-lost-ack-recovery",
    }));
    expect(vitestCalls[1]?.args).not.toContain("--bail");
    expect(vitestCalls[1]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[1]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[1]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[2]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 3/25 idle-checkpoint-deferred-progress",
    }));
    expect(vitestCalls[2]?.args).not.toContain("--bail");
    expect(vitestCalls[2]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[2]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[2]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[3]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-idle-checkpoint-runtime-handoff-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 4/25 idle-checkpoint-runtime-handoff",
    }));
    expect(vitestCalls[3]?.args).not.toContain("--bail");
    expect(vitestCalls[3]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[3]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[3]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[4]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-group-email-newsletter-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 5/25 group-email-newsletter",
    }));
    expect(vitestCalls[4]?.args).not.toContain("--bail");
    expect(vitestCalls[4]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[4]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[4]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[4]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[5]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-group-sleep-source-sharing-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-home-line-reroute-retry-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-family-sponsored-group-roundtrip-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-unknown-first-contact-fallback-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 6/25",
    }));
    expect(vitestCalls[5]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[6]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 7/25 linq-first-contact-test-controls",
    }));
    expect(vitestCalls[6]?.args).not.toContain("--bail");
    expect(vitestCalls[6]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[6]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[7]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 8/25 linq-onboarding-followup",
    }));
    expect(vitestCalls[7]?.args).not.toContain("--bail");
    expect(vitestCalls[7]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    );
    expect(vitestCalls[7]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[7]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[7]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[8]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-openai-egress-authority-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 9/25 openai-egress-authority",
    }));
    expect(vitestCalls[8]?.args).not.toContain("--bail");
    expect(vitestCalls[8]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[8]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[9]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-provider-egress-token-bridge-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 10/25 provider-egress-token-bridge",
    }));
    expect(vitestCalls[9]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[10]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-warm-reuse-egress-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 11/25 warm-reuse-egress",
    }));
    expect(vitestCalls[10]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
      .toBeUndefined();
    expect(vitestCalls[11]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 12/25 linq-scheduled-reminder",
    }));
    expect(vitestCalls[11]?.args).not.toContain("--bail");
    expect(vitestCalls[11]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    );
    expect(vitestCalls[11]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[11]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[11]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[12]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 13/25 telegram-scheduled-reminder",
    }));
    expect(vitestCalls[12]?.args).not.toContain("--bail");
    expect(vitestCalls[12]?.args).not.toContain(
      "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    );
    expect(vitestCalls[12]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[12]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[12]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[13]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-webhook-audio-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 14/25 linq-webhook-audio",
    }));
    expect(vitestCalls[13]?.args).not.toContain("--bail");
    expect(vitestCalls[13]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[13]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[13]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    expect(vitestCalls[14]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-linq-same-wake-batching-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
      ]),
      command: "pnpm",
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 15/25",
    }));
    expect(vitestCalls[15]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-snapshot-publication-fallback-e2e.test.ts",
      ]),
      command: "pnpm",
      label:
        "Hosted local full-stack e2e scenario 16/25 snapshot-publication-fallback",
    }));
    expect(vitestCalls[15]?.args).not.toContain("--bail");
    expect(vitestCalls[15]?.env).toEqual(expect.objectContaining({
      MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
      MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
        expect.stringMatching(/^hosted-local-e2e-/u),
    }));
    expect(vitestCalls[15]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
      .toBeUndefined();
    expect(vitestCalls[15]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
      .toBeUndefined();
    for (const [index, name, file, usesTestControls] of [
      [16, "computer-handoff-linq-roundtrip", "hosted-local-computer-handoff-linq-roundtrip", false],
      [17, "retell-call-result-roundtrip", "hosted-local-retell-call-result-roundtrip", true],
      [18, "usage-limit-ambiguous-send", "hosted-local-usage-limit-ambiguous-send", false],
      [19, "codex-image-media-delivery", "hosted-local-codex-image-media-delivery", true],
      [20, "retryable-outbox-foreground-restart", "hosted-local-retryable-outbox-foreground-restart", true],
      [21, "shutdown-checkpoint-conversation-ahead", "hosted-local-shutdown-checkpoint-conversation-ahead", true],
      [22, "vault-file-approval-resume", "hosted-local-vault-file-approval-resume", true],
    ] as const) {
      expect(vitestCalls[index]).toEqual(expect.objectContaining({
        args: expect.arrayContaining([
          `apps/cloudflare/test/${file}-e2e.test.ts`,
        ]),
        command: "pnpm",
        label: `Hosted local full-stack e2e scenario ${index + 1}/25 ${name}`,
      }));
      expect(vitestCalls[index]?.args).not.toContain("--bail");
      expect(vitestCalls[index]?.env).toEqual(expect.objectContaining({
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
        ...(usesTestControls
          ? { MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1" }
          : {}),
      }));
      if (!usesTestControls) {
        expect(vitestCalls[index]?.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS)
          .toBeUndefined();
      }
      expect(vitestCalls[index]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE)
        .toBe(usesTestControls ? undefined : "1");
      expect(vitestCalls[index]?.env.MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID)
        .toBeUndefined();
    }
    expect(vitestCalls[23]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-analyze-video-roundtrip-e2e.test.ts",
      ]),
      command: "pnpm",
      label: "Hosted local full-stack e2e scenario 24/25 analyze-video-roundtrip",
    }));
    expect(vitestCalls[23]?.env).toEqual(expect.objectContaining({
      MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
    }));
    for (const [index, processIndex, testNamePattern] of [
      [24, 1, "^hosted local foreground reply priority e2e"],
      [25, 2, "^hosted local foreground checkpoint ordering e2e"],
    ] as const) {
      expect(vitestCalls[index]).toEqual(expect.objectContaining({
        args: expect.arrayContaining([
          "apps/cloudflare/test/hosted-local-foreground-reply-priority-e2e.test.ts",
          "--testNamePattern",
          testNamePattern,
        ]),
        command: "pnpm",
        label:
          `Hosted local full-stack e2e scenario 25/25 foreground-reply-priority process ${processIndex}/2`,
      }));
      expect(vitestCalls[index]?.env).toEqual(expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
      }));
    }
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledTimes(28);
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(expect.objectContaining({
      ignoreErrors: false,
      scope: "current-build",
      timeoutMs: 60_000,
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(expect.objectContaining({
      ignoreErrors: true,
      timeoutMs: 60_000,
    }));
    expect(cleanupHostedLocalMinioBuildContainersBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID:
          expect.stringMatching(/^hosted-local-e2e-/u),
      }),
      expect.stringMatching(/^hosted-local-e2e-/u),
    );
    expect(cleanupHostedLocalMinioE2eContainersBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      }),
    );
  });

  test("stops before scenario launch when Worker dependency preparation fails", async () => {
    runForegroundCommand.mockRejectedValueOnce(new Error("synthetic Worker dependency build failed"));
    await expect(runHostedLocalE2eSuite({
      env: {}, prepareRunnerBundle: false, scenario: "checkpoint-baseline",
    })).rejects.toThrow("synthetic Worker dependency build failed");
    expect(runForegroundCommand).toHaveBeenCalledTimes(1);
    expect(runForegroundCommand.mock.calls[0]?.[0].args).toContain("--filter-prod");
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
  });

  test("closes scenario admission when Worker dependency preparation is interrupted", async () => {
    const signals = captureSuiteSignalHandlers();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    runForegroundCommand.mockImplementationOnce(async (input) => {
      expect(input.args).toContain("--filter-prod");
      emitCapturedSignal(signals.handlers, "SIGTERM");
      throw new ForegroundCommandSignalError(input.label, "SIGTERM");
    });
    try {
      await expect(runHostedLocalE2eSuite({
        env: {}, prepareRunnerBundle: false, scenario: "checkpoint-baseline",
      })).resolves.toEqual({ terminationSignal: "SIGTERM" });
      expect(runForegroundCommand).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(143);
      expect(signals.handlers.get("SIGTERM")).toEqual([]);
      expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
    } finally {
      process.exitCode = originalExitCode;
      signals.restore();
    }
  });

  test("scrubs inherited web session authority before E2E preparation", async () => {
    const authority = "web-session-authority";
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", authority);

    await runHostedLocalE2eSuite({
      env: { HOSTED_APP_SESSION_HMAC_KEY: authority },
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    for (const [input] of runForegroundCommand.mock.calls) {
      expect(input.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    }
  });

  test("runs unrelated scenarios with shared Stripe checkout catalog values", async () => {
    const sharedCatalog = {
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_pulse",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_edge",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_familypulse",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY: "price_familyedge",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY: "price_familymax",
      HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY:
        "bpc_edge",
    };

    await runHostedLocalE2eSuite({
      env: sharedCatalog,
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    const vitestCall = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .find((call) => call.args.includes("vitest"));
    expect(vitestCall?.env).toEqual(expect.objectContaining(sharedCatalog));
  });

  test("gives live wearable login values only to the isolated device-connect Vitest child", async () => {
    const retiredOuraPassword = "retired-sentinel-oura-password";
    const liveValues = {
      JUNCTION_API_KEY: "sk_us_sentinel",
      JUNCTION_CLIENT_USER_ID_SECRET: "sentinel-client-user-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
      KERNEL_API_KEY: "kernel-sentinel-key",
      MURPH_E2E_GARMIN_EMAIL: "garmin@example.test",
      MURPH_E2E_GARMIN_PASSWORD: "sentinel-garmin-password",
      MURPH_E2E_JUNCTION_GARMIN_MEMBER_ID: "member-garmin",
      MURPH_E2E_JUNCTION_OURA_MEMBER_ID: "member-oura",
      MURPH_E2E_JUNCTION_WEARABLE_LIVE: "1",
      MURPH_E2E_JUNCTION_WEARABLE_SOURCES: "garmin",
      MURPH_E2E_JUNCTION_WHOOP_MEMBER_ID: "member-whoop",
      MURPH_E2E_KERNEL_CLI_PATH: "/opt/kernel-tools/kernel",
      MURPH_E2E_OURA_EMAIL: "oura@example.test",
      MURPH_E2E_OURA_OTP: "234567",
      MURPH_E2E_PROVIDER_BROWSER: "kernel",
      MURPH_E2E_WEARABLE_HEADLESS: "1",
      MURPH_E2E_WEARABLE_TIMEOUT_MS: "180000",
      MURPH_E2E_WHOOP_EMAIL: "whoop@example.test",
      MURPH_E2E_WHOOP_OTP: "123456",
      MURPH_E2E_WHOOP_PASSWORD: "sentinel-whoop-password",
    };

    await runHostedLocalE2eSuite({
      env: {
        ...liveValues,
        MURPH_E2E_OURA_PASSWORD: retiredOuraPassword,
      },
      scenario: "device-connect",
    });

    const vitestCalls = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .filter((call) => call.args.includes("vitest"));
    expect(vitestCalls).toHaveLength(1);
    expect(vitestCalls[0]?.env).toEqual(expect.objectContaining(liveValues));
    expect(vitestCalls[0]?.env.MURPH_E2E_OURA_PASSWORD).toBeUndefined();
    expect(JSON.stringify(vitestCalls[0]?.env)).not.toContain(retiredOuraPassword);
    for (const [call] of runForegroundCommand.mock.calls) {
      if (call.args.includes("vitest")) {
        continue;
      }
      expect(call.env.MURPH_E2E_OURA_PASSWORD).toBeUndefined();
      expect(JSON.stringify(call.env)).not.toContain(retiredOuraPassword);
      for (const key of Object.keys(liveValues)) {
        expect(call.env[key]).toBeUndefined();
      }
    }
    for (const [cleanupInput] of [
      ...cleanupHostedRunnerContainers.mock.calls,
      ...cleanupHostedRunnerImages.mock.calls,
    ]) {
      expect(cleanupInput.env.MURPH_E2E_OURA_PASSWORD).toBeUndefined();
      expect(JSON.stringify(cleanupInput.env)).not.toContain(retiredOuraPassword);
      for (const key of Object.keys(liveValues)) {
        expect(cleanupInput.env[key]).toBeUndefined();
      }
    }
  });

  test("rejects a live wearable run before preparation unless device-connect is isolated", async () => {
    await expect(runHostedLocalE2eSuite({
      env: {
        MURPH_E2E_JUNCTION_WEARABLE_LIVE: "1",
        MURPH_E2E_WHOOP_EMAIL: "canary@example.test",
        MURPH_E2E_WHOOP_PASSWORD: "sentinel-password",
      },
      scenario: ["device-connect", "checkpoint-baseline"],
    })).rejects.toThrow(
      "Run the live Junction wearable browser proof by itself",
    );

    expect(runForegroundCommand).not.toHaveBeenCalled();
    expect(cleanupHostedRunnerContainers).not.toHaveBeenCalled();
    expect(cleanupHostedRunnerImages).not.toHaveBeenCalled();
  });

  test("cleans up runner artifacts when a focused scenario fails", async () => {
    runForegroundCommand.mockImplementation(async (input) => {
      if (input.args.includes("vitest")) {
        throw new Error("synthetic hosted-local scenario failure");
      }
    });

    await expect(runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    })).rejects.toThrow("synthetic hosted-local scenario failure");

    expect(cleanupHostedRunnerContainers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ignoreErrors: true,
        scope: "current-build",
        timeoutMs: 60_000,
      }),
    );
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
    expect(cleanupHostedLocalMinioE2eContainersBestEffort).toHaveBeenCalled();
  });

  test("runs an explicit scenario group in one prepared suite", async () => {
    await runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: ["linq-delivery", "temporal-orchestration"],
    });

    const vitestCalls = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .filter((call) => call.args.includes("vitest"));
    expect(vitestCalls).toHaveLength(1);
    expect(vitestCalls[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
        "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
        "--bail",
        "1",
      ]),
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e suite 1/1",
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
  });

  test.each(interruptionCases)(
    "preserves $signal exit semantics while cleaning up runner artifacts",
    async ({ expectedExitCode, signal }) => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;

      try {
        runForegroundCommand.mockImplementation(async (input) => {
          if (!input.args.includes("vitest")) {
            return;
          }
          expect(input.forwardProcessSignals).toBeUndefined();
          emitCapturedSignal(signalCapture.handlers, signal);
          emitCapturedSignal(signalCapture.handlers, signal);
          throw new ForegroundCommandSignalError(input.label, signal);
        });

        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "checkpoint-baseline",
        })).resolves.toEqual({ terminationSignal: signal });

        expect(process.exitCode).toBe(expectedExitCode);
        expect(cleanupHostedRunnerContainers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            ignoreErrors: true,
            scope: "current-build",
            timeoutMs: 60_000,
          }),
        );
        expect(cleanupHostedRunnerImages).toHaveBeenCalledTimes(1);
        expect(signalCapture.handlers.get(signal)).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

  test.each(interruptionCases)(
    "closes work admission when $signal arrives during pre-scenario cleanup",
    async ({ expectedExitCode, signal }) => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      cleanupHostedRunnerContainers.mockImplementationOnce(async () => {
        emitCapturedSignal(signalCapture.handlers, signal);
        emitCapturedSignal(signalCapture.handlers, signal);
      });

      try {
        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "checkpoint-baseline",
        })).resolves.toEqual({ terminationSignal: signal });

        const vitestCalls = runForegroundCommand.mock.calls
          .map(([call]) => call)
          .filter((call) => call.args.includes("vitest"));
        expect(vitestCalls).toHaveLength(0);
        expect(process.exitCode).toBe(expectedExitCode);
        expect(signalCapture.handlers.get(signal)).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

  test.runIf(process.platform !== "win32")(
    "closes batch admission when SIGHUP arrives during between-batch cleanup",
    async () => {
      const signalCapture = captureSuiteSignalHandlers();
      const originalExitCode = process.exitCode;
      process.exitCode = undefined;
      cleanupHostedRunnerContainers
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          emitCapturedSignal(signalCapture.handlers, "SIGHUP");
          emitCapturedSignal(signalCapture.handlers, "SIGHUP");
        });

      try {
        await expect(runHostedLocalE2eSuite({
          env: {},
          prepareRunnerBundle: false,
          scenario: "all",
        })).resolves.toEqual({ terminationSignal: "SIGHUP" });

        const vitestCalls = runForegroundCommand.mock.calls
          .map(([call]) => call)
          .filter((call) => call.args.includes("vitest"));
        expect(vitestCalls).toHaveLength(1);
        expect(process.exitCode).toBe(129);
        expect(signalCapture.handlers.get("SIGHUP")).toEqual([]);
      } finally {
        process.exitCode = originalExitCode;
        signalCapture.restore();
      }
    },
  );

  test("does not add aggregate-only web preparation for one focused scenario", async () => {
    await runHostedLocalE2eSuite({
      env: {},
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    expect(runForegroundCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["--dir", "apps/web", "prisma:generate"],
    }));
    expect(runForegroundCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["health-commons:generate"],
    }));
    expect(runForegroundCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
      ]),
      env: expect.objectContaining({
        MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE: "1",
      }),
      label: "Hosted local full-stack e2e scenario 1/1 checkpoint-baseline",
    }));
  });

  test("preserves caller-provided E2E isolation overrides", async () => {
    await runHostedLocalE2eSuite({
      env: {
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/custom-wrangler",
        MURPH_DEV_WEB_PORT: "35123",
        MURPH_DEV_WORKER_PORT: "45123",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fixed-build",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "custom-dist",
        TEMPORAL_DEV_HEADLESS: "0",
      },
      prepareRunnerBundle: false,
      scenario: "checkpoint-baseline",
    });

    const vitestCall = runForegroundCommand.mock.calls
      .map(([call]) => call)
      .find((call) => call.args.includes("vitest"));
    expect(vitestCall?.env).toEqual(expect.objectContaining({
      MURPH_DEV_CF_PERSIST_DIR: ".tmp/custom-wrangler",
      MURPH_DEV_WEB_PORT: "35123",
      MURPH_DEV_WORKER_PORT: "45123",
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "fixed-build",
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: "custom-dist",
      TEMPORAL_DEV_HEADLESS: "0",
    }));
  });
});
