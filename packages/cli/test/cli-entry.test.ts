import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test, vi } from "vitest";

import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { getVaultCliPackageVersion } from "../src/vault-cli-package.ts";
import {
  installSqliteExperimentalWarningFilter,
  isBrokenPipeError,
  loadCliEnvFiles,
  renderMurphCliEntrypointError,
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

test("renderMurphCliEntrypointError preserves a bounded diagnostic failure", async () => {
  const submittedValue = "private-submitted-value";
  const providerBody = "private-provider-response";
  const rawMessage = `Parser rejected ${submittedValue}: ${providerBody}.`;
  const error = Object.assign(new Error(rawMessage), {
    code: "CONFIG_INVALID",
    details: {
      errors: [
        '$.paths.vaultRoot: Invalid input: expected "vault"',
        'Invalid JSON in "/Users/example/vault/config.json".',
      ],
    },
  });

  const rendered = await renderMurphCliEntrypointError(error, [], { human: true });

  assert.equal(rendered.machineReadable, false);
  assert.equal(
    rendered.output,
    [
      `Error (CONFIG_INVALID): ${rawMessage}`,
      "Stage: command",
    ].join("\n"),
  );
  assert.equal(rendered.output.includes(submittedValue), true);
  assert.equal(rendered.output.includes(providerBody), true);
});

test("renderMurphCliEntrypointError honors explicit JSON before CLI serve", async () => {
  const privateValue = "private-schedule-value";
  const error = new VaultCliError(
    "invalid_payload",
    "Schedule failed validation.",
    {
      issues: [
        {
          code: "invalid_value",
          expected: "IANA time zone",
          path: ["schedule", "timeZone"],
          publicPath: ["schedule", "timeZone"],
          message: privateValue,
        },
      ],
      retryable: false,
      stage: "validation",
    },
  );

  for (const jsonArgs of [
    ["--vault", "first", "--vault", "second", "--format", "json"],
    ["--vault", "first", "--vault", "second", "--json"],
  ]) {
    const rendered = await renderMurphCliEntrypointError(
      error,
      jsonArgs,
      { human: true },
    );

    assert.equal(rendered.machineReadable, true);
    assert.equal(rendered.exitCode, 1);
    const directError = JSON.parse(rendered.output) as {
      code?: string;
      error?: unknown;
      fieldErrors?: Array<{ path?: string }>;
      hint?: string;
      stage?: string;
    };
    assert.equal(directError.code, "invalid_payload");
    assert.equal(directError.error, undefined);
    assert.equal(directError.stage, "validation");
    assert.equal(directError.hint, undefined);
    assert.equal(directError.fieldErrors?.[0]?.path, "schedule.timeZone");
    assert.equal(rendered.output.includes(privateValue), false);
    assert.equal(rendered.output.includes("first"), false);
    assert.equal(rendered.output.includes("second"), false);
  }

  const rendered = await renderMurphCliEntrypointError(
    error,
    ["--vault", "first", "--vault", "second", "--full-output", "--format", "json"],
    { human: true },
  );

  assert.equal(rendered.machineReadable, true);
  assert.equal(rendered.exitCode, 1);
  const envelope = JSON.parse(rendered.output) as {
    error?: {
      code?: string;
      fieldErrors?: Array<{ path?: string }>;
      hint?: string;
      stage?: string;
    };
    meta?: { command?: string };
    ok?: boolean;
  };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error?.code, "invalid_payload");
  assert.equal(envelope.error?.stage, "validation");
  assert.equal(envelope.error?.hint, undefined);
  assert.equal(envelope.error?.fieldErrors?.[0]?.path, "schedule.timeZone");
  assert.equal(envelope.meta?.command, "invocation");
  assert.equal(rendered.output.includes(privateValue), false);
  assert.equal(rendered.output.includes("first"), false);
  assert.equal(rendered.output.includes("second"), false);
});

test("renderMurphCliEntrypointError uses the final repeated format flag", async () => {
  const error = new VaultCliError("invalid_option", "Duplicate vault option.");
  const json = await renderMurphCliEntrypointError(
    error,
    ["--format", "yaml", "--json"],
    { human: false },
  );
  const yaml = await renderMurphCliEntrypointError(
    error,
    ["--json", "--format", "yaml"],
    { human: false },
  );

  assert.deepEqual(JSON.parse(json.output), {
    code: "invalid_option",
    message: "Duplicate vault option.",
    retryable: false,
  });
  assert.match(yaml.output, /^code: invalid_option$/mu);
});

test("renderMurphCliEntrypointError wraps every formatter with full-output", async () => {
  const error = new VaultCliError(
    "invalid_option",
    "Pass vault only once.",
  );

  const plain = await renderMurphCliEntrypointError(
    new VaultCliError(
      error.code,
      error.message,
    ),
    ["--vault", "one", "--vault", "two", "--format", "json"],
    { human: true },
  );

  const direct = JSON.parse(plain.output) as { code?: string; error?: unknown };
  assert.equal(direct.code, "invalid_option");
  assert.equal(direct.error, undefined);

  const full = await renderMurphCliEntrypointError(
    error,
    ["--vault", "one", "--vault", "two", "--full-output", "--format", "json"],
    { human: true },
  );
  const fullEnvelope = JSON.parse(full.output) as {
    code?: string;
    error?: { code?: string };
    ok?: boolean;
  };
  assert.equal(fullEnvelope.ok, false);
  assert.equal(fullEnvelope.code, undefined);
  assert.equal(fullEnvelope.error?.code, "invalid_option");

  const yaml = await renderMurphCliEntrypointError(
    error,
    ["--vault", "one", "--vault", "two", "--full-output", "--format", "yaml"],
    { human: true },
  );
  assert.match(yaml.output, /^ok:\s+false$/mu);
  assert.match(yaml.output, /^error:/mu);
  assert.match(yaml.output, /^\s+code:\s+invalid_option$/mu);
});

test("renderMurphCliEntrypointError defaults non-interactive failures to machine TOON", async () => {
  const rendered = await renderMurphCliEntrypointError(
    Object.assign(new Error("permission denied at /private/vault/config.json"), {
      code: "EACCES",
    }),
    [],
    { human: false },
  );

  assert.equal(rendered.machineReadable, true);
  assert.match(rendered.output, /permission_denied/u);
  assert.match(rendered.output, /filesystem/u);
  assert.match(rendered.output, /private\/vault/u);
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



test("runMurphCliAction allows vault-cli init to target an explicit vault", async () => {
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
  });

  await runMurphCliAction(["init", "--vault", "/vaults/new"], {
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
  });

  try {
    await runMurphCliEntrypoint(["assistant", "status"]);

    assert.deepEqual(loadEnvFile.mock.calls.length, 2);
    assert.deepEqual(loadEnvFileCalls, [
      path.join(process.cwd(), ".env.local"),
      path.join(process.cwd(), ".env"),
    ]);
    assert.deepEqual(serve.mock.calls, [
      [
        ["assistant", "status"],
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
  });

  let caughtError: unknown = null;
  try {
    await runMurphCliEntrypoint(["assistant", "status"]);
  } catch (error) {
    caughtError = error;
  }

  assert.equal(caughtError, primaryError);
  assert.deepEqual(stopWarmCodexAppServer.mock.calls, [["cli-entrypoint-exit"]]);
});

test("runMurphCliEntrypoint preserves command failure when warm Codex shutdown also fails", async () => {
  const primaryError = new VaultCliError("command_failed", "Primary command failed.");
  const cleanupError = new Error("warm shutdown failed");
  const serve = vi.fn(async () => {
    throw primaryError;
  });
  const stopWarmCodexAppServer = vi.fn(async () => {
    throw cleanupError;
  });

  mockCliActionModules({
    codexLifecycleModule: { stopWarmCodexAppServer },
    cli: { serve },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
      resolveConfiguredDefaultVault: vi.fn(async () => null),
      resolveDefaultVault: vi.fn(async () => "/vaults/default"),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
  });

  await assert.rejects(
    () => runMurphCliEntrypoint(["assistant", "status"]),
    (error) => error === primaryError,
  );
});

test("runMurphCliEntrypoint surfaces warm Codex shutdown failure after success", async () => {
  const cleanupError = new Error("warm shutdown failed");
  const serve = vi.fn(async () => undefined);
  const stopWarmCodexAppServer = vi.fn(async () => {
    throw cleanupError;
  });

  mockCliActionModules({
    codexLifecycleModule: { stopWarmCodexAppServer },
    cli: { serve },
    operatorConfigModule: {
      expandConfiguredVaultPath: vi.fn(),
      resolveConfiguredDefaultVault: vi.fn(async () => null),
      resolveDefaultVault: vi.fn(async () => "/vaults/default"),
      resolveOperatorHomeDirectory: vi.fn(() => "/operator-home"),
    },
  });

  await assert.rejects(
    () => runMurphCliEntrypoint(["assistant", "status"]),
    (error) => error === cleanupError,
  );
});
