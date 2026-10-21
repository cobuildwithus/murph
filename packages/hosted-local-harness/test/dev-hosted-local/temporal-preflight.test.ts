import { access } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.hoisted(() => vi.fn<(command: string, args: string[], input: { cwd: string; env: NodeJS.ProcessEnv; name: string; signal: AbortSignal }) => Promise<void>>(async () => {}));
vi.mock("../../src/dev-hosted-local/runtime.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/dev-hosted-local/runtime.ts")>(),
  runCommand,
}));
import { preflightHostedLocalTemporalWorker } from "../../src/dev-hosted-local/temporal-preflight.ts";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("Temporal producer/consumer startup preflight", () => {
  it("passes the emitted current fixtures to the consumer without hosted credentials", async () => {
    await preflightHostedLocalTemporalWorker({
      env: { PATH: "/synthetic/bin", HOME: "/synthetic/home", HOSTED_TEMPORAL_API_KEY: "synthetic-secret", NODE_OPTIONS: "--require=/synthetic/injected.js" },
      packageDir: "../consumer/package",
    });
    expect(runCommand).toHaveBeenCalledTimes(2);
    const producer = runCommand.mock.calls[0];
    const consumer = runCommand.mock.calls[1];
    expect(producer?.[0]).toBe(process.execPath);
    expect(producer?.[1]).toEqual([
      "--import", "tsx", "scripts/temporal-compatibility-producer-fixtures.ts",
      "--output", expect.stringMatching(/fixtures\.json$/u),
    ]);
    const fixturesPath = producer?.[1][4];
    expect(consumer?.[1]).toEqual([
      "--dir", "../consumer/package", "temporal:check-reconciliation-compatibility",
      "--fixtures", fixturesPath,
    ]);
    expect(consumer?.[2].env).toEqual({ PATH: "/synthetic/bin", HOME: "/synthetic/home" });
    expect(consumer?.[2].signal).toBeInstanceOf(AbortSignal);
    await expect(access(path.dirname(fixturesPath!))).rejects.toThrow();
  });

  it("fails closed and removes fixtures after consumer rejection", async () => {
    runCommand.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("unsupported field"));
    await expect(preflightHostedLocalTemporalWorker({ env: {}, packageDir: "../consumer" }))
      .rejects.toThrow("Hosted-local Temporal compatibility preflight failed");
    const fixturesPath = runCommand.mock.calls[0]?.[1][4];
    await expect(access(path.dirname(fixturesPath!))).rejects.toThrow();
  });

  it("does not invoke the consumer if fixture generation fails", async () => {
    runCommand.mockRejectedValueOnce(new Error("producer failed"));
    await expect(preflightHostedLocalTemporalWorker({ env: {}, packageDir: "../consumer" }))
      .rejects.toThrow("compatibility preflight failed");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("bounds a hanging consumer and removes its fixtures", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    runCommand.mockResolvedValueOnce(undefined).mockImplementationOnce(async (_command, _args, input) => {
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("timed out")), { once: true });
      });
    });
    const result = preflightHostedLocalTemporalWorker({ env: {}, packageDir: "../consumer" });
    const rejection = expect(result).rejects.toThrow("compatibility preflight failed");
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2));
    timeout.abort();
    await rejection;
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    const fixturesPath = runCommand.mock.calls[0]?.[1][4];
    await expect(access(path.dirname(fixturesPath!))).rejects.toThrow();
  });

  it("preserves cancellation during producer generation and skips the consumer", async () => {
    const caller = new AbortController();
    runCommand.mockImplementationOnce(async () => {
      caller.abort();
      throw new Error("producer interrupted");
    });
    await expect(preflightHostedLocalTemporalWorker({ env: {}, packageDir: "../consumer", signal: caller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(runCommand).toHaveBeenCalledTimes(1);
    const fixturesPath = runCommand.mock.calls[0]?.[1][4];
    await expect(access(path.dirname(fixturesPath!))).rejects.toThrow();
  });

  it("preserves caller cancellation without starting commands", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(preflightHostedLocalTemporalWorker({ env: {}, packageDir: "../consumer", signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
