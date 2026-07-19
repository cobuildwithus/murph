import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import setupMurphVitestTempRoot from "../config/vitest-temp-global-setup.ts";
import {
  cleanupStaleTestTempRoots,
  MURPH_VITEST_TEMP_MARKER,
  MURPH_VITEST_TEMP_PREFIX,
  resolveMurphTestTempBaseDirectory,
} from "../config/vitest-temp-lifecycle.ts";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "murph-temp-lifecycle-test-"));
  roots.push(root);
  return root;
}

function writeMarker(root: string, name: string, ownerPid: number, createdAt: string): string {
  const candidate = path.join(root, name);
  mkdirSync(candidate);
  writeFileSync(
    path.join(candidate, MURPH_VITEST_TEMP_MARKER),
    `${JSON.stringify({ schemaVersion: 1, ownerPid, createdAt })}\n`,
  );
  return candidate;
}

function ownedRootName(suffix: string): string {
  return `${MURPH_VITEST_TEMP_PREFIX}${suffix}`;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true });
  delete process.env.MURPH_VITEST_TEMP_PARENT;
  delete process.env.MURPH_VITEST_TEMP_ROOT;
});

describe("Vitest temp lifecycle", () => {
  it("removes only old marked roots with dead owners and no active cwd", async () => {
    const root = makeRoot();
    const oldDate = "2026-07-10T00:00:00.000Z";
    const youngDate = "2026-07-19T11:30:00.000Z";
    const removable = writeMarker(root, ownedRootName("removable"), 101, oldDate);
    const live = writeMarker(root, ownedRootName("live"), 102, oldDate);
    const activeCwd = writeMarker(root, ownedRootName("active-cwd"), 103, oldDate);
    mkdirSync(path.join(activeCwd, "nested"));
    const young = writeMarker(root, ownedRootName("young"), 104, youngDate);
    const unmarked = path.join(root, ownedRootName("unmarked"));
    mkdirSync(unmarked);

    const result = await cleanupStaleTestTempRoots({
      activeCwds: [path.join(activeCwd, "nested")],
      apply: true,
      baseDirectory: root,
      isProcessAlive: (pid) => pid === 102,
      nowMs: Date.parse("2026-07-19T12:00:00.000Z"),
      staleAfterMs: 60 * 60 * 1000,
    });

    expect(existsSync(removable)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(activeCwd)).toBe(true);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(unmarked)).toBe(true);
    expect(result.ignoredUnmarked).toBe(1);
    expect(result.decisions.map(({ action, reason }) => `${action}:${reason}`).sort()).toEqual([
      "keep:active-cwd",
      "keep:invalid-marker",
      "keep:live-owner",
      "keep:young",
      "removed:stale",
    ]);
  });

  it("defaults to a non-mutating dry run", async () => {
    const root = makeRoot();
    const candidate = writeMarker(root, ownedRootName("dry-run"), 201, "2026-07-01T00:00:00.000Z");

    const result = await cleanupStaleTestTempRoots({
      activeCwds: [],
      baseDirectory: root,
      isProcessAlive: () => false,
      nowMs: Date.parse("2026-07-19T12:00:00.000Z"),
      staleAfterMs: 1,
    });

    expect(existsSync(candidate)).toBe(true);
    expect(result.decisions).toEqual([
      { action: "remove", path: realpathSync(candidate), reason: "stale" },
    ]);
  });

  it("fails closed when current-process working directories cannot be inspected", async () => {
    const root = makeRoot();
    const candidate = writeMarker(
      root,
      ownedRootName("cwd-inspection-unavailable"),
      301,
      "2026-07-01T00:00:00.000Z",
    );

    const result = await cleanupStaleTestTempRoots({
      activeCwds: null,
      apply: true,
      baseDirectory: root,
      isProcessAlive: () => false,
      nowMs: Date.parse("2026-07-19T12:00:00.000Z"),
      staleAfterMs: 1,
    });

    expect(existsSync(candidate)).toBe(true);
    expect(result.decisions).toEqual([
      { action: "keep", path: realpathSync(candidate), reason: "active-cwd" },
    ]);
  });

  it("treats an absent dedicated owner directory as empty", async () => {
    const root = makeRoot();
    const missing = path.join(root, "missing");

    await expect(cleanupStaleTestTempRoots({ baseDirectory: missing })).resolves.toEqual({
      decisions: [],
      ignoredUnmarked: 0,
    });
    expect(existsSync(missing)).toBe(false);
  });

  it("leaves room for nested macOS Unix-domain socket paths", () => {
    if (process.platform !== "darwin") return;
    const representativeSocket = path.join(
      resolveMurphTestTempBaseDirectory(),
      `${MURPH_VITEST_TEMP_PREFIX}XXXXXX`,
      "tsx-99999",
      "99999.pipe",
    );

    expect(Buffer.byteLength(representativeSocket)).toBeLessThan(104);
  });

  it("routes a run through one marked root and removes it during teardown", async () => {
    const root = makeRoot();
    const originalTempEnv = {
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
    };
    process.env.MURPH_VITEST_TEMP_PARENT = root;
    delete process.env.MURPH_VITEST_TEMP_ROOT;

    const teardown = await setupMurphVitestTempRoot();
    const tempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    expect(tempRoot).toBeTruthy();
    expect(process.env.TMPDIR).toBe(tempRoot);
    expect(process.env.TMP).toBe(tempRoot);
    expect(process.env.TEMP).toBe(tempRoot);
    expect(existsSync(path.join(tempRoot!, MURPH_VITEST_TEMP_MARKER))).toBe(true);
    mkdirSync(path.join(tempRoot!, "murph-vault-example"));

    await teardown();

    expect(existsSync(tempRoot!)).toBe(false);
    expect(process.env.TMPDIR).toBe(originalTempEnv.TMPDIR);
    expect(process.env.TMP).toBe(originalTempEnv.TMP);
    expect(process.env.TEMP).toBe(originalTempEnv.TEMP);
  });

  it("keeps a shared process root until every project setup releases it", async () => {
    const root = makeRoot();
    process.env.MURPH_VITEST_TEMP_PARENT = root;
    delete process.env.MURPH_VITEST_TEMP_ROOT;

    const firstTeardown = await setupMurphVitestTempRoot();
    const tempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    const secondTeardown = await setupMurphVitestTempRoot();
    expect(process.env.MURPH_VITEST_TEMP_ROOT).toBe(tempRoot);

    await firstTeardown();
    expect(existsSync(tempRoot!)).toBe(true);

    await secondTeardown();
    expect(existsSync(tempRoot!)).toBe(false);
  });

  it("wires the shared setup into every normal workspace-project entrypoint", () => {
    const workspaceConfigs = [
      "packages/cli/vitest.workspace.ts",
      "apps/web/vitest.workspace.ts",
      "apps/cloudflare/vitest.node.workspace.ts",
    ] as const;

    for (const relativePath of workspaceConfigs) {
      const source = readFileSync(path.resolve(import.meta.dirname, "..", relativePath), "utf8");
      expect(source, `${relativePath} is missing the shared setup import`).toContain(
        'import { murphVitestTempGlobalSetup } from "../../config/vitest-temp-lifecycle.js";',
      );
      expect(source, `${relativePath} project factory is missing temp ownership`).toContain(
        "globalSetup: [murphVitestTempGlobalSetup],",
      );
    }
  });
});
