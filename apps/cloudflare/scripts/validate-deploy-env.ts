import {
  assertHostedDeployEnvironmentAsync,
  parseDeployWorkerFlag,
} from "./deploy-preflight.js";
import { createRunnerReleaseProvider } from "./runner-release-provider.js";

await assertHostedDeployEnvironmentAsync(process.env, {
  deployWorker: parseDeployWorkerFlag(process.env.HOSTED_EXECUTION_DEPLOY_WORKER),
});

if (process.env.HOSTED_EXECUTION_DEPLOY_CONTEXT === "production"
  && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
  const limits = await createRunnerReleaseProvider({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  }).readAccountLimits();
  console.log("Cloudflare native container account limits:", JSON.stringify(limits));
}
