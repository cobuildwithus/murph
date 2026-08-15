export const NATIVE_IOS_HOSTED_E2E_CONTRACT_VERSION: "1";
export const NATIVE_IOS_HOSTED_E2E_STATUS_CONTEXT: "Native iOS hosted E2E";
export const NATIVE_IOS_HOSTED_E2E_VERCEL_TARGET_ENV: "native-ios-e2e";

export interface NativeIosHostedE2eDispatchInput {
  correlationId: string;
  mode: "pr" | "production_canary";
  webBaseUrl: string;
  webDeploymentRef: string;
  webSha: string;
}

export interface NativeIosHostedE2eDispatchInputs {
  account_lifecycle: "user_owned_delete" | "existing_identity_non_destructive";
  contract_version: "1";
  correlation_id: string;
  mode: "pr" | "production_canary";
  web_base_url: string;
  web_deployment_ref: string;
  web_environment: "native-ios-e2e" | "production";
  web_sha: string;
}

export interface NativeIosHostedE2ePathSelection {
  matchedPaths: string[];
  selected: boolean;
}

export interface VercelE2eDeploymentExpectation {
  expectedCustomEnvironmentId: string;
  expectedProjectId: string;
  expectedRef: string;
  expectedSha: string;
}

export interface VercelE2eDeploymentInspection {
  baseUrl: string;
  deploymentId: string;
  ready: boolean;
  terminalFailure: boolean;
}

export interface VercelE2eCustomEnvironmentExpectation {
  expectedEnvironmentId: string;
  expectedProjectId: string;
}

export interface PrivateWorkflowDispatchTagExpectation {
  expectedRef: string;
  expectedSha: string;
}

export interface PrivateWorkflowRunExpectation {
  expectedHeadSha: string;
  expectedRunId: number;
}

export interface PrivateWorkflowRunInspection {
  completed: boolean;
  conclusion: string | null;
}

export function buildNativeIosHostedE2eDispatchInputs(
  input: NativeIosHostedE2eDispatchInput,
): NativeIosHostedE2eDispatchInputs;

export function classifyNativeIosHostedE2ePaths(
  paths: readonly string[],
): NativeIosHostedE2ePathSelection;

export function inspectPrivateWorkflowDispatchTag(
  raw: unknown,
  expected: PrivateWorkflowDispatchTagExpectation,
): void;

export function inspectPrivateWorkflowRun(
  raw: unknown,
  expected: PrivateWorkflowRunExpectation,
): PrivateWorkflowRunInspection;

export function inspectVercelE2eCustomEnvironment(
  raw: unknown,
  expected: VercelE2eCustomEnvironmentExpectation,
): void;

export function inspectVercelE2eDeployment(
  raw: unknown,
  expected: VercelE2eDeploymentExpectation,
): VercelE2eDeploymentInspection;

export function readVercelDeploymentId(raw: unknown): string;

export function readWorkflowDispatchRunId(raw: unknown): number;
