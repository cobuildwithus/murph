import {
  assertHostedDeployEnvironmentAsync,
  parseDeployWorkerFlag,
} from "./deploy-preflight.js";

await assertHostedDeployEnvironmentAsync(process.env, {
  deployWorker: parseDeployWorkerFlag(process.env.HOSTED_EXECUTION_DEPLOY_WORKER),
});
