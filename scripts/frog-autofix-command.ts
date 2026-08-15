import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { superviseOwnedWorker } from "./frog-autofix-lib.ts";

const scriptPath = fileURLToPath(import.meta.url);
const MAXIMUM_STDOUT_BYTES = 16 * 1024 * 1024;

function parseArguments(args: string[]) {
  const separator = args.indexOf("--");
  const timeoutMs = Number(args[0]);
  const command = args[3];
  if (
    separator !== 2
    || !args[1]
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || !command
  ) {
    throw new Error("invalid bounded command arguments");
  }
  return {
    args: args.slice(4),
    command,
    cwd: path.resolve(args[1]),
    timeoutMs,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let overflow = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    if (overflow) return;
    bytes += chunk.length;
    if (bytes > MAXIMUM_STDOUT_BYTES) {
      overflow = true;
      child.stdout?.destroy();
      return;
    }
    chunks.push(chunk);
  });
  const result = await superviseOwnedWorker(
    child,
    () => undefined,
    options.timeoutMs,
    2_000,
  );
  process.stdout.write(JSON.stringify({
    status: overflow ? 1 : result.status,
    stdout: overflow ? "" : Buffer.concat(chunks).toString("utf8"),
    timedOut: result.timedOut,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ status: 1, stdout: "", timedOut: false }));
    process.exitCode = 1;
  });
}
