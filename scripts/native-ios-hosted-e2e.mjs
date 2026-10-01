import { fileURLToPath } from "node:url";
import path from "node:path";

import { dispatchAndWait } from "./native-ios-hosted-e2e-native.mjs";
import { readNativeE2EControllerPolicy } from "./native-ios-hosted-e2e-support.mjs";

async function runCanary(args) {
  const policy = await readNativeE2EControllerPolicy(requiredArg(args, "policy"));
  await dispatchAndWait({
    correlationId: requiredArg(args, "correlation-id"),
    source: policy.ios,
    webBaseUrl: requiredArg(args, "web-base-url"),
    webSha: requiredArg(args, "web-sha"),
  });
}

function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) {
      throw new Error("Expected --key value arguments.");
    }
    out.set(argv[i].slice(2), argv[i + 1]);
  }
  return out;
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== "canary") throw new Error("Expected canary.");
  await runCanary(parseArgs(rest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
