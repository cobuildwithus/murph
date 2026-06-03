import process from "node:process";

import { startHostedLocalDevStack } from "./stack.ts";

export async function main(): Promise<void> {
  const stack = await startHostedLocalDevStack({
    env: process.env,
  });
  let terminationSignal: NodeJS.Signals | null = null;
  let stopPromise: Promise<void> | null = null;
  let resolveTerminationCleanup: (() => void) | null = null;
  const terminationCleanupComplete = new Promise<void>((resolve) => {
    resolveTerminationCleanup = resolve;
  });
  let terminationCleanupError: unknown = null;
  const stopStack = (signal: NodeJS.Signals): Promise<void> => {
    stopPromise ??= stack.stop(signal);
    return stopPromise;
  };
  const awaitTerminationCleanup = async (): Promise<void> => {
    await terminationCleanupComplete;
    if (terminationCleanupError !== null) {
      throw terminationCleanupError;
    }
  };

  const handleTerminationSignal = async (signal: NodeJS.Signals) => {
    if (terminationSignal) {
      return;
    }

    terminationSignal = signal;
    stack.kill(signal);
    process.stderr.write(`\nStopping local hosted dev (${signal}).\n`);
    try {
      await stopStack(signal);
    } catch (error) {
      terminationCleanupError = error;
    } finally {
      resolveTerminationCleanup?.();
    }
  };

  const onSigint = (): void => {
    void handleTerminationSignal("SIGINT");
  };
  const onSigterm = (): void => {
    void handleTerminationSignal("SIGTERM");
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const onExit = (): void => {
    stack.kill("SIGKILL");
  };
  process.once("exit", onExit);

  try {
    try {
      await stack.ready;
    } catch (error) {
      if (terminationSignal) {
        await awaitTerminationCleanup();
        return;
      }

      throw error;
    }

    process.stdout.write(
      [
        "",
        "Local hosted dev is ready.",
        ...(stack.webBaseUrl ? [`web:    ${stack.webBaseUrl}`] : []),
        `worker: ${stack.workerBaseUrl}`,
        "",
      ].join("\n"),
    );
    emitReadyToken(process.env.MURPH_DEV_READY_TOKEN);

    const result = await Promise.race([
      stack.waitForExit().then((exited) => ({
        exited,
        type: "child-exit" as const,
      })),
      awaitTerminationCleanup().then(() => ({
        type: "termination-cleanup" as const,
      })),
    ]);

    if (result.type === "termination-cleanup") {
      return;
    }

    const { exited } = result;
    await stopStack("SIGTERM");

    if (terminationSignal) {
      await awaitTerminationCleanup();
      return;
    }

    if (exited.child.exitCode === 0) {
      return;
    }

    throw new Error(`${exited.name} exited with code ${exited.child.exitCode ?? "unknown"}.`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("exit", onExit);
  }
}

function emitReadyToken(token: string | undefined): void {
  const normalized = token?.trim();
  if (!normalized) {
    return;
  }

  process.stdout.write(`__MURPH_HOSTED_LOCAL_READY__ ${normalized}\n`);
}
