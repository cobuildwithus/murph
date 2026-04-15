import { describe, expect, it, vi } from "vitest";

import { tryKillProcess } from "../src/node/index.ts";

describe("runtime-state process kill", () => {
  it("passes the requested pid and signal through when kill succeeds", () => {
    const killProcess = vi.fn();

    expect(() => tryKillProcess(killProcess, 123, "SIGTERM")).not.toThrow();
    expect(killProcess).toHaveBeenCalledWith(123, "SIGTERM");
  });

  it("swallows ESRCH errors and rethrows other failures", () => {
    const missingProcessError = Object.assign(new Error("missing"), { code: "ESRCH" });
    const missingProcessKill = vi.fn(() => {
      throw missingProcessError;
    });

    expect(() => tryKillProcess(missingProcessKill, 456, "SIGKILL")).not.toThrow();

    const permissionError = Object.assign(new Error("denied"), { code: "EPERM" });
    const deniedKill = vi.fn(() => {
      throw permissionError;
    });

    expect(() => tryKillProcess(deniedKill, 789, 9)).toThrow(permissionError);
  });
});
