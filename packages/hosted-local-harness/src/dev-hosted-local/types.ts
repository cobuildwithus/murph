export interface HostedLocalDevConfig {
  databaseUrlOverride: string | null;
  forceResetLocalDatabase: boolean;
  forceResetLocalTemporal: boolean;
  linqWebhookPublicUrl: string | null;
  linqWebhookRegistrationCachePath: string | null;
  linqWebhookTunnelConfigPath: string;
  linqWebhookTunnelMode: "auto" | "disabled" | "required";
  linqWebhookTunnelName: string;
  skipHealthCommonsWatch: boolean;
  skipLinqWebhookRegister: boolean;
  skipRunnerSmoke: boolean;
  skipPrismaMigrate: boolean;
  skipStripeListen: boolean;
  skipWeb: boolean;
  skipVercelPull: boolean;
  temporal: HostedLocalTemporalConfig;
  useVercelDatabaseUrl: boolean;
  webHost: string;
  webPort: number;
  workerHost: string;
  workerPersistDir: string;
  workerPort: number;
  workerProtocol: "http" | "https";
}

export type HostedLocalTemporalMode = "auto" | "disabled" | "external" | "managed";

export interface HostedLocalTemporalConfig {
  host: string;
  mode: HostedLocalTemporalMode;
  namespace: string;
  port: number;
  taskQueue: string;
}

export type HostedLocalChildProcessName =
  | "cloudflare"
  | "docker-events"
  | "health-commons"
  | "linq-tunnel"
  | "minio"
  | "stripe"
  | "temporal-server"
  | "temporal-worker"
  | "web";

export interface HostedExecutionOidcIdentity {
  environment: "development" | "preview" | "production";
  projectName: string;
  teamSlug: string;
}

export interface HostedWebDevServerLockMetadata {
  command: string;
  pid: number;
  port: number;
  startedAt: string;
}

export interface HostedLocalChildProcess {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  once(event: "error", listener: (error: Error) => void): this;
  pid?: number;
  signalCode?: NodeJS.Signals | null;
}

export interface NamedChildProcess {
  child: HostedLocalChildProcess;
  name: HostedLocalChildProcessName;
}

export interface BufferedNamedChildProcess extends NamedChildProcess {
  stderrTail(maxChars?: number): string;
  stderrText(): string;
  stdoutTail(maxChars?: number): string;
  stdoutText(): string;
}
