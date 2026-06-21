import { pathToFileURL } from "node:url";

import {
  HOSTED_COMPUTER_CAPABILITIES_PATH,
  parseHostedComputerCapabilitiesResponse,
} from "@murphai/hosted-execution/computer-use";

import { requireConfiguredString } from "./deploy-automation/shared.ts";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../src/web-control-plane.ts";
import {
  readHostedWebCallbackSigningEnvironment,
} from "../src/web-callback-auth.ts";

const DEPLOY_COMPUTER_CAPABILITY_CHECK_USER_ID = "member_deploy_computer_capability_check";
const DEPLOY_COMPUTER_CAPABILITY_CHECK_TIMEOUT_MS = 15_000;

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function verifyHostedWebComputerCapabilities(input: {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const env = input.env ?? process.env;
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: requireConfiguredString(
      env.HOSTED_WEB_PRODUCTION_BASE_URL,
      "HOSTED_WEB_PRODUCTION_BASE_URL",
    ),
    boundUserId: DEPLOY_COMPUTER_CAPABILITY_CHECK_USER_ID,
    callbackSigning: readHostedWebCallbackSigningEnvironment(env),
    fetchImpl: input.fetchImpl,
    method: "GET",
    path: HOSTED_COMPUTER_CAPABILITIES_PATH,
    timeoutMs: DEPLOY_COMPUTER_CAPABILITY_CHECK_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(
      `Hosted web computer-use capability check failed with HTTP ${response.status}; deploy hosted web first.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `Hosted web computer-use capability check returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  parseHostedComputerCapabilitiesResponse(payload);
  console.log("Hosted web computer-use capabilities verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyHostedWebComputerCapabilities();
}
