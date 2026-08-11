import type { AppleHealthRelaySetupGuideId } from "@/src/lib/device-sync/apple-health-relay-setup-guide";

export type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

export type ConnectSourceSetupGuideId =
  | "zepp-apple-health"
  | AppleHealthRelaySetupGuideId;

export type ConnectSource = {
  connectionAvailable?: boolean;
  connectProvider?: string;
  connectTarget?: string;
  connected?: boolean;
  description: string;
  disconnectConnectionId?: string;
  disconnectScope?: "junction_account";
  disconnectSourceProviderSlug?: string;
  historicalResetIncomplete?: boolean;
  id: string;
  logo: LogoAsset;
  migrationState?:
    | "authorization_required"
    | "verifying_successor"
    | "cutover_ready";
  name: string;
  recoveryKind?: "connection_reset";
  requiresReconnect?: boolean;
  requiresJunctionDisclosure?: boolean;
  setupGuideActionLabel?: string;
  setupGuideId?: ConnectSourceSetupGuideId;
  unavailableActionLabel?: string;
  unavailableActionUrl?: string;
  unavailableMessage?: string;
};

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
  kind: "error" | "success" | "warning";
  message: string;
  sourceLabel?: string | null;
  title: string;
} | null;
