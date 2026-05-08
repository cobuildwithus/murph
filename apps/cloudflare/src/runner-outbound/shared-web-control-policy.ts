import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
} from "@murphai/device-syncd/hosted-runtime";
import {
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_ISSUE_RECORD_PATH,
  HOSTED_RUNTIME_MAILBOX_FETCH_PATH,
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH,
  HOSTED_RUNTIME_USAGE_RECORD_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";

export {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
};

const HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH =
  /^\/api\/internal\/device-sync\/connect-targets\/[^/]+\/connect-link$/u;

export function isAllowedHostedRunnerWebControlPath(path: string): boolean {
  return isAllowedHostedRunnerWebControlRequest({
    method: "GET",
    path,
  }) || isAllowedHostedRunnerWebControlRequest({
    method: "POST",
    path,
  });
}

export function isAllowedHostedRunnerWebControlRequest(input: {
  method: string;
  path: string;
}): boolean {
  if (input.method === "GET") {
    return input.path === HOSTED_RUNTIME_WORKSPACE_PATH;
  }

  if (input.method !== "POST") {
    return false;
  }

  const path = input.path;
  return path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH
    || path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_ACK_PATH
    || path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_DIRTY_PENDING_PATH
    || path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    || path === HOSTED_RUNTIME_LOG_PATH
    || path === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH
    || path === HOSTED_RUNTIME_MAILBOX_FETCH_PATH
    || path === HOSTED_RUNTIME_MAILBOX_PAYLOAD_FETCH_PATH
    || path === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
    || path === HOSTED_RUNTIME_ISSUE_RECORD_PATH
    || path === HOSTED_RUNTIME_USAGE_RECORD_PATH
    || HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH.test(path);
}

export function assertAllowedHostedRunnerWebControlRequest(input: {
  method: string;
  path: string;
}): void {
  if (isAllowedHostedRunnerWebControlRequest(input)) {
    return;
  }

  throw new TypeError(
    `Hosted runtime web-control route is not allowlisted for proxy transport: ${input.method} ${input.path}`,
  );
}

export function readHostedRunnerWebControlRoute(path: string): {
  pathAndSearch: string;
  pathname: string;
} {
  const base = new URL("https://hosted-runtime.invalid/");
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new TypeError("Hosted runtime web-control route must be relative.");
  }

  return {
    pathAndSearch: `${url.pathname}${url.search}`,
    pathname: url.pathname,
  };
}
