import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareHostedSystemMailboxItemForCheckpoint,
  type HostedSystemMailboxRuntime,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

const tempRoots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("empty system-mailbox preparation", () => {
  it.each([false, true])(
    "does not write unchanged empty mailbox state (persisted=%s)",
    async (persisted) => {
      const workspace = await createHostedRuntimeWorkspace("system-mailbox-empty-");
      tempRoots.push(workspace.workspaceRoot);
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      if (persisted) {
        await updateHostedSystemMailboxState(workspace.vaultRoot, () => ({ pending: [] }));
      }
      const before = persisted ? await readFile(statePath, "utf8") : null;
      vi.mocked(writeFile).mockClear();
      vi.mocked(rename).mockClear();

      for (let pass = 0; pass < 3; pass += 1) {
        await expect(prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: ["apply-runtime-control-request", "continue-assistant-ask"],
          allowedWakeKinds: ["runtime.pending-effects-reconcile-requested", "assistant.ask.completed"],
          runtime: createRuntime(),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        })).resolves.toBeNull();
      }

      expect(vi.mocked(writeFile).mock.calls.filter(([file]) =>
        String(file) === statePath || String(file).startsWith(`${statePath}.`),
      )).toHaveLength(0);
      expect(vi.mocked(rename).mock.calls.filter(([, target]) => target === statePath))
        .toHaveLength(0);
      expect(await readHostedSystemMailboxState(workspace.vaultRoot)).toEqual({ pending: [] });
      if (persisted) {
        expect(await readFile(statePath, "utf8")).toBe(before);
      } else {
        await expect(access(statePath)).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );
});

function createRuntime(): HostedSystemMailboxRuntime {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() { throw new Error("Empty mailbox must not read artifacts."); },
        async put() { throw new Error("Empty mailbox must not write artifacts."); },
      },
      effectsPort: {
        async readRawEmailMessage() { throw new Error("Empty mailbox must not read provider data."); },
        async sendEmail() { throw new Error("Empty mailbox must not send a message."); },
      },
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}
