import type {
  HostedInferenceAuthKind,
  HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

export const HOSTED_INFERENCE_SECRET_SCHEMA =
  "murph.hosted-inference-secret.v1" as const;

export interface HostedInferenceConnectionAuth {
  kind: HostedInferenceAuthKind;
  secret: string;
}

export interface HostedInferenceConnectionCandidate {
  auth: HostedInferenceConnectionAuth;
  contextWindowTokens: number;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  supportsImages: boolean;
}

export interface HostedInferenceConnectionSecret {
  auth: HostedInferenceConnectionAuth;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  schema: typeof HOSTED_INFERENCE_SECRET_SCHEMA;
}

export interface HostedInferenceConnectionView {
  contextWindowTokens: number;
  endpointHost: string;
  model: string;
  protocol: HostedInferenceProtocol;
  revision: number;
  selected: boolean;
  supportsImages: boolean;
  verificationProfile: string;
  verifiedAt: string;
}

export interface HostedInferenceConnectionResolved
  extends HostedInferenceConnectionView {
  auth: HostedInferenceConnectionAuth;
  endpointUrl: string;
}
