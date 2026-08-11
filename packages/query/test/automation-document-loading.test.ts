import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const automationReadHook = vi.hoisted(() => ({
  beforeRead: null as null | ((relativePath: string) => Promise<void>),
}));

vi.mock("../src/health/loaders.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/health/loaders.ts")>();
  return {
    ...actual,
    readMarkdownDocument: async (vaultRoot: string, relativePath: string) => {
      await automationReadHook.beforeRead?.(relativePath);
      return actual.readMarkdownDocument(vaultRoot, relativePath);
    },
  };
});

import { listAutomations } from "../src/automation.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  automationReadHook.beforeRead = null;
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("automation document loading", () => {
  it("loads a bounded batch concurrently and keeps deterministic output order", async () => {
    const vaultRoot = await createVaultRoot();
    const relativePaths = Array.from(
      { length: 18 },
      (_, index) => `bank/automations/${String(index).padStart(2, "0")}.md`,
    );
    await Promise.all(
      relativePaths.map((relativePath, index) =>
        writeAutomationDocument(
          vaultRoot,
          relativePath,
          `Title ${String(relativePaths.length - index - 1).padStart(2, "0")}`,
        )
      ),
    );

    const gates = new Map(relativePaths.map((relativePath) => [relativePath, createDeferred()]));
    const firstBatchStarted = createDeferred();
    const secondBatchStarted = createDeferred();
    const startedPaths: string[] = [];
    let activeReads = 0;
    let maximumActiveReads = 0;

    automationReadHook.beforeRead = async (relativePath) => {
      startedPaths.push(relativePath);
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      if (startedPaths.length === 16) {
        firstBatchStarted.resolve();
      }
      if (startedPaths.length === relativePaths.length) {
        secondBatchStarted.resolve();
      }

      const gate = gates.get(relativePath);
      if (!gate) {
        throw new Error(`Unexpected automation read: ${relativePath}`);
      }
      await gate.promise;
      activeReads -= 1;
    };

    const recordsPromise = listAutomations(vaultRoot);

    await firstBatchStarted.promise;
    expect(startedPaths).toEqual(relativePaths.slice(0, 16));
    expect(activeReads).toBe(16);
    expect(maximumActiveReads).toBe(16);

    for (const relativePath of relativePaths.slice(0, 16)) {
      gates.get(relativePath)?.resolve();
    }

    await secondBatchStarted.promise;
    expect(startedPaths).toEqual(relativePaths);
    expect(activeReads).toBe(2);
    expect(maximumActiveReads).toBe(16);

    for (const relativePath of relativePaths.slice(16)) {
      gates.get(relativePath)?.resolve();
    }

    const records = await recordsPromise;
    expect(records.map((record) => record.relativePath)).toEqual(
      [...relativePaths].reverse(),
    );
    expect(records.every(
      (record) => record.scheduleAnchorAt === record.createdAt,
    )).toBe(true);
  });

  it("reports the earliest path failure even when a later read fails first", async () => {
    const vaultRoot = await createVaultRoot();
    const earlierPath = "bank/automations/alpha.md";
    const laterPath = "bank/automations/bravo.md";
    await Promise.all([
      writeAutomationDocument(vaultRoot, earlierPath, "Alpha"),
      writeAutomationDocument(vaultRoot, laterPath, "Bravo"),
    ]);

    const releaseEarlierRead = createDeferred();
    const laterReadFailed = createDeferred();
    const earlierFailure = new Error("earlier automation read failed");
    const laterFailure = new Error("later automation read failed");

    automationReadHook.beforeRead = async (relativePath) => {
      if (relativePath === earlierPath) {
        await releaseEarlierRead.promise;
        throw earlierFailure;
      }

      laterReadFailed.resolve();
      throw laterFailure;
    };

    const recordsPromise = listAutomations(vaultRoot);
    await laterReadFailed.promise;
    releaseEarlierRead.resolve();

    await expect(recordsPromise).rejects.toBe(earlierFailure);
  });
});

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-automation-loading-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank/automations"), { recursive: true });
  return vaultRoot;
}

async function writeAutomationDocument(
  vaultRoot: string,
  relativePath: string,
  title: string,
): Promise<void> {
  const slug = path.basename(relativePath, ".md");
  await writeFile(
    path.join(vaultRoot, relativePath),
    [
      "---",
      "schemaVersion: murph.frontmatter.automation.v1",
      "docType: automation",
      `automationId: auto_${slug}`,
      `slug: "${slug}"`,
      `title: ${title}`,
      "status: active",
      "schedule:",
      "  kind: every",
      "  everyMs: 60000",
      "route:",
      "  channel: linq",
      "  deliveryTarget: test-target",
      "  identityId: null",
      "  participantId: null",
      "  threadId: null",
      "createdAt: 2026-07-15T00:00:00.000Z",
      "updatedAt: 2026-07-15T00:00:00.000Z",
      "---",
      "",
      `Run ${title}.`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}
