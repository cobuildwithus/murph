export interface HostedLocalDevConfig {
  forceResetLocalDatabase: boolean;
  skipPrismaMigrate: boolean;
  skipStripeListen: boolean;
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
  signalCode?: NodeJS.Signals | null;
}

export interface NamedChildProcess {
  child: HostedLocalChildProcess;
  name: "cloudflare" | "stripe" | "web";
}

export interface BufferedNamedChildProcess extends NamedChildProcess {
  stderrTail(maxChars?: number): string;
  stderrText(): string;
  stdoutTail(maxChars?: number): string;
  stdoutText(): string;
}
