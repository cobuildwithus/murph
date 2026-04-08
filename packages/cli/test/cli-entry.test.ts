import assert from "node:assert/strict";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import { formatStructuredErrorMessage } from "@murphai/operator-config/text/shared";

const originalEmitWarning = process.emitWarning;
const mockedCliEntryModules = [
  "../src/index.js",
  "@murphai/operator-config/operator-config",
  "@murphai/setup-cli/setup-cli",
  "@murphai/operator-config/setup-runtime-env",
] as const;

async function importCliEntry() {
  vi.resetModules();
  return import("../src/cli-entry.ts");
}

async function importCliEntryWithMocks(input: {
  cli: {
    serve: ReturnType<typeof vi.fn>;
  };
  operatorConfigModule: Record<string, unknown>;
  setupCliModule: Record<string, unknown>;
  setupRuntimeEnvModule?: Record<string, unknown>;
}) {
  vi.resetModules();
  vi.doMock("../src/index.js", () => ({
    default: input.cli,
  }));
  vi.doMock("@murphai/operator-config/operator-config", () => input.operatorConfigModule);
  vi.doMock("@murphai/setup-cli/setup-cli", () => input.setupCliModule);
  vi.doMock("@murphai/operator-config/setup-runtime-env", () => ({
    SETUP_RUNTIME_ENV_NOTICE: "Set the missing wearable environment variables.",
    ...input.setupRuntimeEnvModule,
  }));

  return import("../src/cli-entry.ts");
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const moduleId of mockedCliEntryModules) {
    vi.doUnmock(moduleId);
  }
  vi.resetModules();
  process.emitWarning = originalEmitWarning;
});

test("loadCliEnvFiles attempts .env.local before .env and skips missing files", async () => {
  const loadEnvFileCalls: string[] = [];
  const missingFileError = Object.assign(new Error("missing"), {
    code: "ENOENT",
  });
  const loadEnvFile = vi
    .spyOn(process, "loadEnvFile")
    .mockImplementation((filePath) => {
      const resolvedPath = String(filePath);
      loadEnvFileCalls.push(resolvedPath);
      if (resolvedPath.endsWith(".env.local")) {
        throw missingFileError;
      }
    });

  const { loadCliEnvFiles } = await importCliEntry();
  loadCliEnvFiles("/repo/worktree");

  assert.equal(loadEnvFile.mock.calls.length, 2);
  assert.deepEqual(loadEnvFileCalls, [
    path.join("/repo/worktree", ".env.local"),
    path.join("/repo/worktree", ".env"),
  ]);
});

test("loadCliEnvFiles rethrows non-ENOENT load errors", async () => {
  const loadFailure = new Error("permission denied");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
    throw loadFailure;
  });

  const { loadCliEnvFiles } = await importCliEntry();

  assert.throws(() => loadCliEnvFiles("/repo/worktree"), loadFailure);
});

test("formatMurphCliError reuses the shared structured formatter", async () => {
  const error = Object.assign(new Error("Config validation failed."), {
    code: "CONFIG_INVALID",
    details: {
      errors: [
        '$.paths.vaultRoot: Invalid input: expected "vault"',
        'Invalid JSON in "/Users/example/vault/config.json".',
      ],
    },
  });

  const { formatMurphCliError } = await importCliEntry();

  assert.equal(formatMurphCliError(error), formatStructuredErrorMessage(error));
  assert.equal(
    formatMurphCliError(error),
    [
      "Config validation failed.",
      "details:",
      '- $.paths.vaultRoot: Invalid input: expected "vault"',
      '- Invalid JSON in "<HOME_DIR>/vault/config.json".',
    ].join("\n"),
  );
});

test("installSqliteExperimentalWarningFilter suppresses SQLite experimental warnings only", async () => {
  const forwardedWarnings: unknown[][] = [];
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    forwardedWarnings.push([warning, ...args]);
  }) as typeof process.emitWarning;

  const { installSqliteExperimentalWarningFilter } = await importCliEntry();
  installSqliteExperimentalWarningFilter();

  process.emitWarning(
    Object.assign(new Error("SQLite is an experimental feature and might change"), {
      name: "ExperimentalWarning",
    }),
  );
  process.emitWarning("Different experimental warning", "ExperimentalWarning");
  process.emitWarning("Plain runtime warning", "Warning");

  assert.deepEqual(forwardedWarnings, [
    ["Different experimental warning", "ExperimentalWarning"],
    ["Plain runtime warning", "Warning"],
  ]);
});

test("installSqliteExperimentalWarningFilter is idempotent", async () => {
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) =>
    originalEmitWarning(warning, ...(args as []))) as typeof process.emitWarning;

  const { installSqliteExperimentalWarningFilter } = await importCliEntry();
  installSqliteExperimentalWarningFilter();
  const wrappedEmitWarning = process.emitWarning;

  installSqliteExperimentalWarningFilter();

  assert.equal(process.emitWarning, wrappedEmitWarning);
});

test("runMurphCliAction injects the resolved default vault for non-setup invocations", async () => {
  const serve = vi.fn(async () => undefined);
  const applyDefaultVaultToArgs = vi.fn(
    (argv: readonly string[], defaultVault: string | null) =>
      defaultVault === null ? [...argv] : [...argv, "--vault", defaultVault],
  );
  const resolveDefaultVault = vi.fn(async () => "/vaults/default");

  const { runMurphCliAction } = await importCliEntryWithMocks({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs,
      expandConfiguredVaultPath: vi.fn(),
      resolveDefaultVault,
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn(),
      detectSetupProgramName: vi.fn(() => "murph-setup"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => false),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await runMurphCliAction(["assistant", "chat"]);

  assert.deepEqual(applyDefaultVaultToArgs.mock.calls, [
    [["assistant", "chat"], "/vaults/default"],
  ]);
  assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(serve.mock.calls, [
    [
      ["assistant", "chat", "--vault", "/vaults/default"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliAction reuses setup results for wearable launches and assistant chat handoff", async () => {
  const serve = vi.fn(async () => undefined);
  const stderrWrites: string[] = [];
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrWrites.push(String(chunk));
    return true;
  });
  const setupCliServe = vi.fn(async (_argv: readonly string[], _options: unknown) => {
    onSetupSuccess?.({
      result: {
        vault: "./vault-from-setup",
      },
    });
  });
  let onSetupSuccess:
    | ((context: {
        result: {
          vault: string;
        };
      }) => void)
    | null = null;

  const { runMurphCliAction } = await importCliEntryWithMocks({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs: vi.fn(),
      expandConfiguredVaultPath: vi.fn((vault: string, homeDirectory: string) =>
        path.join(homeDirectory, vault),
      ),
      resolveDefaultVault: vi.fn(async () => null),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn((input: { onSetupSuccess: typeof onSetupSuccess }) => {
        onSetupSuccess = input.onSetupSuccess;
        return {
          serve: setupCliServe,
        };
      }),
      detectSetupProgramName: vi.fn(() => "murph-setup"),
      formatSetupWearableLabel: vi.fn((value: string) => value.toUpperCase()),
      isSetupInvocation: vi.fn(() => true),
      listSetupPendingWearables: vi.fn(() => [
        {
          wearable: "whoop",
          missingEnv: ["WHOOP_CLIENT_ID"],
        },
      ]),
      listSetupReadyWearables: vi.fn(() => ["oura"]),
      resolveSetupPostLaunchAction: vi.fn(() => "assistant-chat"),
    },
  });

  await runMurphCliAction(["murph-setup", "assistant"], {
    argv0: "murph-setup",
  });

  assert.equal(setupCliServe.mock.calls.length, 1);
  assert.deepEqual(serve.mock.calls, [
    [
      ["device", "connect", "oura", "--vault", "/operator-home/vault-from-setup", "--open"],
      {
        env: process.env,
      },
    ],
    [
      ["assistant", "chat", "--vault", "/operator-home/vault-from-setup"],
      {
        env: process.env,
      },
    ],
  ]);
  assert.equal(
    stderrWrites.some((entry) =>
      entry.includes("Selected wearable setup is waiting on credentials: WHOOP"),
    ),
    true,
  );
  assert.equal(
    stderrWrites.some((entry) => entry.includes("Opening OURA connect flow in your browser.")),
    true,
  );
  assert.equal(
    stderrWrites.some((entry) => entry.includes("Opening Murph assistant chat. Type /exit to quit.")),
    true,
  );
  stderrSpy.mockRestore();
});
