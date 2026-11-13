export type {
  ConnectSource,
  ConnectSourceSetupGuideId,
  LogoAsset,
} from "@/src/lib/device-sync/connect-source-types";

export type ConnectPageInitialLoadError = {
  message: string;
};

export type ConnectCallbackInput = {
  connectTarget: string | null;
  connectSource: string | null;
  errorCode: string | null;
  provider: string | null;
  status: "connected" | "error";
} | null;

export type InitialDeviceConnectIntent = {
  claim: string;
  // Presentation hint copied from the server-issued link. Claim redemption
  // remains the provider and effect authority.
  connectProvider?: string | null;
  connectSource: string | null;
} | null;

export type ConnectIntentRecoveryRequest = {
  message: string;
  sourceName: string;
};

export type ConnectCallbackNotice = {
  errorCode?: string | null;
  kind: "error" | "success" | "warning" | "info";
  message: string;
  sourceLabel?: string | null;
  title: string;
} | null;
