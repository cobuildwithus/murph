export {
  KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES,
  KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES,
} from "../../../kernel-live-view-origin";

export interface ComputerLiveViewUrlInspection {
  allowed: boolean;
  hostnameAllowed: boolean;
  parsed: boolean;
  portAllowed: boolean;
  protocolAllowed: boolean;
}

export function isAllowedComputerLiveViewUrl(input: {
  url: string;
}): boolean {
  return inspectComputerLiveViewUrl(input).allowed;
}

export function inspectComputerLiveViewUrl(input: {
  url: string;
}): ComputerLiveViewUrlInspection {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    return {
      allowed: false,
      hostnameAllowed: false,
      parsed: false,
      portAllowed: false,
      protocolAllowed: false,
    };
  }

  const hostnameAllowed = parsedUrl.hostname.endsWith(".onkernel.com");
  const portAllowed = parsedUrl.port === "8443";
  const protocolAllowed = parsedUrl.protocol === "https:";
  return {
    allowed: protocolAllowed && portAllowed && hostnameAllowed,
    hostnameAllowed,
    parsed: true,
    portAllowed,
    protocolAllowed,
  };
}
