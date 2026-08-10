import type {
  HostedInferenceConnectionView,
} from "@/src/lib/hosted-inference/types";

/**
 * Synthetic verified connection shared by the design catalog's provider-dialog
 * and endpoint-pane studies. Never a real member endpoint or credential.
 */
export const DESIGN_INFERENCE_CONNECTION: HostedInferenceConnectionView = {
  contextWindowTokens: 131_072,
  endpointHost: "inference.example.com",
  model: "example-health-model",
  protocol: "responses",
  revision: 4,
  selected: false,
  supportsImages: false,
  verificationProfile: "murph-codex-0.147.0-portable-responses-v1",
  verifiedAt: "2026-07-30T22:00:00.000Z",
};
