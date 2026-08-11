export type {
  HostedContainerCustomInstanceType,
  HostedContainerInstanceType,
  HostedDeployAutomationEnvironment,
} from "./deploy-automation/environment.ts";
export { readHostedDeployAutomationEnvironment } from "./deploy-automation/environment.ts";
export {
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  buildHostedWorkerSecretsPayload,
} from "./deploy-automation/secrets.ts";
export {
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
} from "./deploy-automation/worker-optional-vars.ts";
export {
  buildHostedWranglerDeployConfig,
  resolveCloudflareDeployPaths,
} from "./deploy-automation/wrangler-config.ts";

export type {
  HostedContainerImageListing,
  HostedContainerImageTagReference,
} from "./deploy-automation/container-images.ts";
export {
  parseHostedContainerImageListOutput,
  selectHostedContainerImageTagsForCleanup,
} from "./deploy-automation/container-images.ts";
