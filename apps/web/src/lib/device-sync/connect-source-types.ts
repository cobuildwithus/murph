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
  lastDataAt?: string | null;
  logo: LogoAsset;
  migrationState?:
    | "authorization_required"
    | "verifying_successor"
    | "cutover_ready";
  migrationRetryRequired?: boolean;
  name: string;
  recoveryKind?: "connection_reset";
  requiresReconnect?: boolean;
  requiresVitalDisclosure?: boolean;
  setupGuideActionLabel?: string;
  setupGuideId?: ConnectSourceSetupGuideId;
  unavailableActionLabel?: string;
  unavailableActionUrl?: string;
  unavailableMessage?: string;
};

