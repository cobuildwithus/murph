import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { test, vi } from "vitest";

import {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  ensureJournalDay,
  initializeVault,
  validateVault,
  VaultError,
} from "@murphai/core";
import {
  ensureCliRuntimeArtifacts,
  repoRoot,
  withoutNodeV8Coverage,
} from "./cli-test-helpers.js";

async function makeVaultRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "murph-lock-test-"));
}

async function holdCanonicalWriteLock(vaultRoot: string) {
  await ensureCliRuntimeArtifacts();
  const coreModuleUrl = pathToFileURL(path.join(repoRoot, "packages/core/dist/index.js")).href;
  const script = `
    const { acquireCanonicalWriteLock } = await import(${JSON.stringify(coreModuleUrl)});
    const lock = await acquireCanonicalWriteLock(process.argv[1]);
    process.stdout.write("ready\\n");
    process.stdin.on("end", async () => {
      await lock.release();
      process.exit(0);
    });
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, vaultRoot], {
    cwd: repoRoot,
    env: withoutNodeV8Coverage(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("ready")) {
        resolve();
      }
    });
    child.once("exit", (code) => {
      reject(new Error(`lock holder exited early with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });

  return {
    child,
    async release() {
      child.stdin.end();
      const [code] = (await once(child, "exit")) as [number | null];
      assert.equal(code, 0);
    },
  };
}

async function withCliUsecaseMocks<TResult>(options: {
  coreRuntime: unknown;
  queryRuntime?: unknown;
  run: () => Promise<TResult>;
}): Promise<TResult> {
  vi.resetModules();
  vi.doMock("@murphai/assistant-engine/runtime-import", () => ({
    loadRuntimeModule: async () => options.coreRuntime,
  }));

  if (options.queryRuntime) {
    vi.doMock("@murphai/assistant-engine/query-runtime", () => ({
      loadQueryRuntime: async () => options.queryRuntime,
    }));
  }

  try {
    return await options.run();
  } finally {
    vi.doUnmock("@murphai/assistant-engine/runtime-import");
    vi.doUnmock("@murphai/assistant-engine/query-runtime");
    vi.resetModules();
  }
}

function isVaultCliErrorLike(
  error: unknown,
  input: {
    code: string;
    message?: string;
    vaultCode: string;
    context?: Record<string, unknown>;
  },
): boolean {
  if (
    !(
      error &&
      typeof error === "object" &&
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === input.code &&
      "name" in error &&
      (error as { name?: unknown }).name === "VaultCliError" &&
      "context" in error &&
      typeof (error as { context?: unknown }).context === "object" &&
      (error as { context?: unknown }).context !== null
    )
  ) {
    return false;
  }

  if (input.message !== undefined && error.message !== input.message) {
    return false;
  }

  const context = (error as { context: Record<string, unknown> }).context;
  if (context.vaultCode !== input.vaultCode) {
    return false;
  }

  return Object.entries(input.context ?? {}).every(
    ([key, value]) => context[key] === value,
  );
}

test.sequential("acquireCanonicalWriteLock writes diagnostics and cleans up on release", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });

    const lock = await acquireCanonicalWriteLock(vaultRoot);
    const metadata = JSON.parse(await readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8")) as {
      pid: number;
      command: string;
      startedAt: string;
      host: string;
    };

    assert.equal(metadata.pid, process.pid);
    assert.equal(typeof metadata.command, "string");
    assert.equal(metadata.command.length > 0, true);
    assert.equal(typeof metadata.startedAt, "string");
    assert.equal(typeof metadata.host, "string");

    await lock.release();

    await assert.rejects(() => readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8"));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("validateVault reports stale canonical write locks", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });

    const liveLock = await acquireCanonicalWriteLock(vaultRoot);
    const liveMetadata = JSON.parse(
      await readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8"),
    ) as {
      host: string;
    };
    await liveLock.release();

    await mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
    await writeFile(
      path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
      `${JSON.stringify(
        {
          pid: 999_999,
          command: "test-lock-holder",
          startedAt: "2026-03-13T00:00:00.000Z",
          host: liveMetadata.host,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const validation = await validateVault({ vaultRoot });
    assert.equal(validation.valid, false);
    assert.equal(
      validation.issues.some((issue) => issue.code === "CANONICAL_WRITE_LOCK_STALE" && issue.path === CANONICAL_WRITE_LOCK_DIRECTORY),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("public core mutators reject concurrent writers while another process holds the lock", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });
    const heldLock = await holdCanonicalWriteLock(vaultRoot);

    try {
      await assert.rejects(
        () =>
          ensureJournalDay({
            vaultRoot,
            date: "2026-03-13",
          }),
        (error: unknown) => error instanceof VaultError && error.code === "CANONICAL_WRITE_LOCKED",
      );
    } finally {
      await heldLock.release();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("provider and event CLI usecases map renamed core error codes to CLI errors", async () => {
  const providerConflict = new VaultError("PROVIDER_CONFLICT", "Provider already exists.");
  const providerFrontmatter = new VaultError("PROVIDER_FRONTMATTER_INVALID", "Provider frontmatter is invalid.");
  const eventRecord = {
    entityId: "event_01JNV422Y2M5ZBV64ZP4N1DRB1",
    primaryLookupId: "event_01JNV422Y2M5ZBV64ZP4N1DRB1",
    lookupIds: ["event_01JNV422Y2M5ZBV64ZP4N1DRB1"],
    family: "event",
    recordClass: "ledger",
    path: "ledger/events/2026/2026-03.jsonl",
    kind: "note",
    status: null,
    occurredAt: "2026-03-12T12:00:00.000Z",
    date: "2026-03-12",
    stream: null,
    experimentSlug: null,
    title: "Mock note",
    tags: [],
    attributes: {
      id: "event_01JNV422Y2M5ZBV64ZP4N1DRB1",
      kind: "note",
      occurredAt: "2026-03-12T12:00:00.000Z",
      title: "Mock note",
      note: "Existing note",
    },
    body: null,
    frontmatter: null,
    links: [],
    relatedIds: [],
  };
  const eventFailures = [
    {
      vaultCode: "EVENT_KIND_INVALID",
      cliCode: "contract_invalid",
      message: "EVENT_KIND_INVALID failure",
    },
    {
      vaultCode: "EVENT_OCCURRED_AT_MISSING",
      cliCode: "invalid_timestamp",
      message: "EVENT_OCCURRED_AT_MISSING failure",
    },
    {
      vaultCode: "EVENT_CONTRACT_INVALID",
      cliCode: "contract_invalid",
      message: "EVENT_CONTRACT_INVALID failure",
    },
    {
      vaultCode: "INVALID_TIMESTAMP",
      cliCode: "invalid_timestamp",
      message: "INVALID_TIMESTAMP failure",
    },
    {
      vaultCode: "INVALID_INPUT",
      cliCode: "contract_invalid",
      message: "INVALID_INPUT failure",
    },
  ] as const;

  await withCliUsecaseMocks({
    coreRuntime: {
      upsertProvider: async () => {
        throw providerConflict;
      },
      listProviders: async () => {
        throw providerFrontmatter;
      },
      upsertEvent: async () => {
        throw new VaultError("EVENT_KIND_INVALID", "Event payload requires a supported kind.", {
          exampleDetail: "kind",
        });
      },
    },
    run: async () => {
      const { listProviderRecords, upsertEventRecord, upsertProviderRecord } = await import(
        "@murphai/assistant-engine/usecases/provider-event"
      );

      await assert.rejects(
        () =>
          upsertProviderRecord({
            vault: "/tmp/mock-vault",
            payload: {
              title: "Labcorp",
              status: "active",
            },
          }),
        (error: unknown) =>
          isVaultCliErrorLike(error, {
            code: "conflict",
            vaultCode: "PROVIDER_CONFLICT",
          }),
      );

      await assert.rejects(
        () =>
          listProviderRecords({
            vault: "/tmp/mock-vault",
            limit: 10,
          }),
        (error: unknown) =>
          isVaultCliErrorLike(error, {
            code: "contract_invalid",
            vaultCode: "PROVIDER_FRONTMATTER_INVALID",
          }),
      );

      for (const failure of eventFailures) {
        const eventRuntime = {
          upsertProvider: async () => {
            throw providerConflict;
          },
          listProviders: async () => {
            return [];
          },
          upsertEvent: async () => {
            throw new VaultError(failure.vaultCode, failure.message, {
              exampleDetail: failure.vaultCode.toLowerCase(),
            });
          },
        };

        await withCliUsecaseMocks({
          coreRuntime: eventRuntime,
          run: async () => {
            const { upsertEventRecord: upsertEventRecordWithRuntime } = await import(
              "@murphai/assistant-engine/usecases/provider-event"
            );

            await assert.rejects(
              () =>
                upsertEventRecordWithRuntime({
                  vault: "/tmp/mock-vault",
                  payload: {
                    kind: "note",
                    occurredAt: "2026-03-12T12:00:00.000Z",
                    title: "Mock note",
                  },
                }),
              (error: unknown) =>
                isVaultCliErrorLike(error, {
                  code: failure.cliCode,
                  message: failure.message,
                  vaultCode: failure.vaultCode,
                  context: {
                    exampleDetail: failure.vaultCode.toLowerCase(),
                  },
                }),
            );
          },
        });

        await withCliUsecaseMocks({
          coreRuntime: {
            upsertEvent: async () => {
              throw new VaultError(failure.vaultCode, failure.message, {
                exampleDetail: failure.vaultCode.toLowerCase(),
              });
            },
          },
          queryRuntime: {
            readVault: async () => ({}),
            lookupEntityById: () => eventRecord,
          },
          run: async () => {
            const { editEventRecord } = await import("@murphai/assistant-engine/usecases/event-record-mutations");

            await assert.rejects(
              () =>
                editEventRecord({
                  vault: "/tmp/mock-vault",
                  lookup: eventRecord.primaryLookupId,
                  entityLabel: "event",
                  set: ["title=Updated mock note"],
                }),
              (error: unknown) =>
                isVaultCliErrorLike(error, {
                  code: failure.cliCode,
                  message: failure.message,
                  vaultCode: failure.vaultCode,
                  context: {
                    exampleDetail: failure.vaultCode.toLowerCase(),
                  },
                }),
            );
          },
        });
      }
    },
  });
});

test.sequential("editEventRecord strips stored lifecycle metadata before calling core upsert", async () => {
  const capturedPayloads: Array<Record<string, unknown>> = [];
  const eventRecord = {
    entityId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    primaryLookupId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    lookupIds: ["evt_01JNV422Y2M5ZBV64ZP4N1DRB1"],
    family: "event",
    recordClass: "ledger",
    path: "ledger/events/2026/2026-03.jsonl",
    kind: "note",
    status: null,
    occurredAt: "2026-03-12T12:00:00.000Z",
    date: "2026-03-12",
    stream: null,
    experimentSlug: null,
    title: "Mock note",
    tags: [],
    attributes: {
      id: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
      kind: "note",
      occurredAt: "2026-03-12T12:00:00.000Z",
      title: "Mock note",
      note: "Existing note",
      lifecycle: {
        revision: 7,
      },
    },
    body: null,
    frontmatter: null,
    links: [],
    relatedIds: [],
  };

  await withCliUsecaseMocks({
    coreRuntime: {
      upsertEvent: async (input: { payload: Record<string, unknown> }) => {
        capturedPayloads.push(input.payload);
        return {
          eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
          ledgerFile: "ledger/events/2026/2026-03.jsonl",
          created: false,
        };
      },
    },
    queryRuntime: {
      readVault: async () => ({}),
      lookupEntityById: () => eventRecord,
    },
    run: async () => {
      const { editEventRecord } = await import("@murphai/assistant-engine/usecases/event-record-mutations");

      await editEventRecord({
        vault: "/tmp/mock-vault",
        lookup: eventRecord.primaryLookupId,
        entityLabel: "event",
        set: ["title=Updated mock note"],
      });
    },
  });

  assert.equal(capturedPayloads.length, 1);
  assert.equal(capturedPayloads[0]?.title, "Updated mock note");
  assert.equal("lifecycle" in (capturedPayloads[0] ?? {}), false);
});

test.sequential("experiment and journal CLI usecases map renamed core error codes to CLI errors", async () => {
  const journalFailure = new VaultError("JOURNAL_DAY_MISSING", "Journal day is missing.");
  const timestampFailure = new VaultError("INVALID_TIMESTAMP", "Invalid timestamp.");

  await withCliUsecaseMocks({
    coreRuntime: {
      appendJournal: async () => {
        throw journalFailure;
      },
      checkpointExperiment: async () => {
        throw timestampFailure;
      },
    },
    queryRuntime: {
      readVault: async () => ({}),
      lookupEntityById: () => ({
        family: "experiment",
        path: "experiments/focus-sprint.md",
      }),
    },
    run: async () => {
      const { appendJournalText, checkpointExperimentRecord } = await import(
        "@murphai/assistant-engine/usecases/experiment-journal-vault"
      );

      await assert.rejects(
        () =>
          appendJournalText({
            vault: "/tmp/mock-vault",
            date: "2026-03-13",
            text: "Checkpoint note",
          }),
        (error: unknown) =>
          isVaultCliErrorLike(error, {
            code: "not_found",
            vaultCode: "JOURNAL_DAY_MISSING",
          }),
      );

      await assert.rejects(
        () =>
          checkpointExperimentRecord({
            vault: "/tmp/mock-vault",
            lookup: "exp_01JNV422Y2M5ZBV64ZP4N1DRB1",
            occurredAt: "not-a-timestamp",
          }),
        (error: unknown) =>
          isVaultCliErrorLike(error, {
            code: "invalid_timestamp",
            vaultCode: "INVALID_TIMESTAMP",
          }),
      );
    },
  });
});
