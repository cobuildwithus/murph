import { fileURLToPath } from "node:url";
import path from "node:path";

import { cleanupE2e, proveRunPostconditions } from "./native-ios-hosted-e2e-identity.mjs";
import { dispatchAndWait } from "./native-ios-hosted-e2e-native.mjs";
import {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
  NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET,
  assertSafeId,
  assertSha,
} from "./native-ios-hosted-e2e-support.mjs";
import {
  createE2eDeployment,
  retireE2eDeployments,
  waitForE2eDeployment,
} from "./native-ios-hosted-e2e-vercel.mjs";

export {
  NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION,
  NATIVE_IOS_HOSTED_E2E_LANE_MARKER,
  NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET,
};

export async function runPrLifecycle({ cleanup, deploy, dispatch, now, postconditions, retire }) {
  let primaryError = null;
  let finalizationError = null;
  try {
    await retire();
    await cleanup();
    const startedAtMs = now();
    const webBaseUrl = await deploy();
    await dispatch(webBaseUrl);
    await postconditions(startedAtMs);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      // Retire callback-capable Web deployments before provider or database state.
      await retire();
      await cleanup();
    } catch (error) {
      finalizationError = error;
    }
  }
  if (finalizationError) {
    throw new Error(primaryError
      ? "Native iOS E2E failed and fail-closed final cleanup did not complete."
      : "Native iOS E2E final cleanup did not complete.");
  }
  if (primaryError) throw primaryError;
}

async function runPr(args) {
  const sha = requiredArg(args, "sha");
  const ref = requiredArg(args, "ref");
  const correlationId = requiredArg(args, "correlation-id");
  assertSha(sha, "PR SHA");
  assertSafeId(correlationId, "correlation id", 120);
  let candidateDeploymentId = null;

  await runPrLifecycle({
    cleanup: cleanupE2e,
    deploy: async () => {
      const created = await createE2eDeployment({ correlationId, ref, sha });
      candidateDeploymentId = created.id;
      return waitForE2eDeployment({ deploymentId: created.id, ref, sha });
    },
    dispatch: (webBaseUrl) => dispatchAndWait({ correlationId, mode: "pr", webBaseUrl, webSha: sha }),
    now: Date.now,
    postconditions: proveRunPostconditions,
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
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) throw new Error("Expected --key value arguments.");
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
