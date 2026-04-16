export interface HostedLocalDevConfig {
  skipPrismaMigrate: boolean;
  skipWeb: boolean;
  skipVercelPull: boolean;
  webHost: string;
  webPort: number;
  workerHost: string;
  workerPersistDir: string;
  workerPort: number;
  workerProtocol: "http" | "https";
}

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
  pid?: number;
}

export interface NamedChildProcess {
  child: HostedLocalChildProcess;
  name: "cloudflare" | "web";
}
