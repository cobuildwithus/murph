import {
  formatHostedRuntimeChildResult,
  parseHostedAssistantRuntimeJobInput,
  runHostedAssistantRuntimeJobInProcess,
} from "./hosted-runtime.js";

async function main(): Promise<void> {
  const input = parseHostedAssistantRuntimeJobInput(JSON.parse(await readStandardInput()) as unknown);

  try {
    const result = await runHostedAssistantRuntimeJobInProcess(input);
    process.stdout.write(`${formatHostedRuntimeChildResult({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${formatHostedRuntimeChildResult({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack ?? null : null,
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

await main();
