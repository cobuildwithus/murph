import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
}));

import { runForegroundCommand } from "../src/process.ts";

describe("runForegroundCommand", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    spawn.mockReset();
  });

  it("forwards signals only to the detached process group it started", async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: ReturnType<typeof vi.fn>;
      pid: number;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    child.pid = 4321;
    child.signalCode = null;
    spawn.mockReturnValue(child);

    let signalHandler: (() => void) | undefined;
    const originalOn = process.on.bind(process);
    vi.spyOn(process, "on").mockImplementation(((event, listener) => {
      if (event === "SIGTERM") {
        signalHandler = listener as () => void;
      }
      return originalOn(event, listener);
    }) as typeof process.on);
    let processGroupRunning = true;
    const kill = vi.spyOn(process, "kill").mockImplementation(((pid, signal = 0) => {
      if (signal === 0 && !processGroupRunning) {
        const error = new Error("process group exited") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      if (signal !== 0) {
        processGroupRunning = false;
      }
      return true;
    }) as typeof process.kill);

    const command = runForegroundCommand({
      args: ["arg"],
      command: "command",
      cwd: ".",
      env: {},
      forwardProcessSignals: ["SIGTERM"],
      label: "test command",
    });

    expect(signalHandler).toBeTypeOf("function");
    signalHandler?.();
    signalHandler?.();
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await expect(command).rejects.toMatchObject({
      commandSignal: "SIGTERM",
      name: "ForegroundCommandSignalError",
    });

    expect(spawn).toHaveBeenCalledWith("command", ["arg"], {
      cwd: ".",
      detached: process.platform !== "win32",
      env: {},
      stdio: "inherit",
    });
    if (process.platform === "win32") {
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(kill).not.toHaveBeenCalled();
    } else {
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
      expect(kill.mock.calls.filter(([, signal]) => signal === "SIGTERM")).toHaveLength(1);
      expect(child.kill).not.toHaveBeenCalled();
    }
  });

  it.runIf(process.platform !== "win32")(
    "force-stops an owned process group that ignores the first signal",
    async () => {
      vi.useFakeTimers();
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        signalCode: NodeJS.Signals | null;
      };
      child.exitCode = null;
      child.kill = vi.fn(() => true);
      child.pid = 5432;
      child.signalCode = null;
      spawn.mockReturnValue(child);

      let signalHandler: (() => void) | undefined;
      vi.spyOn(process, "on").mockImplementation(((event, listener) => {
        if (event === "SIGTERM") {
          signalHandler = listener as () => void;
        }
        return process;
      }) as typeof process.on);
      vi.spyOn(process, "off").mockImplementation(() => process);
      let processGroupRunning = true;
      const kill = vi.spyOn(process, "kill").mockImplementation(((pid, signal = 0) => {
        if (signal === 0 && !processGroupRunning) {
          const error = new Error("process group exited") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        if (signal === "SIGKILL") {
          processGroupRunning = false;
        }
        return true;
      }) as typeof process.kill);

      const command = runForegroundCommand({
        args: [],
        command: "command",
        cwd: ".",
        env: {},
        forwardProcessSignals: ["SIGTERM"],
        label: "ignored-signal command",
      });
      const rejection = expect(command).rejects.toMatchObject({
        commandSignal: "SIGTERM",
        name: "ForegroundCommandSignalError",
      });

      signalHandler?.();
      signalHandler?.();
      await vi.advanceTimersByTimeAsync(5_000);

      await rejection;
      expect(kill.mock.calls.filter(([, signal]) => signal === "SIGTERM")).toHaveLength(1);
      expect(kill.mock.calls.filter(([, signal]) => signal === "SIGKILL")).toHaveLength(1);
    },
  );
});
