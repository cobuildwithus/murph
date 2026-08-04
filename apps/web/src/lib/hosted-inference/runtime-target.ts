import type {
  HostedInferenceAuthKind,
  HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";

import type {
  HostedInferenceConnectionResolved,
} from "./types";

export const HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA =
  "murph.hosted-inference-runtime-target.v1" as const;

export interface HostedInferenceRuntimeTarget {
  auth: {
    kind: HostedInferenceAuthKind;
    secret: string;
  };
  contextWindowTokens: number;
  endpointUrl: string;
  model: string;
  protocol: HostedInferenceProtocol;
  revision: number;
  schema: typeof HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA;
  supportsImages: boolean;
  verificationProfile: string;
}

export function projectHostedInferenceRuntimeTarget(
  connection: HostedInferenceConnectionResolved,
): HostedInferenceRuntimeTarget {
  return {
    auth: connection.auth,
    contextWindowTokens: connection.contextWindowTokens,
    endpointUrl: connection.endpointUrl,
    model: connection.model,
    protocol: connection.protocol,
    revision: connection.revision,
    schema: HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
    supportsImages: connection.supportsImages,
    verificationProfile: connection.verificationProfile,
  };
}
