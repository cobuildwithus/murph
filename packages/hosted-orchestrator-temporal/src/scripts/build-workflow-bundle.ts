import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { bundleWorkflowCode } from "@temporalio/worker";

const workflowsPath = fileURLToPath(
  new URL("../workflows/hosted-user-runtime.js", import.meta.url),
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

await mkdir(dirname(workflowBundlePath), { recursive: true });
await writeFile(workflowBundlePath, code);

console.log("Hosted Temporal workflow bundle written.");
