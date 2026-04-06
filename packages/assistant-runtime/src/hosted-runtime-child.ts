import {
  formatHostedRuntimeChildResult,
  parseHostedAssistantRuntimeJobInput,
  runHostedAssistantRuntimeJobInProcessDetailed,
} from "./hosted-runtime.js";

async function main(): Promise<void> {
  const input = parseHostedAssistantRuntimeJobInput(JSON.parse(await readStandardInput()) as unknown);

  try {
    const result = await runHostedAssistantRuntimeJobInProcessDetailed(input);
    process.stdout.write(`${formatHostedRuntimeChildResult({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${formatHostedRuntimeChildResult({
        ok: false,
        error: {
          code:
            error
            && typeof error === "object"
            && "code" in error
            && typeof error.code === "string"
              ? error.code
              : null,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : null,
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
