import {
  assertHostedDeployEnvironment,
  parseDeployWorkerFlag,
} from "./deploy-preflight.js";

assertHostedDeployEnvironment(process.env, {
  deployWorker: parseDeployWorkerFlag(process.env.HOSTED_EXECUTION_DEPLOY_WORKER),
});
