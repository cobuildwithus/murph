import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import { formatStructuredErrorMessage } from "@murphai/operator-config/text/shared";
import {
  formatMurphCliError,
  installSqliteExperimentalWarningFilter,
  isBrokenPipeError,
  loadCliEnvFiles,
  resolveBrokenPipeExitCode,
  runMurphCliEntrypoint,
  runMurphCliAction,
} from "../src/cli-entry.ts";

const originalEmitWarning = process.emitWarning;
const SQLITE_WARNING_FILTER_FLAG = Symbol.for("murph.sqliteExperimentalWarningFilterInstalled");
const SQLITE_WARNING_FILTER_INCLUDES_FLAG = Symbol.for(
  "murph.sqliteExperimentalWarningFilterInstalled.includes",
);
type ProcessWithSqliteWarningFilterFlag = NodeJS.Process & {
  [SQLITE_WARNING_FILTER_FLAG]?: boolean;
  [SQLITE_WARNING_FILTER_INCLUDES_FLAG]?: boolean;
};
const mockedCliEntryModules = [
  "../src/vault-cli.js",
  "@murphai/operator-config/operator-config",
  "@murphai/setup-cli/setup-cli",
  "@murphai/operator-config/setup-runtime-env",
] as const;

function mockCliActionModules(input: {
  cli: {
    serve: ReturnType<typeof vi.fn>;
  };
  operatorConfigModule: Record<string, unknown>;
  setupCliModule: Record<string, unknown>;
  setupRuntimeEnvModule?: Record<string, unknown>;
}) {
  vi.doMock("../src/vault-cli.js", () => ({
    CLI_CONFIG_FILES: [],
    createVaultCliWithOptions: vi.fn(() => input.cli),
  }));
  vi.doMock("@murphai/operator-config/operator-config", () => ({
    commandNeedsVaultForExecution: vi.fn(() => true),
    hasExplicitVaultOption: vi.fn(() => false),
    resolveConfiguredDefaultVault: vi.fn(async () => null),
    resolveEffectiveTopLevelToken: vi.fn(
      (argv: readonly string[]) => argv.find((token) => !token.startsWith("-")) ?? null,
    ),
    ...input.operatorConfigModule,
  }));
  vi.doMock("@murphai/setup-cli/setup-cli", () => ({
    createSetupServices: vi.fn(() => ({ setupHost: vi.fn(), setupMacos: vi.fn() })),
    ...input.setupCliModule,
  }));
  vi.doMock("@murphai/operator-config/setup-runtime-env", () => ({
    SETUP_RUNTIME_ENV_NOTICE: "Set the missing wearable environment variables.",
    ...input.setupRuntimeEnvModule,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const moduleId of mockedCliEntryModules) {
    vi.doUnmock(moduleId);
  }
  process.emitWarning = originalEmitWarning;
  delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_FLAG];
  delete (process as ProcessWithSqliteWarningFilterFlag)[SQLITE_WARNING_FILTER_INCLUDES_FLAG];
});

test("loadCliEnvFiles attempts .env.local before .env and skips missing files", () => {
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

  loadCliEnvFiles("/repo/worktree");

  assert.equal(loadEnvFile.mock.calls.length, 2);
  assert.deepEqual(loadEnvFileCalls, [
    path.join("/repo/worktree", ".env.local"),
    path.join("/repo/worktree", ".env"),
  ]);
});

test("loadCliEnvFiles rethrows non-ENOENT load errors", () => {
  const loadFailure = new Error("permission denied");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
    throw loadFailure;
  });

  assert.throws(() => loadCliEnvFiles("/repo/worktree"), loadFailure);
});

test("formatMurphCliError reuses the shared structured formatter", () => {
  const error = Object.assign(new Error("Config validation failed."), {
    code: "CONFIG_INVALID",
    details: {
      errors: [
        '$.paths.vaultRoot: Invalid input: expected "vault"',
        'Invalid JSON in "/Users/example/vault/config.json".',
      ],
    },
  });

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

test("isBrokenPipeError recognizes stdout pipe closure failures", () => {
  assert.equal(isBrokenPipeError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), true);
  assert.equal(isBrokenPipeError(Object.assign(new Error("write failed"), { code: "EACCES" })), false);
  assert.equal(isBrokenPipeError(new Error("write EPIPE")), false);
});

test("resolveBrokenPipeExitCode preserves real failures when stderr closes", () => {
  assert.equal(resolveBrokenPipeExitCode("stdout", 1), 0);
  assert.equal(resolveBrokenPipeExitCode("stderr", 1), 1);
  assert.equal(resolveBrokenPipeExitCode("stderr", undefined), 0);
});

test("installSqliteExperimentalWarningFilter suppresses SQLite experimental warnings only", () => {
  const forwardedWarnings: unknown[][] = [];
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    forwardedWarnings.push([warning, ...args]);
  }) as typeof process.emitWarning;

  installSqliteExperimentalWarningFilter();

  process.emitWarning(
    Object.assign(new Error("SQLite is an experimental feature and might change at any time"), {
      name: "ExperimentalWarning",
    }),
  );
  process.emitWarning(
    "SQLite is an experimental feature and might change at any time (extra context)",
    "ExperimentalWarning",
  );
  process.emitWarning("Different experimental warning", "ExperimentalWarning");
  process.emitWarning("Plain runtime warning", "Warning");

  assert.deepEqual(forwardedWarnings, [
    ["Different experimental warning", "ExperimentalWarning"],
    ["Plain runtime warning", "Warning"],
  ]);
});

test("installSqliteExperimentalWarningFilter is idempotent", () => {
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) =>
    originalEmitWarning(warning, ...(args as []))) as typeof process.emitWarning;

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
  const resolveConfiguredDefaultVault = vi.fn(async () => null);

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs,
      commandNeedsVaultForExecution: vi.fn(() => true),
      expandConfiguredVaultPath: vi.fn(),
      hasExplicitVaultOption: vi.fn(() => false),
      resolveConfiguredDefaultVault,
      resolveEffectiveTopLevelToken: vi.fn(
        (argv: readonly string[]) => argv.find((token) => !token.startsWith("-")) ?? null,
      ),
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
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.deepEqual(serve.mock.calls, [
    [
      ["assistant", "chat", "--vault", "/vaults/default"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliAction rejects explicit --vault overrides for murph product commands", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveConfiguredDefaultVault = vi.fn(async () => "/vaults/default");

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs: vi.fn((argv: readonly string[]) => [...argv]),
      commandNeedsVaultForExecution: vi.fn(() => true),
      expandConfiguredVaultPath: vi.fn(),
      hasExplicitVaultOption: vi.fn(() => true),
      resolveConfiguredDefaultVault,
      resolveDefaultVault: vi.fn(async () => "/vaults/default"),
      resolveEffectiveTopLevelToken: vi.fn(() => "assistant"),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn(),
      detectSetupProgramName: vi.fn(() => "murph"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => false),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await assert.rejects(
    () => runMurphCliAction(["assistant", "chat", "--vault", "/vaults/other"]),
    /`murph` uses one active vault/u,
  );
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, [["/operator-home"]]);
  assert.equal(serve.mock.calls.length, 0);
});

test("runMurphCliAction lets JSON requests reach Incur when vault defaults are absent", async () => {
  const serve = vi.fn(async () => undefined);
  const applyDefaultVaultToArgs = vi.fn((argv: readonly string[]) => [...argv]);
  const resolveDefaultVault = vi.fn(async () => null);

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs,
      commandNeedsVaultForExecution: vi.fn(() => true),
      expandConfiguredVaultPath: vi.fn(),
      hasExplicitVaultOption: vi.fn(() => false),
      resolveDefaultVault,
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn(),
      detectSetupProgramName: vi.fn(() => "vault-cli"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => false),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await runMurphCliAction(["--no-config", "vault", "show", "--format", "json"]);

  assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(applyDefaultVaultToArgs.mock.calls, [
    [["--no-config", "vault", "show", "--format", "json"], null],
  ]);
  assert.deepEqual(serve.mock.calls, [
    [
      ["--no-config", "vault", "show", "--format", "json"],
      {
        env: process.env,
      },
    ],
  ]);
});

for (const jsonArgv of [
  ["--no-config", "vault", "show", "--json"],
  ["--no-config", "vault", "show", "--format=json"],
]) {
  test(`runMurphCliAction lets ${jsonArgv.at(-1)} requests reach Incur when vault defaults are absent`, async () => {
    const serve = vi.fn(async () => undefined);
    const applyDefaultVaultToArgs = vi.fn((argv: readonly string[]) => [...argv]);
    const resolveDefaultVault = vi.fn(async () => null);

    mockCliActionModules({
      cli: { serve },
      operatorConfigModule: {
        applyDefaultVaultToArgs,
        commandNeedsVaultForExecution: vi.fn(() => true),
        expandConfiguredVaultPath: vi.fn(),
        hasExplicitVaultOption: vi.fn(() => false),
        resolveDefaultVault,
        resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
      },
      setupCliModule: {
        createSetupCli: vi.fn(),
        detectSetupProgramName: vi.fn(() => "vault-cli"),
        formatSetupWearableLabel: vi.fn((value: string) => value),
        isSetupInvocation: vi.fn(() => false),
        listSetupPendingWearables: vi.fn(() => []),
        listSetupReadyWearables: vi.fn(() => []),
        resolveSetupPostLaunchAction: vi.fn(() => null),
      },
    });

    await runMurphCliAction(jsonArgv);

    assert.deepEqual(applyDefaultVaultToArgs.mock.calls, [[jsonArgv, null]]);
    assert.deepEqual(serve.mock.calls, [
      [
        jsonArgv,
        {
          env: process.env,
        },
      ],
    ]);
  });
}

test("runMurphCliAction fails with an active-vault message when murph has no configured vault", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveConfiguredDefaultVault = vi.fn(async () => null);
  const resolveDefaultVault = vi.fn(async () => "/vaults/from-env");

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs: vi.fn((argv: readonly string[]) => [...argv]),
      commandNeedsVaultForExecution: vi.fn(() => true),
      expandConfiguredVaultPath: vi.fn(),
      hasExplicitVaultOption: vi.fn(() => false),
      resolveConfiguredDefaultVault,
      resolveDefaultVault,
      resolveEffectiveTopLevelToken: vi.fn(() => "workout"),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn(),
      detectSetupProgramName: vi.fn(() => "murph"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => false),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await assert.rejects(
    () => runMurphCliAction(["workout", "list"]),
    /No active Murph vault is configured/u,
  );
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(resolveDefaultVault.mock.calls, []);
  assert.equal(serve.mock.calls.length, 0);
});

test("runMurphCliAction still allows murph init to target an explicit vault", async () => {
  const serve = vi.fn(async () => undefined);
  const applyDefaultVaultToArgs = vi.fn((argv: readonly string[]) => [...argv]);
  const resolveConfiguredDefaultVault = vi.fn(async () => null);
  const resolveDefaultVault = vi.fn(async () => "/vaults/from-env");

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs,
      commandNeedsVaultForExecution: vi.fn(() => true),
      expandConfiguredVaultPath: vi.fn(),
      hasExplicitVaultOption: vi.fn(() => true),
      resolveConfiguredDefaultVault,
      resolveDefaultVault,
      resolveEffectiveTopLevelToken: vi.fn(() => "init"),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli: vi.fn(),
      detectSetupProgramName: vi.fn(() => "murph"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => false),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await runMurphCliAction(["init", "--vault", "/vaults/new"]);

  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(applyDefaultVaultToArgs.mock.calls, [
    [["init", "--vault", "/vaults/new"], "/vaults/from-env"],
  ]);
  assert.deepEqual(serve.mock.calls, [
    [
      ["init", "--vault", "/vaults/new"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliEntrypoint installs env loading and sqlite warning filtering before dispatching the action path", async () => {
  const serve = vi.fn(async () => undefined);
  const loadEnvFileCalls: string[] = [];
  const originalEmitWarning = process.emitWarning;
  const originalHome = process.env.HOME;
  process.env.HOME = "/tmp/murph-cli-entry-home";
  const loadEnvFile = vi
    .spyOn(process, "loadEnvFile")
    .mockImplementation((filePath) => {
      const resolvedPath = String(filePath);
      loadEnvFileCalls.push(resolvedPath);
      if (resolvedPath.endsWith(".env.local")) {
        const error = Object.assign(new Error("missing"), {
          code: "ENOENT",
        });
        throw error;
      }
    });

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs: vi.fn((argv: readonly string[]) => [
        ...argv,
        "--vault",
        "/vaults/default",
      ]),
      expandConfiguredVaultPath: vi.fn(),
      resolveConfiguredDefaultVault: vi.fn(async () => null),
      resolveDefaultVault: vi.fn(async () => "/vaults/default"),
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

  try {
    await runMurphCliEntrypoint(["assistant", "chat"]);

    assert.deepEqual(loadEnvFile.mock.calls.length, 2);
    assert.deepEqual(loadEnvFileCalls, [
      path.join(process.cwd(), ".env.local"),
      path.join(process.cwd(), ".env"),
    ]);
    assert.deepEqual(serve.mock.calls, [
      [
        ["assistant", "chat", "--vault", "/vaults/default"],
        {
          env: process.env,
        },
      ],
    ]);
  } finally {
    process.emitWarning = originalEmitWarning;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
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

  mockCliActionModules({
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
  assert.deepEqual(stderrSpy.mock.calls, [
    [
      "\nSelected wearable setup is waiting on credentials: WHOOP (WHOOP_CLIENT_ID). Set the missing wearable environment variables.\n",
    ],
    ["\nOpening OURA connect flow in your browser.\n\n"],
    ["\nOpening Murph assistant chat. Type /exit to quit.\n\n"],
  ]);
});

test("runMurphCliAction passes the published CLI bin path into setup construction", async () => {
  const serve = vi.fn(async () => undefined);
  const setupCliServe = vi.fn(async () => undefined);
  const createdServices = { setupHost: vi.fn(), setupMacos: vi.fn() };
  type CreateSetupServicesInput = {
    resolveCliBinPath: () => string;
  };
  type CreateSetupCliInput = {
    commandName: string;
    onSetupSuccess: unknown;
    services: typeof createdServices;
  };
  const createSetupCli = vi.fn((input: CreateSetupCliInput) => ({
    serve: setupCliServe,
  }));
  const createSetupServices = vi.fn((input: CreateSetupServicesInput) => createdServices);
  const expectedCliBinPath = path.resolve(
    path.dirname(fileURLToPath(new URL("../src/cli-entry.ts", import.meta.url))),
    "../dist/bin.js",
  );

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      applyDefaultVaultToArgs: vi.fn(),
      expandConfiguredVaultPath: vi.fn(),
      resolveDefaultVault: vi.fn(async () => null),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    setupCliModule: {
      createSetupCli,
      createSetupServices,
      detectSetupProgramName: vi.fn(() => "murph"),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      isSetupInvocation: vi.fn(() => true),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await runMurphCliAction(["onboard", "--dryRun", "--vault", "./vault"], {
    argv0: "murph",
  });

  assert.equal(createSetupServices.mock.calls.length, 1);
  const createSetupServicesCall = createSetupServices.mock.calls[0];
  assert.ok(createSetupServicesCall);
  const [createSetupServicesInput] = createSetupServicesCall;
  const { resolveCliBinPath } = createSetupServicesInput;
  assert.equal(typeof resolveCliBinPath, "function");
  assert.equal(resolveCliBinPath?.(), expectedCliBinPath);
  assert.equal(createSetupCli.mock.calls.length, 1);
  const createSetupCliCall = createSetupCli.mock.calls[0];
  assert.ok(createSetupCliCall);
  const [createSetupCliInput] = createSetupCliCall;
  assert.deepEqual(createSetupCliCall, [
    {
      commandName: "murph",
      onSetupSuccess: createSetupCliInput.onSetupSuccess,
      services: createdServices,
    },
  ]);
  assert.equal(typeof createSetupCliInput.onSetupSuccess, "function");
  assert.equal(setupCliServe.mock.calls.length, 1);
  assert.equal(serve.mock.calls.length, 0);
});

test("runMurphCliAction starts assistant automation when setup requests assistant-run", async () => {
  const serve = vi.fn(async (_argv: readonly string[], options: { exit?: (code?: number) => void }) => {
    options.exit?.(0);
    return undefined;
  });
  const setupCliServe = vi.fn(async (_argv: readonly string[], options: { exit?: (code?: number) => void }) => {
    options.exit?.(0);
    onSetupSuccess?.({
      result: {
        vault: "./vault-from-setup",
      },
    });
  });
  const exit = vi.fn();
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let onSetupSuccess:
    | ((context: {
        result: {
          vault: string;
        };
      }) => void)
    | null = null;

  mockCliActionModules({
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
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => "assistant-run"),
    },
  });

  await runMurphCliAction(["murph-setup", "assistant"], {
    argv0: "murph-setup",
    exit,
  });

  assert.equal(setupCliServe.mock.calls.length, 1);
  assert.equal(typeof setupCliServe.mock.calls[0]?.[1]?.exit, "function");
  assert.deepEqual(serve.mock.calls[0]?.[0], [
    "assistant",
    "run",
    "--vault",
    "/operator-home/vault-from-setup",
  ]);
  assert.equal(typeof serve.mock.calls[0]?.[1]?.exit, "function");
  assert.equal(exit.mock.calls.length, 2);
  assert.deepEqual(stderrSpy.mock.calls, [
    [
      "\nStarting Murph assistant automation. Leave this terminal open while channel auto-reply is active for Telegram, Linq, and/or email. Press Ctrl+C to stop.\n\n",
    ],
  ]);
});
