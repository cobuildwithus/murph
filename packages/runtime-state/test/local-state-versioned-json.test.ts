import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "vitest";

import {
  defineLocalStateDirectoryDescriptor,
  defineLocalStateFileDescriptor,
  defineLocalStatePrefixDescriptor,
  defineLocalStateSubtreeDescriptor,
  descriptorMatchesRelativePath,
  findMostSpecificMatchingLocalStateDescriptor,
  isPortableLocalStateContainerRelativePath,
  normalizeVaultLocalStateRelativePath,
} from "../src/local-state-descriptor-helpers.ts";
import {
  classifyVaultLocalStateRelativePath,
  describeVaultLocalStateRelativePath,
  getVaultLocalStatePortability,
  isPortableVaultOperationalContainerRelativePath,
  isVaultEphemeralRelativePath,
  isVaultOperationalRelativePath,
  isVaultProjectionRelativePath,
} from "../src/local-state-taxonomy.ts";
import {
  hasLocalStatePath,
  hasLocalStatePathSync,
  readLocalStateTextFile,
} from "../src/local-state-files.ts";
import {
  resolveDeviceSyncRuntimePaths,
  resolveGatewayRuntimePaths,
  resolveInboxRuntimePaths,
  resolveParserRuntimePaths,
  resolveRuntimePaths,
} from "../src/runtime-paths.ts";
import {
  buildProcessCommand,
  fingerprintHost,
  resolveSiblingLocalStateBucketRoot,
  toVaultRelativePath,
} from "../src/shared.ts";
import {
  readVersionedJsonStateFile,
  writeVersionedJsonStateFile,
} from "../src/versioned-json-files.ts";
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
} from "../src/versioned-json-state.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { force: true, recursive: true })),
  );
});

async function createTempRoot(prefix: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(tempRoot);
  return tempRoot;
}

describe("runtime-state local-state files", () => {
  test("detects and reads local-state files", async () => {
    const tempRoot = await createTempRoot("runtime-state-local-state-files-");
    const filePath = path.join(tempRoot, "state.json");
    await writeFile(filePath, "hello local state\n", "utf8");

    assert.equal(hasLocalStatePathSync({ currentPath: filePath }), true);
    assert.equal(await hasLocalStatePath({ currentPath: filePath }), true);
    assert.deepEqual(await readLocalStateTextFile({ currentPath: filePath }), {
      path: filePath,
      text: "hello local state\n",
    });

    const missingPath = path.join(tempRoot, "missing.json");
    assert.equal(hasLocalStatePathSync({ currentPath: missingPath }), false);
    assert.equal(await hasLocalStatePath({ currentPath: missingPath }), false);
  });
});

describe("runtime-state local-state descriptors", () => {
  const descriptors = [
    defineLocalStateSubtreeDescriptor({
      classification: "operational",
      description: "portable subtree",
      owner: "test",
      portability: "portable",
      rebuildable: false,
      relativePath: ".runtime/operations/assistant/outbox",
    }),
    defineLocalStateSubtreeDescriptor({
      classification: "operational",
      description: "machine-local override",
      owner: "test",
      portability: "machine_local",
      rebuildable: false,
      relativePath: ".runtime/operations/assistant/outbox/.quarantine",
    }),
    defineLocalStateFileDescriptor({
      classification: "operational",
      description: "portable file",
      owner: "test",
      portability: "portable",
      rebuildable: false,
      relativePath: ".runtime/operations/inbox/promotions.json",
    }),
    defineLocalStateDirectoryDescriptor({
      classification: "operational",
      description: "portable directory",
      owner: "test",
      portability: "portable",
      rebuildable: false,
      relativePath: ".runtime/operations/assistant/cron",
    }),
    defineLocalStatePrefixDescriptor({
      classification: "operational",
      description: "portable prefix",
      owner: "test",
      portability: "portable",
      rebuildable: false,
      relativePath: ".runtime/operations/op_",
    }),
  ] as const;

  test("normalizes relative paths and matches each descriptor kind truthfully", () => {
    assert.equal(
      normalizeVaultLocalStateRelativePath("\\.runtime//operations/assistant/outbox/"),
      ".runtime/operations/assistant/outbox",
    );

    assert.equal(
      descriptorMatchesRelativePath(
        ".runtime/operations/assistant/outbox/message.json",
        descriptors[0],
      ),
      true,
    );
    assert.equal(
      descriptorMatchesRelativePath(
        ".runtime/operations/assistant/outbox-extra/message.json",
        descriptors[0],
      ),
      false,
    );
    assert.equal(
      descriptorMatchesRelativePath(".runtime/operations/inbox/promotions.json", descriptors[2]),
      true,
    );
    assert.equal(
      descriptorMatchesRelativePath(".runtime/operations/assistant/cron", descriptors[3]),
      true,
    );
    assert.equal(
      descriptorMatchesRelativePath(".runtime/operations/op_123/payload.json", descriptors[4]),
      true,
    );
    assert.equal(
      descriptorMatchesRelativePath(".runtime/operations/opx_123/payload.json", descriptors[4]),
      false,
    );
  });

  test("prefers the most specific matching descriptor and identifies portable containers", () => {
    assert.equal(
      findMostSpecificMatchingLocalStateDescriptor(
        ".runtime/operations/assistant/outbox/.quarantine/item.json",
        descriptors,
      )?.description,
      "machine-local override",
    );
    assert.equal(
      findMostSpecificMatchingLocalStateDescriptor(
        ".runtime/operations/inbox/promotions.json",
        descriptors,
        "projection",
      ),
      null,
    );

    assert.equal(
      isPortableLocalStateContainerRelativePath(".runtime/operations/assistant", descriptors),
      true,
    );
    assert.equal(
      isPortableLocalStateContainerRelativePath(".runtime/operations/inbox", descriptors),
      true,
    );
    assert.equal(
      isPortableLocalStateContainerRelativePath(".runtime/operations/op_", descriptors),
      false,
    );
    assert.equal(
      isPortableLocalStateContainerRelativePath(".runtime/operations", descriptors),
      true,
    );
    assert.equal(
      isPortableLocalStateContainerRelativePath(".runtime/operations/device-sync", descriptors),
      false,
    );
  });
});

describe("runtime-state taxonomy and runtime paths", () => {
  test("classifies and describes runtime paths using the live manifests", () => {
    assert.equal(
      classifyVaultLocalStateRelativePath(".runtime/operations/assistant/status.json")
        ?.classification,
      "operational",
    );
    assert.equal(
      classifyVaultLocalStateRelativePath(".runtime/projections/query.sqlite")?.classification,
      "projection",
    );
    assert.equal(
      classifyVaultLocalStateRelativePath(".runtime/cache/tool-output.txt")?.classification,
      "ephemeral",
    );
    assert.equal(classifyVaultLocalStateRelativePath("vault.json"), null);

    const assistantUsagePath = describeVaultLocalStateRelativePath(
      ".runtime/operations/assistant/usage/pending/one.json",
    );
    assert.ok(assistantUsagePath);
    assert.equal(assistantUsagePath.classification, "operational");
    assert.equal(assistantUsagePath.defaultPortability, "machine_local");
    assert.equal(
      assistantUsagePath.description,
      "Assistant pending usage records that must move with hosted usage import continuity.",
    );
    assert.equal(assistantUsagePath.owner, "assistant-runtime");
    assert.equal(assistantUsagePath.portability, "portable");
    assert.equal(assistantUsagePath.rebuildable, false);
    assert.equal(
      assistantUsagePath.relativePath,
      ".runtime/operations/assistant/usage/pending/one.json",
    );
    assert.equal(assistantUsagePath.rootRelativePath, ".runtime/operations");

    assert.equal(
      describeVaultLocalStateRelativePath(".runtime/operations/assistant/outbox/.quarantine/a.json")
        ?.portability,
      "machine_local",
    );
    assert.equal(
      describeVaultLocalStateRelativePath(".runtime/operations/op_123/payload.json")?.owner,
      "write-operations",
    );
    assert.equal(getVaultLocalStatePortability(".runtime/projections/query.sqlite"), "machine_local");
    assert.equal(isVaultOperationalRelativePath(".runtime/operations/inbox/config.json"), true);
    assert.equal(isVaultProjectionRelativePath(".runtime/projections/query.sqlite"), true);
    assert.equal(isVaultEphemeralRelativePath(".runtime/tmp/socket.sock"), true);
    assert.equal(isPortableVaultOperationalContainerRelativePath(".runtime/operations/assistant"), true);
    assert.equal(isPortableVaultOperationalContainerRelativePath(".runtime/operations/device-sync"), false);
  });

  test("resolves runtime path groups from the vault root", () => {
    const runtimePaths = resolveRuntimePaths("vault");
    assert.equal(runtimePaths.absoluteVaultRoot, path.resolve("vault"));
    assert.equal(runtimePaths.runtimeRoot, path.join(path.resolve("vault"), ".runtime"));
    assert.equal(
      runtimePaths.deviceSyncLauncherStatePath,
      path.join(path.resolve("vault"), ".runtime", "operations", "device-sync", "launcher.json"),
    );
    assert.equal(
      resolveInboxRuntimePaths("vault").inboxPromotionsPath,
      path.join(path.resolve("vault"), ".runtime", "operations", "inbox", "promotions.json"),
    );
    assert.equal(
      resolveDeviceSyncRuntimePaths("vault").deviceSyncDbPath,
      path.join(path.resolve("vault"), ".runtime", "operations", "device-sync", "state.sqlite"),
    );
    assert.equal(
      resolveGatewayRuntimePaths("vault").gatewayDbPath,
      path.join(path.resolve("vault"), ".runtime", "projections", "gateway.sqlite"),
    );
    assert.equal(
      resolveParserRuntimePaths("vault").parserToolchainConfigPath,
      path.join(path.resolve("vault"), ".runtime", "operations", "parsers", "toolchain.json"),
    );
  });
});

describe("runtime-state shared helpers", () => {
  test("builds stable path-derived helper values", () => {
    const bucket = resolveSiblingLocalStateBucketRoot("/tmp/work/vault", ".assistant-state");
    assert.equal(bucket.absoluteVaultRoot, path.resolve("/tmp/work/vault"));
    assert.match(bucket.bucketName, /^vault-[0-9a-f]{12}$/u);
    assert.equal(
      bucket.rootPath,
      path.join(path.dirname(path.resolve("/tmp/work/vault")), ".assistant-state", bucket.bucketName),
    );

    assert.equal(
      buildProcessCommand(["/usr/local/bin/node", "/tmp/bin/vault-cli", "--help"]),
      "node vault-cli",
    );
    assert.equal(buildProcessCommand(["", ""]), "unknown");
    assert.equal(fingerprintHost("host.example"), fingerprintHost("host.example"));
    assert.match(fingerprintHost("host.example"), /^sha256:[0-9a-f]{12}$/u);
    assert.equal(toVaultRelativePath("/tmp/work/vault", "/tmp/work/vault"), ".");
    assert.equal(
      toVaultRelativePath("/tmp/work/vault", "/tmp/work/vault/.runtime/operations/inbox/state.json"),
      path.join(".runtime", "operations", "inbox", "state.json"),
    );
  });
});

describe("runtime-state versioned JSON helpers", () => {
  test("creates and parses versioned envelopes", () => {
    const envelope = createVersionedJsonStateEnvelope({
      schema: "test.schema",
      schemaVersion: 2,
      value: { enabled: true },
    });
    assert.deepEqual(envelope, {
      schema: "test.schema",
      schemaVersion: 2,
      value: { enabled: true },
    });

    assert.deepEqual(
      parseVersionedJsonStateEnvelope(envelope, {
        label: "test state",
        parseValue(value) {
          return value as { enabled: boolean };
        },
        schema: "test.schema",
        schemaVersion: 2,
      }),
      { enabled: true },
    );

    assert.throws(
      () =>
        parseVersionedJsonStateEnvelope(
          { ...envelope, schema: "other.schema" },
          {
            label: "test state",
            parseValue(value) {
              return value;
            },
            schema: "test.schema",
            schemaVersion: 2,
          },
        ),
      /schema must be test\.schema/u,
    );
    assert.throws(
      () =>
        parseVersionedJsonStateEnvelope(
          { ...envelope, schemaVersion: 3 },
          {
            label: "test state",
            parseValue(value) {
              return value;
            },
            schema: "test.schema",
            schemaVersion: 2,
          },
        ),
      /schemaVersion must be 2/u,
    );
    assert.throws(
      () =>
        parseVersionedJsonStateEnvelope(
          { value: { enabled: true } },
          {
            label: "test state",
            parseValue(value) {
              return value;
            },
            schema: "test.schema",
            schemaVersion: 2,
          },
        ),
      /must be a versioned test\.schema envelope/u,
    );
  });

  test("writes and reads versioned JSON state files with fs defaults", async () => {
    const tempRoot = await createTempRoot("runtime-state-versioned-json-");
    const filePath = path.join(tempRoot, "nested", "state.json");

    await writeVersionedJsonStateFile({
      filePath,
      mode: 0o600,
      schema: "test.schema",
      schemaVersion: 1,
      value: { count: 3 },
    });

    const rawText = await readFile(filePath, "utf8");
    assert.equal(rawText.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(rawText), {
      schema: "test.schema",
      schemaVersion: 1,
      value: { count: 3 },
    });

    const fileStat = await stat(filePath);
    assert.equal(fileStat.mode & 0o777, 0o600);

    assert.deepEqual(
      await readVersionedJsonStateFile({
        currentPath: filePath,
        label: "test state",
        parseValue(value) {
          assert.deepEqual(value, { count: 3 });
          return value as { count: number };
        },
        schema: "test.schema",
        schemaVersion: 1,
      }),
      {
        filePath,
        value: { count: 3 },
      },
    );
  });

  test("uses injected read and write dependencies for versioned state files", async () => {
    const calls: Array<{ mode?: number; path: string; text?: string; type: "chmod" | "mkdir" | "writeFile" }> = [];
    let writtenText: string | undefined;

    await writeVersionedJsonStateFile(
      {
        filePath: "/tmp/state.json",
        mode: 0o640,
        schema: "test.schema",
        schemaVersion: 4,
        value: { count: 7 },
      },
      {
        async chmod(targetPath, mode) {
          calls.push({
            mode,
            path: targetPath,
            type: "chmod",
          });
        },
        async mkdir(targetPath) {
          calls.push({
            path: targetPath,
            type: "mkdir",
          });
        },
        async writeFile(targetPath, text) {
          writtenText = text;
          calls.push({
            path: targetPath,
            text,
            type: "writeFile",
          });
        },
      },
    );

    assert.deepEqual(
      calls.map((entry) => ({
        path: entry.path,
        type: entry.type,
        ...(typeof entry.mode === "number" ? { mode: entry.mode } : {}),
      })),
      [
        {
          path: path.dirname("/tmp/state.json"),
          type: "mkdir",
        },
        {
          path: "/tmp/state.json",
          type: "writeFile",
        },
        {
          mode: 0o640,
          path: "/tmp/state.json",
          type: "chmod",
        },
      ],
    );
    assert.equal(Boolean(writtenText?.endsWith("\n")), true);
    assert.ok(writtenText);
    assert.deepEqual(JSON.parse(writtenText), {
      schema: "test.schema",
      schemaVersion: 4,
      value: {
        count: 7,
      },
    });

    assert.deepEqual(
      await readVersionedJsonStateFile(
        {
          currentPath: "/tmp/state.json",
          label: "test state",
          parseValue(value) {
            assert.deepEqual(value, { count: 9 });
            return value as { count: number };
          },
          schema: "test.schema",
          schemaVersion: 4,
        },
        {
          async readFile(targetPath) {
            assert.equal(targetPath, "/tmp/state.json");
            return JSON.stringify({
              schema: "test.schema",
              schemaVersion: 4,
              value: { count: 9 },
            });
          },
        },
      ),
      {
        filePath: "/tmp/state.json",
        value: { count: 9 },
      },
    );
  });
});
