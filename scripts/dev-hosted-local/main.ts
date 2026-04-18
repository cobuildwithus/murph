import process from "node:process";

import { startHostedLocalDevStack } from "./stack.ts";

export async function main(): Promise<void> {
  const stack = await startHostedLocalDevStack({
    env: process.env,
  });
  let terminationSignal: NodeJS.Signals | null = null;

  const handleTerminationSignal = async (signal: NodeJS.Signals) => {
    if (terminationSignal) {
      return;
    }

    terminationSignal = signal;
    process.stderr.write(`\nStopping local hosted dev (${signal}).\n`);
    await stack.stop(signal);
  };

  process.once("SIGINT", () => {
    void handleTerminationSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void handleTerminationSignal("SIGTERM");
  });

  try {
    await stack.ready;
  } catch (error) {
    if (terminationSignal) {
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

  const exited = await stack.waitForExit();
  await stack.stop("SIGTERM");

  if (terminationSignal) {
    return;
  }

  if (exited.child.exitCode === 0) {
    return;
  }

  throw new Error(`${exited.name} exited with code ${exited.child.exitCode ?? "unknown"}.`);
}

function emitReadyToken(token: string | undefined): void {
  const normalized = token?.trim();
  if (!normalized) {
    return;
  }

  process.stdout.write(`__MURPH_HOSTED_LOCAL_READY__ ${normalized}\n`);
}
