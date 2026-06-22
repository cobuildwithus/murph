export const KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES = [
  "https://*.onkernel.com:8443",
] as const;

export const KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES = [
  "https://*.onkernel.com:8443",
  "wss://*.onkernel.com:8443",
] as const;

export function isAllowedComputerLiveViewUrl(input: {
  url: string;
}): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    return false;
  }

  return parsedUrl.protocol === "https:"
    && parsedUrl.port === "8443"
    && parsedUrl.hostname.endsWith(".onkernel.com");
}
