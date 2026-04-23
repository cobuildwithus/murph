import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
} from "@murphai/device-syncd/hosted-runtime";

export {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
};

export const HOSTED_WEB_USAGE_RECORD_PATH = "/api/internal/hosted-execution/usage/record";
export const HOSTED_WEB_ISSUE_RECORD_PATH = "/api/internal/hosted-execution/issues/record";
export const HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH =
  "/api/internal/hosted-execution/billing/stripe/customer/resolve";

const HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH =
  /^\/api\/internal\/device-sync\/providers\/[^/]+\/connect-link$/u;

export function isAllowedHostedRunnerWebControlPath(path: string): boolean {
  return path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH
    || path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    || path === HOSTED_WEB_ISSUE_RECORD_PATH
    || path === HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH
    || path === HOSTED_WEB_USAGE_RECORD_PATH
    || HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH.test(path);
}
