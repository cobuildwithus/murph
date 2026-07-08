export type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

export type ConnectSource = {
  connectProvider?: string;
  connectTarget?: string;
  connected?: boolean;
  description: string;
  disconnectConnectionId?: string;
  disconnectScope?: "junction_account";
  id: string;
  logo: LogoAsset;
  name: string;
  requiresReconnect?: boolean;
  unavailableActionLabel?: string;
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
  connectSource: string | null;
} | null;

export type ConnectConsentRequest = {
  intentClaim?: string;
  source: ConnectSource;
};

export type ConnectIntentRecoveryRequest = {
  message: string;
  sourceName: string;
};

export type ConnectCallbackNotice = {
  kind: "error" | "success" | "warning";
  message: string;
  title: string;
} | null;
