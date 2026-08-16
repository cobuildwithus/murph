import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { WorkflowClient } from "@temporalio/client";
import { afterEach, test, vi } from "vitest";

import { register } from "../instrumentation";
import {
  installHostedLocalTemporalMailboxSignalFault,
} from "./support/hosted-local-temporal-mailbox-signal-fault-test-hook";

const execFileAsync = promisify(execFile);
const appDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appDir, "../..");
const compiledPreloadOutputParent = path.join(
  appDir,
  ".test-dist",
  "hosted-local-preload-unit",
);
const compiledPreloadOutputDirs: string[] = [];
const preparedSmokeArtifact = await resolvePreparedSmokeArtifact();

function createEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    compiledPreloadOutputDirs.splice(0).map(async (outputDir) => {
      await rm(outputDir, { force: true, recursive: true });
    }),
  );
  await rm(compiledPreloadOutputParent, { force: true, recursive: true });
});

test("production Web bootstrap contains no hosted-local Temporal fault hook", async () => {
  const [instrumentationSource, nextConfigSource] = await Promise.all([
    readFile(path.join(appDir, "instrumentation.ts"), "utf8"),
    readFile(path.join(appDir, "next.config.ts"), "utf8"),
  ]);

  for (const source of [instrumentationSource, nextConfigSource]) {
    assert.doesNotMatch(
      source,
      /HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT|hosted-local-temporal-mailbox-signal-fault/u,
    );
  }
  await assert.rejects(
    access(path.join(
      appDir,
      "src/lib/hosted-local-temporal-mailbox-signal-fault-test-hook.ts",
    )),
  );
});

test("hosted-local Temporal fault hook requires exact E2E test controls and member", () => {
  const clientPrototype = {
    signalWithStart:
      vi.fn() as unknown as WorkflowClient["signalWithStart"],
  };
  const enabledEnvironment = createEnv({
    MURPH_DEV_WORKER_PORT: "8787",
    MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID: "member_target",
    MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
  });

  assert.doesNotThrow(() => {
    installHostedLocalTemporalMailboxSignalFault(
      enabledEnvironment,
      clientPrototype,
    );
  });

  for (const environment of [
    createEnv({ ...enabledEnvironment, MURPH_HOSTED_LOCAL_PROFILE: "dev" }),
    createEnv({ ...enabledEnvironment, MURPH_HOSTED_LOCAL_PROFILE: "e2e:other" }),
    createEnv({ ...enabledEnvironment, MURPH_HOSTED_LOCAL_TEST_ROUTES: "0" }),
  ]) {
    assert.throws(
      () => installHostedLocalTemporalMailboxSignalFault(environment, {
        signalWithStart:
          vi.fn() as unknown as WorkflowClient["signalWithStart"],
      }),
      /requires the hosted-local E2E test-control profile/u,
    );
  }

  assert.throws(
    () => installHostedLocalTemporalMailboxSignalFault(createEnv({
      ...enabledEnvironment,
      MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID: "",
    }), {
      signalWithStart:
        vi.fn() as unknown as WorkflowClient["signalWithStart"],
    }),
    /MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID is required/u,
  );
});

test("hosted-local Temporal fault hook is one-shot and consumes only the configured member", async () => {
  const expectedUserId = "member_fault_target";
  const originalResult = { runId: "original-run" };
  const originalSignalWithStart = vi.fn(async () => originalResult);
  const clientPrototype = {
    signalWithStart:
      originalSignalWithStart as unknown as WorkflowClient["signalWithStart"],
  };
  const fetchMock = vi.fn(async () => Response.json({ consume: true }));
  vi.stubGlobal("fetch", fetchMock);

  const environment = createEnv({
    MURPH_DEV_WORKER_PORT: "8787",
    MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID: expectedUserId,
    MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
  });
  installHostedLocalTemporalMailboxSignalFault(environment, clientPrototype);

  type SignalWithStartForTest = (
    workflowType: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  const signalWithStart =
    clientPrototype.signalWithStart as unknown as SignalWithStartForTest;
  const matchingOptions = {
    args: [{ userId: expectedUserId }],
    signal: "runtimeSignal",
    signalArgs: [{
      kind: "mailbox_appended",
      lane: "system",
      mailboxItemId: "mailbox-item-1",
    }],
    taskQueue: "hosted-runtime",
    workflowId: `hosted-user-runtime:${expectedUserId}`,
  };

  await assert.rejects(
    () => signalWithStart("hostedUserRuntimeWorkflow", matchingOptions),
    /Hosted-local Temporal mailbox signal fault injection/u,
  );
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(originalSignalWithStart.mock.calls.length, 0);

  const otherUserId = "member_other";
  const bypassCases: readonly [string, Record<string, unknown>][] = [
    ["otherWorkflow", matchingOptions],
    ["hostedUserRuntimeWorkflow", {
      ...matchingOptions,
      args: [{ userId: otherUserId }],
      workflowId: `hosted-user-runtime:${otherUserId}`,
    }],
    ["hostedUserRuntimeWorkflow", {
      ...matchingOptions,
      signal: "otherSignal",
    }],
    ["hostedUserRuntimeWorkflow", {
      ...matchingOptions,
      signalArgs: [{
        kind: "mailbox_appended",
        lane: "foreground",
        mailboxItemId: "mailbox-item-1",
      }],
    }],
    ["hostedUserRuntimeWorkflow", {
      ...matchingOptions,
      workflowId: "hosted-user-runtime:other-workflow-id",
    }],
  ];
  for (const [workflowType, options] of bypassCases) {
    const result = await signalWithStart(workflowType, options);
    assert.equal(result, originalResult);
  }
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(originalSignalWithStart.mock.calls.length, bypassCases.length);

  assert.doesNotThrow(() => {
    installHostedLocalTemporalMailboxSignalFault(environment, clientPrototype);
  });
  assert.equal(clientPrototype.signalWithStart, signalWithStart);
});

test("compiled harness preload patches the Web process physical Temporal client", async () => {
  const preloadPath = await compileHostedLocalTemporalMailboxSignalFaultPreload();
  const baselineDigest = await readTemporalSignalWithStartDigest();
  const preloadDigest = await readTemporalSignalWithStartDigest(preloadPath);

  assert.notEqual(preloadDigest, baselineDigest);
});

test("Next source instrumentation register leaves the app Temporal client unchanged", async () => {
  assert.equal(
    await runInstrumentationRegisterProbe({
      instrumentationPath: path.join(appDir, "instrumentation.ts"),
      nodeEnvironment: "development",
      useTsx: true,
    }),
    "inactive",
  );
});

test.skipIf(
  preparedSmokeArtifact === null || readNodeMajorVersion() < 24,
)("prepared smoke instrumentation register leaves the app Temporal client unchanged", async () => {
  assert(preparedSmokeArtifact !== null);
  assert.equal(
    await runInstrumentationRegisterProbe({
      instrumentationPath: preparedSmokeArtifact.instrumentationPath,
      nodeEnvironment: "production",
      useTsx: false,
    }),
    "inactive",
  );
});

test.skipIf(
  preparedSmokeArtifact === null,
)("prepared smoke request bundle external resolves to the Web physical Temporal client", async () => {
  assert(preparedSmokeArtifact !== null);
  const routePath = path.join(
    preparedSmokeArtifact.distDir,
    "server/app/api/ops/runtime-maintenance/route.js",
  );
  const routeSource = await readFile(routePath, "utf8");
  const chunkPaths = [
    ...routeSource.matchAll(/\b[A-Za-z_$][\w$]*\.c\("([^"]+)"\)/gu),
  ]
    .map((match) => path.join(preparedSmokeArtifact.distDir, match[1] ?? ""));
  const chunkSources = await Promise.all(
    chunkPaths.map(async (chunkPath) => await readFile(chunkPath, "utf8")),
  );
  const temporalExternalName = chunkSources
    .map((source) =>
      source.match(/\.x\("(@temporalio\/client-[^"]+)"/u)?.[1] ?? null
    )
    .find((value): value is string => value !== null);
  assert(temporalExternalName, "Emitted request bundle must externalize @temporalio/client.");

  const emittedRequire = createRequire(routePath);
  const appRequire = createRequire(path.join(appDir, "package.json"));
  assert.equal(
    await realpath(emittedRequire.resolve(temporalExternalName)),
    await realpath(appRequire.resolve("@temporalio/client")),
  );
});

test("Next ignores hosted-local fault environment outside the Node request runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  vi.stubEnv("MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD", "1");
  await assert.doesNotReject(() => register());
});

async function compileHostedLocalTemporalMailboxSignalFaultPreload(): Promise<string> {
  await mkdir(compiledPreloadOutputParent, { recursive: true });
  const outputDir = await mkdtemp(path.join(compiledPreloadOutputParent, "compiled-"));
  compiledPreloadOutputDirs.push(outputDir);
  try {
    await execFileAsync("pnpm", [
      "--dir",
      "apps/web",
      "exec",
      "tsc",
      "test/support/hosted-local-temporal-mailbox-signal-fault-preload.ts",
      "--target",
      "ES2022",
      "--module",
      "CommonJS",
      "--moduleResolution",
      "Node",
      "--skipLibCheck",
      "--noEmitOnError",
      "--outDir",
      path.relative(appDir, outputDir),
      "--rootDir",
      "test/support",
    ], {
      cwd: repoRoot,
      env: createEnv({ NODE_OPTIONS: "" }),
    });
  } catch (error) {
    throw new Error(
      `Hosted-local preload compilation failed: ${readSubprocessStderr(error)}`,
    );
  }

  const preloadPath = path.join(
    outputDir,
    "hosted-local-temporal-mailbox-signal-fault-preload.js",
  );
  await access(preloadPath);
  return preloadPath;
}

async function readTemporalSignalWithStartDigest(
  preloadPath?: string,
): Promise<string> {
  const temporalClientUrl = pathToFileURL(
    path.join(appDir, "node_modules/@temporalio/client/lib/index.js"),
  ).href;
  const script = [
    "void (async () => {",
    "const { createHash } = await import('node:crypto');",
    `const { WorkflowClient } = await import(${JSON.stringify(temporalClientUrl)});`,
    "const source = Function.prototype.toString.call(WorkflowClient.prototype.signalWithStart);",
    "process.stdout.write(createHash('sha256').update(source).digest('hex'));",
    "})().catch((error) => { console.error(error); process.exitCode = 1; });",
  ].join("\n");
  const nodeOptions = preloadPath === undefined
    ? ""
    : `--require=${JSON.stringify(preloadPath)}`;

  try {
    const { stdout } = await execFileAsync("pnpm", [
      "--dir",
      "apps/web",
      "exec",
      process.execPath,
      "--eval",
      script,
    ], {
      cwd: repoRoot,
      env: createEnv({
        MURPH_DEV_WORKER_PORT: "8787",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID:
          "member_subprocess_target",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_OPTIONS: nodeOptions,
      }),
    });
    return stdout;
  } catch (error) {
    throw new Error(
      `Temporal client identity subprocess failed: ${readSubprocessStderr(error)}`,
    );
  }
}

async function runInstrumentationRegisterProbe(input: {
  instrumentationPath: string;
  nodeEnvironment: string;
  useTsx: boolean;
}): Promise<string> {
  const instrumentationUrl = pathToFileURL(input.instrumentationPath).href;
  const temporalClientUrl = pathToFileURL(
    path.join(appDir, "node_modules/@temporalio/client/lib/index.js"),
  ).href;
  const script = [
    "void (async () => {",
    `const { WorkflowClient } = await import(${JSON.stringify(temporalClientUrl)});`,
    "const original = WorkflowClient.prototype.signalWithStart;",
    `const instrumentation = await import(${JSON.stringify(instrumentationUrl)});`,
    "const register = instrumentation.register ?? instrumentation.default?.register;",
    "if (typeof register !== 'function') throw new TypeError('Next instrumentation register export is missing.');",
    "await register();",
    "process.stdout.write(WorkflowClient.prototype.signalWithStart === original ? 'inactive' : 'installed');",
    "})().catch((error) => { console.error(error); process.exitCode = 1; });",
  ].join("\n");

  const subprocessEnvironment = createEnv({
    MURPH_DEV_WORKER_PORT: "8787",
    MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD: "1",
    MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID:
      "member_subprocess_target",
    MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: input.nodeEnvironment,
    NODE_OPTIONS: "",
    TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.base.json"),
  });
  try {
    const args = input.useTsx
      ? [path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"), "--eval", script]
      : ["--eval", script];
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: repoRoot,
      env: subprocessEnvironment,
    });
    return stdout;
  } catch (error) {
    throw new Error(
      `Next request-bootstrap subprocess failed: ${readSubprocessStderr(error)}`,
    );
  }
}

function readSubprocessStderr(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "stderr" in error
    && typeof error.stderr === "string"
  ) {
    return redactLocalPaths(error.stderr.trim()) || "no stderr";
  }
  return redactLocalPaths(error instanceof Error ? error.message : String(error));
}

function redactLocalPaths(value: string): string {
  return value
    .replaceAll(repoRoot, "<REPO_ROOT>")
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, "<HOME_DIR>");
}

async function resolvePreparedSmokeArtifact(): Promise<{
  distDir: string;
  instrumentationPath: string;
} | null> {
  const sourceStats = await Promise.all([
    stat(path.join(appDir, "instrumentation.ts")),
    stat(path.join(appDir, "next.config.ts")),
  ]);
  const latestSourceMtimeMs = Math.max(...sourceStats.map((value) => value.mtimeMs));
  const entries = await readdir(appDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".next-smoke"))
      .map(async (entry) => {
        const distDir = path.join(appDir, entry.name);
        const buildIdPath = path.join(distDir, "BUILD_ID");
        const instrumentationPath = path.join(distDir, "server/instrumentation.js");
        try {
          await access(instrumentationPath);
          const buildIdStats = await stat(buildIdPath);
          if (buildIdStats.mtimeMs < latestSourceMtimeMs) {
            return null;
          }
          return {
            distDir,
            instrumentationPath,
            mtimeMs: buildIdStats.mtimeMs,
          };
        } catch {
          return null;
        }
      }),
  );
  const latest = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  return latest === undefined
    ? null
    : {
      distDir: latest.distDir,
      instrumentationPath: latest.instrumentationPath,
    };
}

function readNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}
