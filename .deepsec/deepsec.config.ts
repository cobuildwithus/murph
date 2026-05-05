import { defineConfig, type DeepsecPlugin } from "deepsec/config";

import { murphCloudflareWorkerEntrypoint } from "./matchers/murph-cloudflare-worker-entrypoint.js";
import { murphIncurCliCommandEntrypoint } from "./matchers/murph-incur-cli-command-entrypoint.js";
import { murphNodeHttpEntrypoint } from "./matchers/murph-node-http-entrypoint.js";
import { murphSignedRequestNoReplayCheck } from "./matchers/murph-signed-request-no-replay-check.js";

const murphPlugin: DeepsecPlugin = {
  name: "murph-custom",
  matchers: [
    murphCloudflareWorkerEntrypoint,
    murphNodeHttpEntrypoint,
    murphIncurCliCommandEntrypoint,
    murphSignedRequestNoReplayCheck,
  ],
};

export default defineConfig({
  defaultAgent: "codex",
  projects: [
    { id: "murph", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [murphPlugin],
});
