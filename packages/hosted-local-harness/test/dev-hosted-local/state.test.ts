import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: fsMocks.mkdir,
    rename: fsMocks.rename,
    writeFile: fsMocks.writeFile,
  };
});

describe("hosted local state", () => {
  it("uses a unique temp path for overlapping state writes", async () => {
    const statePath = path.join(os.tmpdir(), "murph-hosted-local-state-test", "state.json");
    const { writeHostedLocalHarnessState } = await import(
      "../../src/state.ts"
    );

    await Promise.all([
      writeHostedLocalHarnessState(createState(statePath, "ready")),
      writeHostedLocalHarnessState(createState(statePath, "stopped")),
    ]);

    const renameCalls = fsMocks.rename.mock.calls as unknown as Array<[string, string]>;
    const tempPaths = renameCalls.map(([tempPath]) => tempPath);
    expect(tempPaths).toHaveLength(2);
    expect(new Set(tempPaths).size).toBe(2);
    for (const tempPath of tempPaths) {
      expect(tempPath).toEqual(expect.stringContaining(`${statePath}.${process.pid}.`));
      expect(tempPath).toEqual(expect.stringContaining(".tmp"));
    }
  });
});

function createState(
  statePath: string,
  status: "ready" | "stopped",
) {
  return {
    artifactDir: path.dirname(statePath),
    command: ["hosted-local", "up"],
    createdAt: "2026-05-07T00:00:00.000Z",
    cwd: ".",
    env: {},
    mode: "dev",
    profile: "dev",
    profileDescription: "Local hosted development stack.",
    runId: "state-test",
    statePath,
    status,
    updatedAt: "2026-05-07T00:00:00.000Z",
    version: 1,
    webBaseUrl: "http://localhost:3000",
    workerBaseUrl: "http://127.0.0.1:8787",
  } as const;
}
