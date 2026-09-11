export type EnvironmentVoiceOperation = "connect" | "save";
export type EnvironmentVoiceRequest = (
  operation: EnvironmentVoiceOperation, body: string,
) => Promise<Response>;

export const requestEnvironmentVoice: EnvironmentVoiceRequest = (operation, body) => fetch(
  operation === "connect" ? "/api/environment/realtime" : "/api/environment/realtime/topics",
  {
    method: "POST", body, credentials: "same-origin",
    headers: { "content-type": operation === "connect" ? "application/sdp" : "application/json" },
  },
);
