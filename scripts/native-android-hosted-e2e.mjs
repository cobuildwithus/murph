import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  cleanupE2e,
  normalizeJunctionClientUserIdNamespace,
  proveAndroidRunPostconditions,
} from "./native-ios-hosted-e2e-identity.mjs";
import { dispatchAndWait } from "./native-android-hosted-e2e-native.mjs";
import {
  assertSafeId,
  assertSha,
  requiredEnv,
} from "./native-ios-hosted-e2e-support.mjs";
import { runPrLifecycle } from "./native-ios-hosted-e2e.mjs";
import {
  createE2eDeployment,
  readE2eJunctionClientUserIdNamespace,
  retireE2eDeployments,
  waitForE2eDeployment,
} from "./native-ios-hosted-e2e-vercel.mjs";

async function runPr(args) {
  const sha = requiredArg(args, "sha");
  const ref = requiredArg(args, "ref");
  const correlationId = requiredArg(args, "correlation-id");
  const prNumber = requiredPositiveIntegerArg(args, "pr-number");
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const webGithubToken = requiredEnv("NATIVE_ANDROID_E2E_WEB_GITHUB_TOKEN");
  delete process.env.NATIVE_ANDROID_E2E_WEB_GITHUB_TOKEN;
  assertSha(sha, "PR SHA");
  assertSafeId(correlationId, "correlation id", 120);

  const junctionClientUserIdNamespace = normalizeJunctionClientUserIdNamespace(
    await readE2eJunctionClientUserIdNamespace(),
  );
  if (!junctionClientUserIdNamespace) {
    throw new Error("Vercel E2E Junction client user namespace must be non-empty.");
  }
  let candidateDeploymentId = null;

  await runPrLifecycle({
    laneLabel: "Native Android E2E",
    cleanup: () => cleanupE2e(junctionClientUserIdNamespace),
    deploy: async () => {
      const created = await createE2eDeployment({ correlationId, ref, sha });
      candidateDeploymentId = created.id;
      return waitForE2eDeployment({ deploymentId: created.id, ref, sha });
    },
    dispatch: (webBaseUrl) => dispatchAndWait({
      correlationId,
      mode: "pr",
      prHead: { prNumber, repository, token: webGithubToken },
      webBaseUrl,
      webSha: sha,
    }),
    now: Date.now,
    postconditions: (startedAtMs) => proveAndroidRunPostconditions(
      startedAtMs,
      junctionClientUserIdNamespace,
    ),
    retire: () => retireE2eDeployments(candidateDeploymentId),
  });
}

async function runCanary(args) {
  await dispatchAndWait({
    correlationId: requiredArg(args, "correlation-id"),
    mode: "production_canary",
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

function requiredPositiveIntegerArg(args, name) {
  const value = requiredArg(args, name);
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === "pr") return runPr(args);
  if (command === "canary") return runCanary(args);
  throw new Error("Expected pr or canary.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
