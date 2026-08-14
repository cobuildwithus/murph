import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import { formatStructuredErrorMessage } from "@murphai/operator-config/text/shared";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { getVaultCliPackageVersion } from "../src/vault-cli-package.ts";
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
  "../src/vault-cli-command-routing.js",
  "../src/vault-cli-llms-normalizer.js",
  "../src/vault-cli-schema-index.js",
  "../src/vault-cli-shell.js",
  "../src/vault-cli-vault-context.js",
  "@murphai/assistant-engine/codex-lifecycle",
  "@murphai/operator-config/operator-config",
  "@murphai/setup-cli/setup-cli",
  "@murphai/operator-config/setup-runtime-env",
] as const;

function mockCliActionModules(input: {
  codexLifecycleModule?: Record<string, unknown>;
  cli: {
    serve: ReturnType<typeof vi.fn>;
  };
  installVaultCliLlmsNormalizer?: ReturnType<typeof vi.fn>;
  onCreateVaultCliShell?: (
    commandName: string,
    options: { expectedSkillHash?: string } | undefined,
  ) => void;
  onInstallVaultCliVaultContext?: (context: Record<string, unknown>) => void;
  onCreateVaultCliWithOptions?: (input: Record<string, unknown>) => void;
  operatorConfigModule: Record<string, unknown>;
  registerScopedVaultCliCommand?: ReturnType<typeof vi.fn>;
  setupCliModule: Record<string, unknown>;
  setupRuntimeEnvModule?: Record<string, unknown>;
}) {
  vi.doMock("../src/vault-cli.js", () => ({
    CLI_CONFIG_FILES: [],
    createVaultCliWithOptions: vi.fn((options: Record<string, unknown>) => {
      input.onCreateVaultCliWithOptions?.(options);
      return input.cli;
    }),
  }));
  vi.doMock("../src/vault-cli-shell.js", () => ({
    createVaultCliShell: vi.fn(
      (
        commandName: string,
        options: { expectedSkillHash?: string } | undefined,
      ) => {
        input.onCreateVaultCliShell?.(commandName, options);
        return input.cli;
      },
    ),
  }));
  vi.doMock("../src/vault-cli-command-routing.js", () => ({
    registerScopedVaultCliCommand:
      input.registerScopedVaultCliCommand ?? vi.fn(async () => undefined),
  }));
  vi.doMock("../src/vault-cli-llms-normalizer.js", () => ({
    installVaultCliLlmsNormalizer:
      input.installVaultCliLlmsNormalizer ?? vi.fn(),
  }));
  vi.doMock("../src/vault-cli-schema-index.js", () => ({
    installVaultCliSchemaIndex: vi.fn(),
  }));
  vi.doMock("../src/vault-cli-vault-context.js", () => ({
    createVaultCliVaultContext: vi.fn((vault: string | null = null) => ({
      current: vault,
      missingVaultMessage: null,
    })),
    installVaultCliVaultContext: vi.fn(
      (_cli: unknown, context: Record<string, unknown>) => {
        input.onInstallVaultCliVaultContext?.(context);
      },
    ),
  }));
  vi.doMock("@murphai/assistant-engine/codex-lifecycle", () => ({
    stopWarmCodexAppServer: vi.fn(async () => undefined),
    ...input.codexLifecycleModule,
  }));
  vi.doMock("@murphai/operator-config/operator-config", () => ({
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

test("runMurphCliAction prints --version through the requested stdout without importing command graphs", async () => {
  const stdout = vi.fn();
  const exit = vi.fn();
  vi.doMock("../src/vault-cli.js", () => {
    throw new Error("vault CLI graph should not be imported for --version");
  });
  vi.doMock("@murphai/setup-cli/setup-cli", () => {
    throw new Error("setup CLI should not be imported for --version");
  });
  vi.doMock("@murphai/operator-config/operator-config", () => {
    throw new Error("operator config should not be imported for --version");
  });

  await runMurphCliAction(["--version"], { exit, stdout });

  assert.equal(stdout.mock.calls.length, 1);
  assert.equal(stdout.mock.calls[0]?.[0], `${getVaultCliPackageVersion()}\n`);
  assert.equal(exit.mock.calls.length, 0);
});

test("runMurphCliAction scopes known root commands without creating the full CLI", async () => {
  const serve = vi.fn(async () => undefined);
  const installVaultCliLlmsNormalizer = vi.fn();
  const registerScopedVaultCliCommand = vi.fn(async () => undefined);
  const resolveDefaultVault = vi.fn(async () => "/vaults/default");
  const vaultContextRef: {
    value: {
      current: string | null;
    } | null;
  } = { value: null };

  mockCliActionModules({
    cli: { serve },
    installVaultCliLlmsNormalizer,
    onCreateVaultCliWithOptions: () => {
      throw new Error("full CLI graph should not be created for a scoped device command");
    },
    onInstallVaultCliVaultContext: (context) => {
      vaultContextRef.value = context as { current: string | null };
    },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
      resolveDefaultVault,
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
    registerScopedVaultCliCommand,
    setupCliModule: {
      createSetupCli: vi.fn(),
      formatSetupWearableLabel: vi.fn((value: string) => value),
      listSetupPendingWearables: vi.fn(() => []),
      listSetupReadyWearables: vi.fn(() => []),
      resolveSetupPostLaunchAction: vi.fn(() => null),
    },
  });

  await runMurphCliAction(["device", "account", "list"]);

  assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(registerScopedVaultCliCommand.mock.calls, [
    [
      {
        cli: { serve },
        root: "device",
      },
    ],
  ]);
  assert.ok(vaultContextRef.value);
  assert.equal(vaultContextRef.value.current, "/vaults/default");
  assert.deepEqual(installVaultCliLlmsNormalizer.mock.calls, [
    [
      {
        serve,
      },
      "vault-cli",
    ],
  ]);
  assert.deepEqual(serve.mock.calls, [
    [
      ["device", "account", "list"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliAction keeps scoped routing when Incur skills are installed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-entry-"));
  const previousXdgDataHome = process.env.XDG_DATA_HOME;
  const dataHome = path.join(tempRoot, "data");
  const skillPath = path.join(tempRoot, "skills", "murph-device");
  const serve = vi.fn(async () => undefined);
  const registerScopedVaultCliCommand = vi.fn(async () => undefined);
  const resolveDefaultVault = vi.fn(async () => "/vaults/default");
  let scopedSkillHash: string | undefined;

  try {
    process.env.XDG_DATA_HOME = dataHome;
    await mkdir(path.join(dataHome, "incur"), { recursive: true });
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, "SKILL.md"), "---\nname: murph-device\n---\n");
    await writeFile(
      path.join(dataHome, "incur", "vault-cli.json"),
      `${JSON.stringify({
        hash: "stale-hash",
        paths: [skillPath],
        skills: ["murph-device"],
      })}\n`,
    );

    mockCliActionModules({
      cli: { serve },
      onCreateVaultCliWithOptions: () => {
        throw new Error("installed Incur skills should not force the full CLI graph");
      },
      onCreateVaultCliShell: (commandName, options) => {
        assert.equal(commandName, "vault-cli");
        scopedSkillHash = options?.expectedSkillHash;
      },
      operatorConfigModule: {
        expandConfiguredVaultPath: vi.fn(),
        resolveDefaultVault,
        resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
      },
      registerScopedVaultCliCommand,
      setupCliModule: {
        createSetupCli: vi.fn(),
        formatSetupWearableLabel: vi.fn((value: string) => value),
        listSetupPendingWearables: vi.fn(() => []),
        listSetupReadyWearables: vi.fn(() => []),
        resolveSetupPostLaunchAction: vi.fn(() => null),
      },
    });

    await runMurphCliAction(["device", "account", "list"]);

    assert.match(scopedSkillHash ?? "", /^[a-f0-9]{16}$/u);
    assert.deepEqual(registerScopedVaultCliCommand.mock.calls, [
      [
        {
          cli: { serve },
          root: "device",
        },
      ],
    ]);
    assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
    assert.deepEqual(serve.mock.calls, [
      [
        ["device", "account", "list"],
        {
          env: process.env,
        },
      ],
    ]);
  } finally {
    if (previousXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = previousXdgDataHome;
    }
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("runMurphCliAction injects the resolved default vault for non-setup invocations", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveDefaultVault = vi.fn(async () => "/vaults/default");
  const resolveConfiguredDefaultVault = vi.fn(async () => null);
  const vaultContextRef: { value: { current: string | null } | null } = {
    value: null,
  };

  mockCliActionModules({
    cli: { serve },
    onCreateVaultCliWithOptions: (options) => {
      vaultContextRef.value = options.vaultContext as { current: string | null };
    },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
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

  await runMurphCliAction(["model"]);

  assert.deepEqual(resolveDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.ok(vaultContextRef.value);
  assert.equal(vaultContextRef.value.current, "/vaults/default");
  assert.deepEqual(serve.mock.calls, [
    [
      ["model"],
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
      expandConfiguredVaultPath: vi.fn(),
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
    () =>
      runMurphCliAction(["assistant", "chat", "--vault", "/vaults/other"], {
        argv0: "murph",
      }),
    /`murph` uses one active vault/u,
  );
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.equal(serve.mock.calls.length, 0);
});

test("runMurphCliAction rejects batch on the murph product CLI", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveConfiguredDefaultVault = vi.fn(async () => "/vaults/default");
  const resolveDefaultVault = vi.fn(async () => "/vaults/default");

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
      resolveConfiguredDefaultVault,
      resolveDefaultVault,
      resolveEffectiveTopLevelToken: vi.fn(() => "batch"),
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
    () =>
      runMurphCliAction(["batch", "--command", '["memory","show"]'], {
        argv0: "murph",
      }),
    /`batch` is only available through `vault-cli`/u,
  );
  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.deepEqual(resolveDefaultVault.mock.calls, []);
  assert.equal(serve.mock.calls.length, 0);
});

test("runMurphCliAction lets JSON requests reach Incur when vault defaults are absent", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveDefaultVault = vi.fn(async () => null);

  mockCliActionModules({
    cli: { serve },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
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
    const resolveDefaultVault = vi.fn(async () => null);

    mockCliActionModules({
      cli: { serve },
      operatorConfigModule: {
        expandConfiguredVaultPath: vi.fn(),
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

test("runMurphCliAction records the active-vault message when murph has no configured vault", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveConfiguredDefaultVault = vi.fn(async () => null);
  const resolveDefaultVault = vi.fn(async () => "/vaults/from-env");
  const vaultContextRef: {
    value: {
      current: string | null;
      missingVaultMessage: string | null;
    } | null;
  } = { value: null };

  mockCliActionModules({
    cli: { serve },
    onInstallVaultCliVaultContext: (context) => {
      vaultContextRef.value = context as {
        current: string | null;
        missingVaultMessage: string | null;
      };
    },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
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

  await runMurphCliAction(["workout", "list"], {
    argv0: "murph",
  });

  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, [["/operator-home"]]);
  assert.deepEqual(resolveDefaultVault.mock.calls, []);
  assert.ok(vaultContextRef.value);
  assert.equal(vaultContextRef.value.current, null);
  assert.match(vaultContextRef.value.missingVaultMessage ?? "", /No active Murph vault is configured/u);
  assert.deepEqual(serve.mock.calls, [
    [
      ["workout", "list"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliAction still allows murph init to target an explicit vault", async () => {
  const serve = vi.fn(async () => undefined);
  const resolveConfiguredDefaultVault = vi.fn(async () => null);
  const resolveDefaultVault = vi.fn(async () => "/vaults/from-env");
  const vaultContextRef: { value: { current: string | null } | null } = {
    value: null,
  };

  mockCliActionModules({
    cli: { serve },
    onInstallVaultCliVaultContext: (context) => {
      vaultContextRef.value = context as { current: string | null };
    },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
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

  await runMurphCliAction(["init", "--vault", "/vaults/new"], {
    argv0: "murph",
  });

  assert.deepEqual(resolveConfiguredDefaultVault.mock.calls, []);
  assert.deepEqual(resolveDefaultVault.mock.calls, []);
  assert.ok(vaultContextRef.value);
  assert.equal(vaultContextRef.value.current, "/vaults/new");
  assert.deepEqual(serve.mock.calls, [
    [
      ["init"],
      {
        env: process.env,
      },
    ],
  ]);
});

test("runMurphCliEntrypoint installs env loading and sqlite warning filtering before dispatching the action path", async () => {
  const serve = vi.fn(async () => undefined);
  const stopWarmCodexAppServer = vi.fn(async () => undefined);
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
    codexLifecycleModule: {
      stopWarmCodexAppServer,
    },
    cli: { serve },
    operatorConfigModule: {
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
        ["assistant", "chat"],
        {
          env: process.env,
        },
      ],
    ]);
    assert.deepEqual(stopWarmCodexAppServer.mock.calls, [["cli-entrypoint-exit"]]);
  } finally {
    process.emitWarning = originalEmitWarning;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

test("runMurphCliEntrypoint does not mask command failure when warm Codex shutdown is busy", async () => {
  const primaryError = new Error("assistant command failed");
  const serve = vi.fn(async () => {
    throw primaryError;
  });
  const stopWarmCodexAppServer = vi.fn(async () => {
    throw new VaultCliError(
      "ASSISTANT_CODEX_APP_SERVER_BUSY",
      "Codex app-server process is serving a turn and cannot be stopped directly.",
      {
        retryable: true,
      },
    );
  });

  mockCliActionModules({
    codexLifecycleModule: {
      stopWarmCodexAppServer,
    },
    cli: { serve },
    operatorConfigModule: {
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

  let caughtError: unknown = null;
  try {
    await runMurphCliEntrypoint(["assistant", "chat"]);
  } catch (error) {
    caughtError = error;
  }

  assert.equal(caughtError, primaryError);
  assert.deepEqual(stopWarmCodexAppServer.mock.calls, [["cli-entrypoint-exit"]]);
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

  await runMurphCliAction(["onboard"], {
    argv0: "murph",
  });

  assert.equal(setupCliServe.mock.calls.length, 1);
  assert.deepEqual(serve.mock.calls, [
    [
      ["device", "connect", "oura", "--open"],
      {
        env: process.env,
      },
    ],
    [
      ["assistant", "chat"],
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

  await runMurphCliAction(["onboard"], {
    argv0: "murph",
    exit,
  });

  assert.equal(setupCliServe.mock.calls.length, 1);
  assert.equal(typeof setupCliServe.mock.calls[0]?.[1]?.exit, "function");
  assert.deepEqual(serve.mock.calls[0]?.[0], ["assistant", "run"]);
  assert.equal(typeof serve.mock.calls[0]?.[1]?.exit, "function");
  assert.equal(exit.mock.calls.length, 2);
  assert.deepEqual(stderrSpy.mock.calls, [
    [
      "\nStarting Murph assistant automation. Leave this terminal open while channel auto-reply is active for Telegram or Linq. Press Ctrl+C to stop.\n\n",
    ],
  ]);
});
