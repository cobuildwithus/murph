export type HostedDeviceConnectCompletionSource = "assistant" | "connect";

const HOSTED_DEVICE_CONNECT_COMPLETION_PATH = "/device-sync/connect/complete";

export function buildHostedDeviceConnectCompletionReturnTo(input: {
  connectSourceId: string;
  connectTarget: string;
  source: HostedDeviceConnectCompletionSource;
}): string {
  const url = new URL(HOSTED_DEVICE_CONNECT_COMPLETION_PATH, "https://murph.internal");
  url.searchParams.set("source", input.source);
  url.searchParams.set("connectSource", input.connectSourceId);
  url.searchParams.set("connectTarget", input.connectTarget);
  return `${url.pathname}${url.search}`;
}
