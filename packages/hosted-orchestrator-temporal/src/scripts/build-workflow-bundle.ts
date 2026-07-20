import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleWorkflowCode } from "@temporalio/worker";

import {
  assertHostedTemporalWorkflowBundle,
} from "../workflow-bundle-policy.js";

const workflowsPath = fileURLToPath(
  new URL("../workflows/index.js", import.meta.url),
);
const workflowBundlePath = fileURLToPath(
  new URL("../workflow-bundle.js", import.meta.url),
);

if (!existsSync(workflowsPath)) {
  throw new Error(
    "Hosted Temporal workflow entrypoint is missing. Build TypeScript before bundling workflows.",
  );
}

const { code } = await bundleWorkflowCode({
  workflowsPath,
});
const summary = assertHostedTemporalWorkflowBundle(code);

await mkdir(dirname(workflowBundlePath), { recursive: true });
await writeFile(workflowBundlePath, code);

console.log(
  `Hosted Temporal workflow bundle written (${summary.byteLength} bytes, ${summary.sourceCount} sources).`,
);
